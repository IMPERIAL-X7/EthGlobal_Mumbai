import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { z } from "zod";
import {
  CosignReq,
  CreateAgentReq,
  PolicyRequestReq,
  ProposePolicyReq,
  SettledReq,
  SubmitPaymentReq,
  WorldProofReq,
} from "@leash/shared";
import { WorldError, fakeProof } from "@leash/world";
import type { Deps } from "./deps.ts";
import { HttpError, notFound } from "./services/common.ts";
import { logout, ownerFromSessionToken, worldAuthRequest, worldAuthVerify, type Owner } from "./services/auth.ts";
import {
  activity,
  agentDetail,
  agentFromApiKey,
  auditCsv,
  auditLog,
  createAgent,
  getOwnedAgent,
  publicAgent,
  setStatus,
  type AgentRow,
} from "./services/agents.ts";
import { cancelIntent, cosign, proposePolicy, reportSettled, submitPayment, waitForDecision } from "./services/intents.ts";
import { approvalWorldRequest, approveWithWorld, denyApproval, getApproval, listApprovals } from "./services/approvals.ts";

export const SESSION_COOKIE = "leash_sid";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      owner?: Owner;
      agent?: AgentRow;
    }
  }
}

const parse = <T extends z.ZodTypeAny>(schema: T, v: unknown): z.infer<T> => {
  const r = schema.safeParse(v);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), "validation");
  return r.data;
};
const p = (req: Request, k: string) => String(req.params[k]);

export function buildApp(d: Deps) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: d.cfg.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "256kb" }));
  app.use(cookieParser());

  const ownerAuth = (req: Request, _res: Response, next: NextFunction) => {
    const o = ownerFromSessionToken(d, req.cookies?.[SESSION_COOKIE]);
    if (!o) return next(new HttpError(401, "sign in with World ID", "unauthenticated"));
    req.owner = o;
    next();
  };
  const agentAuth = (req: Request, _res: Response, next: NextFunction) => {
    const m = (req.header("authorization") ?? "").match(/^Bearer\s+(lsh_[\w-]+)$/);
    const a = agentFromApiKey(d, m?.[1]);
    if (!a) return next(new HttpError(401, "invalid agent API key", "unauthenticated"));
    req.agent = a;
    next();
  };
  const setCookie = (res: Response, token: string) =>
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: d.cfg.PUBLIC_BASE_URL.startsWith("https"), maxAge: 7 * 24 * 3600 * 1000 });

  const r = express.Router();

  // -------------------------------------------------------------- meta
  r.get("/health", (_req, res) => {
    res.json({ ok: true, modes: { world: d.world.mode, hedera: d.ledger.mode, ens: d.ens.mode }, auditTopic: d.audit.topicId, serverCosignPublicKey: d.ledger.serverPublicKey });
  });

  // -------------------------------------------------------------- owner auth (World ID)
  r.post("/auth/world/request", async (req, res) => {
    const b = parse(z.object({ mode: z.enum(["enroll", "login"]), sessionId: z.string().optional() }), req.body);
    res.json(await worldAuthRequest(d, b.mode, b.sessionId));
  });
  r.post("/auth/world/verify", async (req, res) => {
    const b = parse(z.object({ mode: z.enum(["enroll", "login"]), result: z.unknown() }), req.body);
    const { owner, token, created } = await worldAuthVerify(d, b.mode, b.result);
    setCookie(res, token);
    res.json({ owner: { id: owner.id, sessionId: owner.world_session_id }, created });
  });
  r.post("/auth/logout", (req, res) => {
    logout(d, req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE).json({ ok: true });
  });
  r.get("/me", ownerAuth, (req, res) => {
    const agents = (d.db.prepare(`SELECT * FROM agents WHERE owner_id = ? ORDER BY created_at DESC`).all(req.owner!.id) as AgentRow[]).map(publicAgent);
    res.json({ owner: { id: req.owner!.id, sessionId: req.owner!.world_session_id, createdAt: req.owner!.created_at }, agents });
  });

  // -------------------------------------------------------------- agents (owner)
  r.post("/agents", ownerAuth, async (req, res) => {
    res.status(201).json(await createAgent(d, req.owner!, parse(CreateAgentReq, req.body)));
  });
  r.get("/agents/:id", ownerAuth, async (req, res) => {
    res.json(await agentDetail(d, getOwnedAgent(d, req.owner!, p(req, "id"))));
  });
  r.put("/agents/:id/policy", ownerAuth, (req, res) => {
    const a = getOwnedAgent(d, req.owner!, p(req, "id"));
    res.status(202).json(proposePolicy(d, a, parse(ProposePolicyReq, req.body).policy, "owner"));
  });
  for (const [path, status] of [
    ["pause", "paused"],
    ["resume", "active"],
    ["revoke", "revoked"],
  ] as const) {
    r.post(`/agents/:id/${path}`, ownerAuth, async (req, res) => {
      res.json(await setStatus(d, req.owner!, getOwnedAgent(d, req.owner!, p(req, "id")), status));
    });
  }
  r.get("/agents/:id/activity", ownerAuth, (req, res) => {
    const a = getOwnedAgent(d, req.owner!, p(req, "id"));
    res.json(activity(d, a.id, Math.min(Number(req.query.limit ?? 50), 200), req.query.before ? Number(req.query.before) : undefined));
  });
  r.get("/agents/:id/audit", ownerAuth, (req, res) => {
    const a = getOwnedAgent(d, req.owner!, p(req, "id"));
    res.json({ topicId: d.audit.topicId, topicUrl: d.audit.topicUrl(), events: auditLog(d, a.id) });
  });
  r.get("/agents/:id/audit.csv", ownerAuth, (req, res) => {
    const a = getOwnedAgent(d, req.owner!, p(req, "id"));
    res.type("text/csv").attachment(`leash-${a.label}-audit.csv`).send(auditCsv(d, a.id));
  });

  // -------------------------------------------------------------- approvals (owner)
  r.get("/approvals", ownerAuth, (req, res) => {
    res.json(listApprovals(d, req.owner!, typeof req.query.status === "string" ? req.query.status : undefined));
  });
  r.get("/approvals/:id", ownerAuth, (req, res) => {
    res.json(getApproval(d, req.owner!, p(req, "id")));
  });
  r.post("/approvals/:id/world-request", ownerAuth, async (req, res) => {
    res.json(await approvalWorldRequest(d, req.owner!, p(req, "id")));
  });
  r.post("/approvals/:id/verify", ownerAuth, async (req, res) => {
    res.json(await approveWithWorld(d, req.owner!, p(req, "id"), parse(WorldProofReq, req.body).result));
  });
  r.post("/approvals/:id/deny", ownerAuth, (req, res) => {
    res.json(denyApproval(d, req.owner!, p(req, "id")));
  });

  // -------------------------------------------------------------- receipts (public)
  r.get("/receipts/:id", (req, res) => {
    const row = d.db.prepare(`SELECT receipt_json FROM payments WHERE id = ?`).get(p(req, "id")) as { receipt_json: string } | undefined;
    if (!row) throw notFound("receipt not found");
    res.json(JSON.parse(row.receipt_json));
  });

  // -------------------------------------------------------------- agent API (bearer key)
  r.get("/agent/me", agentAuth, (req, res) => {
    res.json(publicAgent(req.agent!));
  });
  r.post("/agent/intents", agentAuth, async (req, res) => {
    res.status(201).json(await submitPayment(d, req.agent!, parse(SubmitPaymentReq, req.body)));
  });
  r.get("/agent/intents/:id/wait", agentAuth, async (req, res) => {
    res.json(await waitForDecision(d, req.agent!, p(req, "id"), Number(req.query.timeout ?? 25)));
  });
  r.post("/agent/intents/:id/cosign", agentAuth, async (req, res) => {
    res.json(await cosign(d, req.agent!, p(req, "id"), parse(CosignReq, req.body).txBytesBase64));
  });
  r.post("/agent/intents/:id/settled", agentAuth, async (req, res) => {
    const b = parse(SettledReq, req.body);
    res.json(await reportSettled(d, req.agent!, p(req, "id"), b.txId, b.source));
  });
  r.post("/agent/intents/:id/cancel", agentAuth, (req, res) => {
    res.json(cancelIntent(d, req.agent!, p(req, "id")));
  });
  // The agent may ASK for higher limits. It can never apply them: a human must approve with World ID.
  r.post("/agent/policy-requests", agentAuth, (req, res) => {
    const b = parse(PolicyRequestReq, req.body);
    res.status(202).json(proposePolicy(d, req.agent!, b.policy, "agent", b.reason));
  });

  // -------------------------------------------------------------- dev-only (fake chains)
  if (d.ledger.mode === "fake" || d.world.mode === "fake") {
    r.post("/dev/fund", (req, res) => {
      if (d.ledger.mode !== "fake") throw notFound();
      const b = parse(z.object({ account: z.string(), asset: z.string(), amount: z.string() }), req.body);
      (d.ledger as any).devFund(b.account, b.asset, b.amount);
      res.json({ ok: true });
    });
    /** Plays the x402 facilitator: executes a (co-)signed transfer on the fake ledger. */
    r.post("/dev/settle", async (req, res) => {
      if (d.ledger.mode !== "fake") throw notFound();
      const b = parse(z.object({ txBytesBase64: z.string() }), req.body);
      res.json({ txId: await (d.ledger as any).devSubmit(Buffer.from(b.txBytesBase64, "base64")) });
    });
    /** Plays the World App simulator: returns a proof the fake verifier accepts. */
    r.post("/dev/world-proof", (req, res) => {
      if (d.world.mode !== "fake") throw notFound();
      const b = parse(z.object({ action: z.string().optional(), sessionId: z.string() }), req.body);
      res.json(fakeProof(b));
    });
  }

  app.use("/v1", r);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.code, message: err.message });
    // A rejected / malformed World ID proof is the caller's problem, not a server fault.
    if (err instanceof WorldError) return void res.status(400).json({ error: "world_proof_invalid", message: err.message });
    if ((err as any)?.type === "entity.parse.failed") return void res.status(400).json({ error: "bad_json", message: "invalid JSON body" });
    // Hedera / Sepolia node outages (e.g. testnet maintenance): tell the client it's the chain, not us.
    const msg = String((err as any)?.message ?? "");
    if (/gRPC service failed|UNAVAILABLE|max attempts of \d+ was reached|ECONNRESET|ETIMEDOUT/.test(msg)) {
      console.error("[http] chain unavailable:", msg.slice(0, 200));
      return void res.status(503).json({ error: "chain_unavailable", message: "The blockchain network is temporarily unavailable. Try again in a minute." });
    }
    console.error("[http] unhandled:", err);
    res.status(500).json({ error: "internal", message: "internal error" });
  });
  return app;
}

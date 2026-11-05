/**
 * Real x402 protocol, end to end (fake chains):
 *   agent SDK  --GET-->  merchant (@x402/express)  --402 PAYMENT-REQUIRED-->
 *   agent SDK  --intent-->  Leash  (auto | pending -> owner approves with World ID -> co-sign)
 *   agent SDK  --PAYMENT-SIGNATURE-->  merchant --settle--> facilitator --> ledger
 *   agent SDK  --settled-->  Leash (verifies on ledger, receipt, audit)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { LeashAgent, LeashDenied } from "@leash/agent-sdk";
import { fakeProof } from "@leash/world";
import { loadConfig } from "../../server/src/config.ts";
import { buildDeps, type Deps } from "../../server/src/deps.ts";
import { buildApp } from "../../server/src/http.ts";
import { buildMerchant } from "./app.ts";

const listen = async (h: any) => {
  const s = createServer(h);
  await new Promise<void>((r) => s.listen(0, r));
  return { s, url: `http://127.0.0.1:${(s.address() as AddressInfo).port}` };
};

let leashSrv: Server, merchSrv: Server;
let api: string, merchant: string, deps: Deps;
let cookie: string, agent: LeashAgent, agentId: string;

async function ownerCall(method: string, path: string, body?: unknown) {
  const r = await fetch(api + path, { method, headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
  return r.json() as Promise<any>;
}

/** The "owner" in this test: approves or denies whatever shows up in the inbox. */
function ownerWill(decision: "approve" | "deny") {
  const off = deps.bus.on("approval.pending", async (e) => {
    off();
    if (decision === "deny") return void ownerCall("POST", `/approvals/${e.approvalId}/deny`);
    await ownerCall("POST", `/approvals/${e.approvalId}/verify`, { result: fakeProof({ action: e.worldAction, sessionId: "session_owner" }) });
  });
}

beforeAll(async () => {
  deps = buildDeps(loadConfig({ LEASH_FAKE_CHAINS: "1", DATABASE_URL: ":memory:" } as any));
  const l = await listen(buildApp(deps));
  leashSrv = l.s;
  api = `${l.url}/v1`;
  const m = await listen(buildMerchant({ fake: true, leashApi: api }));
  merchSrv = m.s;
  merchant = m.url;

  const en = await fetch(`${api}/auth/world/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "enroll", result: fakeProof({ action: "leash_enroll", sessionId: "session_owner" }) }),
  });
  cookie = en.headers.get("set-cookie")!.split(";")[0]!;
  const created = await ownerCall("POST", "/agents", { name: "shopper" });
  agentId = created.agent.id;
  agent = new LeashAgent({
    apiUrl: api,
    apiKey: created.secrets.apiKey,
    agentPrivateKey: created.secrets.agentPrivateKey,
    hotAccount: created.agent.hot_account,
    vaultAccount: created.agent.vault_account,
    approvalTimeoutSec: 10,
  });
});
afterAll(() => {
  leashSrv.close();
  merchSrv.close();
});

describe("x402 on Hedera through Leash", () => {
  it("merchant answers 402 with Hedera payment requirements", async () => {
    const r = await fetch(`${merchant}/forecast`);
    expect(r.status).toBe(402);
    expect(r.headers.get("PAYMENT-REQUIRED")).toBeTruthy();
  });

  it("large payment: waits for World ID approval, pays from the 2-of-3 vault", async () => {
    ownerWill("approve");
    const res = await agent.fetch(`${merchant}/report/premium`);
    expect(res.status).toBe(200);
    expect((await res.json()).title).toMatch(/climate/);
    const act = await ownerCall("GET", `/agents/${agentId}/activity`);
    expect(act[0].status).toBe("settled");
    expect(act[0].source).toBe("vault");
    const bal = await deps.ledger.getBalances("0.0.6001");
    expect(bal["0.0.429274"]).toBe("2500000");
  });

  it("small payment to a now-known payee: auto from the hot wallet, no human", async () => {
    const res = await agent.fetch(`${merchant}/forecast`);
    expect(res.status).toBe(200);
    const act = await ownerCall("GET", `/agents/${agentId}/activity`);
    expect(act[0]).toMatchObject({ status: "settled", source: "hot", decision: "AUTO_HOT" });
  });

  it("prompt-injected payment to an attacker: owner denies, nothing moves", async () => {
    ownerWill("deny");
    await expect(agent.fetch(`${merchant}/attacker/data`)).rejects.toBeInstanceOf(LeashDenied);
    const bal = await deps.ledger.getBalances("0.0.6666");
    expect(bal["0.0.429274"] ?? "0").toBe("0");
  });
});

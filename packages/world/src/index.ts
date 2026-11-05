/**
 * World ID integration behind a small interface so flows never depend on SDK details.
 *
 * Real mode follows docs.world.org (IDKit 4.x):
 *   - backend signs every request:   signRequest({ signingKeyHex, action })  -> rp_context
 *   - browser runs IDKit, returns the completion result unchanged
 *   - backend verifies:               POST https://developer.world.org/api/v4/verify/{rp_id}
 *
 * Open questions are tracked as spikes in docs/BACKEND_PLAN.md §8 (S1, S5, S6).
 */

import { signRequest } from "@worldcoin/idkit-core/signing";

export interface RpContext {
  rp_id: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
}

/** What the browser needs to start an IDKit request. */
export interface WorldRequestParams {
  app_id: string;
  action?: string;
  rp_context: RpContext;
  environment: "staging" | "production";
  /** "create" on enrollment, the stored id when proving an existing session. */
  session_id?: string;
  /** Shown to the human inside World App. We fill it from the frozen intent, never from agent text. */
  action_description?: string;
}

export interface RequestOpts {
  action?: string;
  sessionId?: string;
  actionDescription?: string;
  ttlSeconds?: number;
}

export interface VerifiedProof {
  /** Uniqueness nullifier for (human, app, action), decimal string. */
  nullifier: string;
  action?: string;
  sessionId?: string;
  environment: string;
}

export interface WorldVerifier {
  readonly mode: "real" | "fake";
  requestParams(opts: RequestOpts): Promise<WorldRequestParams>;
  /** Throws on any failure. Callers must still check action/session/nullifier against their own state. */
  verify(result: unknown, expected: { action?: string }): Promise<VerifiedProof>;
}

export class WorldError extends Error {}

// ---------- helpers ----------

function pick(obj: unknown, path: (string | number)[]): unknown {
  let cur: any = obj;
  for (const k of path) {
    if (cur == null) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** Normalise a nullifier (hex or decimal) to a decimal string so uniqueness checks can't be bypassed by re-encoding. */
export function normaliseNullifier(n: unknown): string {
  if (typeof n !== "string" && typeof n !== "number" && typeof n !== "bigint") throw new WorldError("missing nullifier");
  return BigInt(n as any).toString(10);
}

export function extractProofFields(result: unknown): { nullifier: string; action?: string; sessionId?: string } {
  const nullifierRaw =
    pick(result, ["responses", 0, "nullifier"]) ?? pick(result, ["nullifier"]) ?? pick(result, ["session_nullifier", 0]);
  const action = (pick(result, ["action"]) ?? pick(result, ["responses", 0, "action"])) as string | undefined;
  const sessionId = pick(result, ["session_id"]) as string | undefined;
  return { nullifier: normaliseNullifier(nullifierRaw), action, sessionId };
}

// ---------- real ----------

export interface RealWorldConfig {
  appId: string;
  rpId: string;
  signingKeyHex: string;
  environment: "staging" | "production";
  verifyBaseUrl?: string;
}

export class RealWorldVerifier implements WorldVerifier {
  readonly mode = "real" as const;
  constructor(private cfg: RealWorldConfig) {}

  async requestParams(opts: RequestOpts): Promise<WorldRequestParams> {
    // Action is hashed into the RP signature, so a signed request is only valid for that exact action.
    const signed = signRequest({
      signingKeyHex: this.cfg.signingKeyHex,
      ...(opts.action ? { action: opts.action } : {}),
      ...(opts.ttlSeconds ? { ttl: opts.ttlSeconds } : {}),
    });
    return {
      app_id: this.cfg.appId,
      action: opts.action,
      environment: this.cfg.environment,
      session_id: opts.sessionId,
      action_description: opts.actionDescription,
      rp_context: {
        rp_id: this.cfg.rpId,
        nonce: signed.nonce,
        created_at: signed.createdAt,
        expires_at: signed.expiresAt,
        signature: signed.sig,
      },
    };
  }

  async verify(result: unknown, expected: { action?: string }): Promise<VerifiedProof> {
    if (typeof result !== "object" || result === null) throw new WorldError("invalid proof payload");
    const env = (result as any).environment ?? this.cfg.environment;
    if (env !== this.cfg.environment) throw new WorldError(`environment mismatch: ${env}`);

    const base = this.cfg.verifyBaseUrl ?? "https://developer.world.org";
    const res = await fetch(`${base}/api/v4/verify/${this.cfg.rpId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...(result as object), environment: this.cfg.environment }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || body?.success !== true) {
      throw new WorldError(`World verify failed (${res.status}): ${JSON.stringify(body).slice(0, 300)}`);
    }
    if (body.environment && body.environment !== this.cfg.environment) throw new WorldError("verified in wrong environment");

    const fields = extractProofFields(result);
    if (expected.action && fields.action && fields.action !== expected.action) {
      throw new WorldError(`action mismatch: proof for ${fields.action}, expected ${expected.action}`);
    }
    return { ...fields, action: fields.action ?? expected.action, environment: this.cfg.environment };
  }
}

// ---------- fake (offline dev, tests, frontend work) ----------

/**
 * Accepts { fake: true, action, session_id, nullifier }.
 * Behaves like the real verifier on everything we check ourselves (action binding, environment).
 */
export class FakeWorldVerifier implements WorldVerifier {
  readonly mode = "fake" as const;
  constructor(private appId = "app_fake", private rpId = "rp_fake") {}

  async requestParams(opts: RequestOpts): Promise<WorldRequestParams> {
    const now = Math.floor(Date.now() / 1000);
    return {
      app_id: this.appId,
      action: opts.action,
      environment: "staging",
      session_id: opts.sessionId,
      action_description: opts.actionDescription,
      rp_context: { rp_id: this.rpId, nonce: crypto.randomUUID(), created_at: now, expires_at: now + 300, signature: "0xfake" },
    };
  }

  async verify(result: unknown, expected: { action?: string }): Promise<VerifiedProof> {
    if (!result || (result as any).fake !== true) throw new WorldError("fake verifier: not a fake proof");
    const fields = extractProofFields(result);
    if (expected.action && fields.action !== expected.action) {
      throw new WorldError(`action mismatch: proof for ${fields.action}, expected ${expected.action}`);
    }
    return { ...fields, environment: "staging" };
  }
}

/** Helper for tests / the fake-mode UI: builds what the simulator would return. */
export function fakeProof(o: { action?: string; sessionId: string; nullifier?: string }) {
  return {
    fake: true,
    action: o.action,
    session_id: o.sessionId,
    responses: [{ nullifier: o.nullifier ?? BigInt("0x" + crypto.randomUUID().replace(/-/g, "")).toString() }],
  };
}

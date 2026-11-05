import { ENROLL_ACTION } from "@leash/shared";
import type { Deps } from "../deps.ts";
import { now } from "../db.ts";
import { bad, conflict, forbidden, newId, randomToken, sha256 } from "./common.ts";

export interface Owner {
  id: string;
  world_session_id: string;
  enrollment_nullifier: string;
  fresh_presence_at: number | null;
  created_at: number;
}

const SESSION_TTL = 7 * 24 * 3600;
/** Fallback owner binding window: a proveSession within this many seconds counts as "owner present". */
export const PRESENCE_WINDOW = 180;

/** Insert (nullifier, action) or throw — this is our replay protection. */
export function consumeNullifier(d: Deps, nullifier: string, action: string) {
  try {
    d.db.prepare(`INSERT INTO nullifiers (nullifier, action, used_at) VALUES (?, ?, ?)`).run(nullifier, action, now());
  } catch {
    throw conflict("this World ID proof was already used", "proof_replayed");
  }
}

function issueSession(d: Deps, ownerId: string) {
  const token = randomToken("sid");
  d.db.prepare(`INSERT INTO sessions (token_hash, owner_id, expires_at) VALUES (?, ?, ?)`).run(sha256(token), ownerId, now() + SESSION_TTL);
  return token;
}

export function ownerFromSessionToken(d: Deps, token: string | undefined): Owner | null {
  if (!token) return null;
  const row = d.db
    .prepare(`SELECT o.* FROM sessions s JOIN owners o ON o.id = s.owner_id WHERE s.token_hash = ? AND s.expires_at > ?`)
    .get(sha256(token), now()) as Owner | undefined;
  return row ?? null;
}

export function logout(d: Deps, token: string | undefined) {
  if (token) d.db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(sha256(token));
}

/** Step 1 for enroll/login: params for the IDKit request. */
export async function worldAuthRequest(d: Deps, mode: "enroll" | "login", sessionId?: string) {
  if (mode === "enroll") return d.world.requestParams({ action: ENROLL_ACTION, sessionId: "create", actionDescription: "Create your Leash account" });
  if (!sessionId) throw bad("sessionId required for login");
  return d.world.requestParams({ sessionId });
}

/**
 * Step 2: verify.
 *  - enroll: action-bound uniqueness proof + new session  => one human = one owner
 *  - login:  proveSession; session_id must match an owner
 * Both refresh "fresh presence" (fallback owner binding for approvals, spike S1).
 */
export async function worldAuthVerify(d: Deps, mode: "enroll" | "login", result: unknown) {
  if (mode === "enroll") {
    const p = await d.world.verify(result, { action: ENROLL_ACTION });
    if (p.action !== ENROLL_ACTION) throw bad("not an enrollment proof");
    if (!p.sessionId) throw bad("enrollment proof did not create a World ID session");
    const existing = d.db.prepare(`SELECT * FROM owners WHERE enrollment_nullifier = ?`).get(p.nullifier) as Owner | undefined;
    if (existing) {
      // Same human again: treat as login (their old session id stays canonical).
      d.db.prepare(`UPDATE owners SET fresh_presence_at = ? WHERE id = ?`).run(now(), existing.id);
      return { owner: existing, token: issueSession(d, existing.id), created: false };
    }
    consumeNullifier(d, p.nullifier, ENROLL_ACTION);
    const owner: Owner = { id: newId("own"), world_session_id: p.sessionId, enrollment_nullifier: p.nullifier, fresh_presence_at: now(), created_at: now() };
    d.db
      .prepare(`INSERT INTO owners (id, world_session_id, enrollment_nullifier, fresh_presence_at, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(owner.id, owner.world_session_id, owner.enrollment_nullifier, owner.fresh_presence_at, owner.created_at);
    return { owner, token: issueSession(d, owner.id), created: true };
  }

  const p = await d.world.verify(result, {});
  if (!p.sessionId) throw bad("not a session proof");
  const owner = d.db.prepare(`SELECT * FROM owners WHERE world_session_id = ?`).get(p.sessionId) as Owner | undefined;
  if (!owner) throw forbidden("no Leash account for this World ID session — enroll first");
  consumeNullifier(d, p.nullifier, `session:${p.action ?? "login"}`);
  d.db.prepare(`UPDATE owners SET fresh_presence_at = ? WHERE id = ?`).run(now(), owner.id);
  return { owner, token: issueSession(d, owner.id), created: false };
}

import { randomBytes, createHash } from "node:crypto";
import type { AuditEntry } from "@leash/hedera";
import type { Deps } from "../deps.ts";
import { now } from "../db.ts";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "error",
  ) {
    super(message);
  }
}
export const bad = (m: string, code = "bad_request") => new HttpError(400, m, code);
export const forbidden = (m = "forbidden") => new HttpError(403, m, "forbidden");
export const notFound = (m = "not found") => new HttpError(404, m, "not_found");
export const conflict = (m: string, code = "conflict") => new HttpError(409, m, code);

export const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString("base64url")}`;
export const randomToken = (prefix: string) => `${prefix}_${randomBytes(24).toString("base64url")}`;
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Record an audit event: DB row immediately, HCS append in the background
 * (testnet consensus takes a few seconds; never block the request on it).
 */
export function audit(d: Deps, ownerId: string, e: AuditEntry): Promise<void> {
  const info = d.db
    .prepare(`INSERT INTO audit_events (agent_id, type, fields_json, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(e.agentId, e.type, JSON.stringify(e.fields), e.payload === undefined ? null : JSON.stringify(e.payload), now());
  const rowId = info.lastInsertRowid;
  return d.audit
    .append(e)
    .then((r) => {
      d.db.prepare(`UPDATE audit_events SET topic_id = ?, seq = ?, payload_hash = ? WHERE id = ?`).run(r.topicId, r.seq, r.payloadHash ?? null, rowId);
      d.bus.emit("audit.appended", { agentId: e.agentId, type: e.type, topicId: r.topicId, seq: r.seq }, ownerId);
    })
    .catch((err) => {
      d.db.prepare(`UPDATE audit_events SET error = ? WHERE id = ?`).run(String(err?.message ?? err), rowId);
      console.error("[audit] HCS append failed:", err?.message ?? err);
    });
}

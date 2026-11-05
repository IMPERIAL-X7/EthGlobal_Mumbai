import { Client, TopicId, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";
import { canonicalize, sha256Hex } from "@leash/shared";

/**
 * Tamper-evident audit log. Each message is compact JSON (< 1 KB) committed to an HCS topic
 * with no admin key, so history can't be edited. The full payload stays in our DB; the
 * message carries its sha256 so anyone can check the DB copy against the chain.
 */
export interface AuditEntry {
  type: string; // e.g. INTENT_DECIDED, APPROVAL_APPROVED, PAYMENT_SETTLED, AGENT_PAUSED, ANOMALY
  agentId: string;
  /** small, public, non-sensitive fields */
  fields: Record<string, string | number | boolean | undefined>;
  /** full payload; only its hash goes on chain */
  payload?: unknown;
}
export interface AuditReceipt {
  topicId: string;
  seq: number;
  payloadHash?: string;
}
export interface AuditLog {
  readonly mode: "real" | "fake";
  readonly topicId: string;
  append(e: AuditEntry): Promise<AuditReceipt>;
  topicUrl(): string;
}

export function encodeAudit(e: AuditEntry, ts = Math.floor(Date.now() / 1000)): { message: string; payloadHash?: string } {
  const payloadHash = e.payload === undefined ? undefined : sha256Hex(canonicalize(e.payload));
  const message = canonicalize({ v: 1, app: "leash", t: e.type, agent: e.agentId, ts, ...e.fields, ph: payloadHash });
  if (message.length > 1024) throw new Error("audit message too large; move fields into payload");
  return { message, payloadHash };
}

export class HcsAuditLog implements AuditLog {
  readonly mode = "real" as const;
  constructor(private client: Client, readonly topicId: string, private network: "testnet" | "mainnet" = "testnet") {}

  async append(e: AuditEntry): Promise<AuditReceipt> {
    const { message, payloadHash } = encodeAudit(e);
    const resp = await new TopicMessageSubmitTransaction().setTopicId(TopicId.fromString(this.topicId)).setMessage(message).execute(this.client);
    const rx = await resp.getReceipt(this.client);
    return { topicId: this.topicId, seq: Number(rx.topicSequenceNumber?.toString() ?? 0), payloadHash };
  }

  topicUrl(): string {
    return `https://hashscan.io/${this.network}/topic/${this.topicId}`;
  }
}

export class FakeAuditLog implements AuditLog {
  readonly mode = "fake" as const;
  readonly topicId = "0.0.fake-topic";
  readonly messages: string[] = [];
  async append(e: AuditEntry): Promise<AuditReceipt> {
    const { message, payloadHash } = encodeAudit(e);
    this.messages.push(message);
    return { topicId: this.topicId, seq: this.messages.length, payloadHash };
  }
  topicUrl(): string {
    return "#fake-topic";
  }
}

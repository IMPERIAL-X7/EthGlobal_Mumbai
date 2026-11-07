/**
 * Socket.IO contract: server -> client only. All mutations go through REST.
 * Client joins rooms with: socket.emit("subscribe", { agentId })
 */
export type AgentStatus = "active" | "paused" | "revoked";
export type ApprovalStatus = "pending" | "approved" | "denied" | "expired" | "cancelled";
export type DecisionKind = "AUTO_HOT" | "NEEDS_APPROVAL" | "DENY";

export interface ServerEvents {
  "intent.created": { agentId: string; intentId: string; kind: string; decision: DecisionKind; reasons: string[]; summary: string };
  "approval.pending": {
    agentId: string;
    approvalId: string;
    intentId: string;
    /** Facts only (this is what World App shows). */
    summary: string;
    /** The agent's own words, untrusted: render as "The agent says (unverified)". */
    agentReason?: string | null;
    intentHash: string;
    worldAction: string;
    warnings: string[];
    expiresAt: number;
  };
  "approval.resolved": { agentId: string; approvalId: string; intentId: string; status: ApprovalStatus };
  "payment.settled": { agentId: string; paymentId: string; intentId: string; txId: string; explorerUrl: string; amount: string; asset: string; payTo: string; source: "hot" | "vault" };
  "payment.failed": { agentId: string; intentId: string; error: string };
  "balance.updated": { agentId: string; hot: Record<string, string>; vault: Record<string, string> };
  "audit.appended": { agentId: string; type: string; topicId: string; seq: number };
  "agent.status": { agentId: string; status: AgentStatus };
  "policy.updated": { agentId: string; version: number; hash: string };
  "anomaly.detected": { agentId: string; kind: string; detail: string };
}
export type ServerEventName = keyof ServerEvents;

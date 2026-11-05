/**
 * The capabilities the demo agent has on each side. The SAME agent (same inbox access) is
 * pointed at both wallets; only the approval design differs.
 */
import { LeashAgent, LeashDenied } from "@leash/agent-sdk";
import { defaultPolicy } from "@leash/shared";
import type { Narrator } from "./narrator.ts";

export interface Endpoints {
  legacyUrl: string; // legacy wallet simulator (also hosts the owner's inbox)
  merchantUrl: string; // x402 merchant
}

async function j(method: string, url: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json: any = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

/** Owner's inbox (shared by both sides — the agent has email access, as in the paper). */
export function inboxTools(e: Endpoints) {
  return {
    listInbox: async () => (await j("GET", `${e.legacyUrl}/inbox`)).json as { id: string; from: string; subject: string; read: boolean }[],
    readEmail: async (id: string) => (await j("GET", `${e.legacyUrl}/inbox/${id}`)).json as { id: string; from: string; subject: string; body: string },
  };
}

/** "Typical" agent wallet: caps raised via an emailed code. */
export function legacyWalletTools(e: Endpoints) {
  return {
    pay: (to: string, amount: number, memo?: string) => j("POST", `${e.legacyUrl}/wallet/pay`, { to, amount, memo }),
    requestLimitIncrease: (dailyCap: number) => j("POST", `${e.legacyUrl}/wallet/limits/request`, { dailyCap }),
    confirmLimitIncrease: (code: string) => j("POST", `${e.legacyUrl}/wallet/limits/confirm`, { code }),
  };
}

/** Leash wallet: pays x402 endpoints; can only ASK for higher limits. */
export function leashWalletTools(agent: LeashAgent, n: Narrator) {
  return {
    payForResource: async (url: string) => {
      try {
        const res = await agent.fetch(url, {}, {
          onDecision: (d) => {
            if (d.decision === "auto") n.say("leash", "result", `Leash: within my allowance → paying from hot wallet`);
            if (d.decision === "pending") n.say("leash", "waiting", `Leash: needs the owner's World ID approval (${d.reasons.join(", ")}). Waiting for the human…`, d);
            if (d.decision === "denied") n.say("leash", "blocked", `Leash: denied by policy (${d.reasons.join(", ")})`, d);
          },
          onApproved: () => n.say("leash", "result", "Owner approved on their phone → vault payment co-signed"),
        });
        return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
      } catch (e) {
        if (e instanceof LeashDenied) return { ok: false, status: 403, body: { error: e.message, status: e.status } };
        throw e;
      }
    },
    requestLimitIncrease: async (autoPerPaymentUsdc: number, reason: string) => {
      const units = String(Math.round(autoPerPaymentUsdc * 1e6));
      const policy = { ...defaultPolicy(), autoPerPayment: units, autoDaily: String(Number(units) * 10) };
      try {
        return { ok: true, body: await agent.requestPolicyChange(policy, reason) };
      } catch (e) {
        return { ok: false, body: { error: (e as Error).message } };
      }
    },
  };
}

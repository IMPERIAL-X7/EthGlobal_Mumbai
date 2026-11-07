/**
 * World ID from the browser (IDKit 4, headless): the server signs the request, IDKit opens a
 * bridge request and gives us a connect URL (shown as a QR / copied into the simulator), we poll
 * for the proof and hand it back to the server unchanged. Wiring verified live on staging (Nov 6):
 *  - enroll: IDKit.request({ action, session_id: "create" }).preset(proofOfHuman())
 *  - session (login, approvals): IDKit.proveSession(id, cfg).constraints(CredentialRequest(..., { signal }))
 *    (no action, no preset; the signal binds an approval to one request)
 */
import { CredentialRequest, IDKit, proofOfHuman } from "@worldcoin/idkit-core";

export type WorldParams = {
  app_id: `app_${string}`;
  action?: string;
  environment: "staging" | "production";
  session_id?: string;
  action_description?: string;
  signal?: string;
  rp_context: { rp_id: string; nonce: string; created_at: number; expires_at: number; signature: string };
};

export type WorldRequest = {
  url: string;
  expiresAt: number; // unix seconds; the server's signature dies then
  wait: (signal?: AbortSignal) => Promise<unknown>; // resolves with the IDKit result, rejects with a readable error
};

const NICE: Record<string, string> = {
  user_rejected: "You declined in World App.",
  verification_rejected: "World App declined the request.",
  proof_generation_failed: "The code expired before it was approved. Get a new code and try again.",
  generic_error: "World App couldn't finish. Get a new code and try again.",
  invalid_rp_signature: "This code is no longer valid. Get a new code.",
  rp_signature_expired: "This code expired. Get a new code.",
  timeout: "No answer from World App in time. Get a new code.",
  connection_failed: "Couldn't reach World ID. Check your connection and try again.",
};

export async function openWorldRequest(p: WorldParams): Promise<WorldRequest> {
  const base = { app_id: p.app_id, rp_context: p.rp_context, environment: p.environment, action_description: p.action_description } as any;
  const proving = p.session_id && p.session_id !== "create";
  const req = proving
    ? await (IDKit as any).proveSession(p.session_id, base).constraints(CredentialRequest("proof_of_human", p.signal ? { signal: p.signal } : undefined))
    : await IDKit.request({ ...base, action: p.action!, session_id: "create", allow_legacy_proofs: false }).preset(proofOfHuman());
  return {
    url: req.connectorURI,
    expiresAt: p.rp_context.expires_at,
    wait: async (signal) => {
      const left = Math.max(10, p.rp_context.expires_at - Math.floor(Date.now() / 1000)) * 1000 + 30_000;
      const out = await req.pollUntilCompletion({ timeout: left, signal });
      if (!out.success) {
        const raw = String(req.getDebugReport?.().response_payload ?? "");
        const code = /proof_generation_failed/.test(raw) ? "proof_generation_failed" : String(out.error);
        throw new Error(NICE[code] ?? `World ID error: ${code}`);
      }
      return out.result;
    },
  };
}

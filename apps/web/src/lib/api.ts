/** Same-origin API (Vite proxies /v1 to the Leash server), so the session cookie just works. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/v1${path}`, {
    method,
    credentials: "include",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json?.error ?? "error", json?.message ?? `HTTP ${res.status}`);
  return json as T;
}

export type Modes = { world: "real" | "fake"; hedera: "real" | "fake"; ens: "real" | "fake" };
export const health = () => api<{ ok: boolean; modes: Modes; auditTopic: string }>("GET", "/health");

export const HBAR = "0.0.0";
export const USDC = "0.0.429274";
const DECIMALS: Record<string, number> = { [HBAR]: 8, [USDC]: 6 };
export const assetName = (a: string) => (a === HBAR ? "HBAR" : a === USDC ? "USDC" : a);

/** Smallest units -> "1.23" (2 decimals, more if the amount is tiny so it never shows 0.00 for a real payment). */
export function fmt(units: string | number | undefined, asset = USDC): string {
  const d = DECIMALS[asset] ?? 6;
  const n = Number(units ?? 0) / 10 ** d;
  if (n !== 0 && Math.abs(n) < 0.01) return n.toFixed(4).replace(/0+$/, "");
  return n.toFixed(2);
}

/** Pick the asset to headline for a balance map: USDC if held, else HBAR. */
export function mainAsset(bal: Record<string, string> | undefined): string {
  if (bal && Number(bal[USDC] ?? 0) > 0) return USDC;
  if (bal && Number(bal[HBAR] ?? 0) > 0) return HBAR;
  return USDC;
}

export function ago(unixSec: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unixSec);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function countdown(expiresAt: number, now = Math.floor(Date.now() / 1000)): string {
  const s = Math.max(0, expiresAt - now);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

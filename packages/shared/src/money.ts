/** Integer-only money helpers. Never use floats for amounts. */
export function formatUnits(amount: string | bigint, decimals: number): string {
  const v = BigInt(amount);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

export function parseUnits(value: string, decimals: number): string {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error(`invalid amount: ${value}`);
  const [w, f = ""] = value.split(".");
  if (f.length > decimals) throw new Error(`too many decimals (max ${decimals})`);
  return (BigInt(w!) * 10n ** BigInt(decimals) + BigInt(f.padEnd(decimals, "0") || "0")).toString();
}

export const ASSET_META: Record<string, { symbol: string; decimals: number }> = {
  "0.0.0": { symbol: "HBAR", decimals: 8 },
  "0.0.429274": { symbol: "USDC", decimals: 6 },
};

export function describeAmount(amount: string, asset: string): string {
  const m = ASSET_META[asset] ?? { symbol: asset, decimals: 0 };
  return `${formatUnits(amount, m.decimals)} ${m.symbol}`;
}

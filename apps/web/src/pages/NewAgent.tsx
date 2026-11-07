import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { api, ApiError } from "../lib/api";
import { HBAR, USDC } from "../lib/format";

/**
 * Design 6B: one page, sliders + a live preview of what happens to example payments.
 * Then the one-time "keys" step. Amounts are USDC (6 decimals) in the policy.
 */
const U = 1_000_000;
const EXAMPLES = [
  { label: "0.40 invoice", amount: 0.4, newShop: false },
  { label: "2.50 report", amount: 2.5, newShop: false },
  { label: "0.05, a shop it's never paid", amount: 0.05, newShop: true },
  { label: "60.00 anything", amount: 60, newShop: false },
];

type Created = {
  agent: { id: string; ens_name: string; hot_account: string; vault_account: string };
  secrets: { apiKey: string; agentPrivateKey: string; ownerRecoveryPrivateKey?: string };
};

export function NewAgent() {
  const [name, setName] = useState("shopper");
  const [perPay, setPerPay] = useState(1);
  const [daily, setDaily] = useState(5);
  const [hardMax, setHardMax] = useState(50);
  const [askNew, setAskNew] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  const nameOk = /^[a-z0-9-]{3,32}$/.test(name);
  const dailyFixed = Math.max(daily, perPay);

  const outcome = (amount: number, newShop: boolean) => {
    if (amount > hardMax) return { k: "never", t: "never" } as const;
    if (newShop && askNew) return { k: "ask", t: "asks you" } as const;
    if (amount > perPay || amount > dailyFixed) return { k: "ask", t: "asks you" } as const;
    return { k: "auto", t: "pays itself" } as const;
  };

  const policy = useMemo(
    () => ({
      v: 1,
      autoPerPayment: String(Math.round(perPay * U)),
      autoDaily: String(Math.round(dailyFixed * U)),
      hardMaxPerPayment: String(Math.round(hardMax * U)),
      requireApprovalForNewPayee: askNew,
      allowlist: [],
      blocklist: [],
      allowedAssets: [USDC, HBAR],
      approvalTtlSeconds: 600,
      maxPendingApprovals: 3,
      denyCooldownSeconds: 300,
    }),
    [perPay, dailyFixed, hardMax, askNew],
  );

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      setCreated(await api<Created>("POST", "/agents", { name, policy }));
    } catch (e) {
      const ae = e as ApiError;
      setErr(ae.code === "name_taken" ? `${name}.leash.eth is taken. Try another name.` : ae.code === "chain_unavailable" ? "Hedera testnet isn't answering right now. Try again in a minute." : ae.message);
    } finally {
      setBusy(false);
    }
  };

  if (created) return <Keys c={created} />;

  return (
    <AppShell>
      <div className="newagent">
        <form
          className="na-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (nameOk && !busy) void create();
          }}
        >
          <h1 className="page-title">New agent</h1>

          <label className="field-l" htmlFor="na-name">Name</label>
          <div className={`name-field ${nameOk ? "" : "bad"}`}>
            <input id="na-name" value={name} onChange={(e) => setName(e.target.value.toLowerCase())} autoComplete="off" spellCheck={false} aria-describedby="na-name-help" />
            <span className="name-suffix">.leash.eth</span>
          </div>
          <p id="na-name-help" className="field-help">{nameOk ? "Its public name on ENS. Sellers can look it up." : "3–32 characters: lowercase letters, numbers, dashes."}</p>

          <Slider id="pp" label="Pays on its own up to" value={perPay} min={0.05} max={5} step={0.05} onChange={setPerPay} unit="per payment" />
          <Slider id="dd" label="…and up to, per day" value={dailyFixed} min={Math.max(0.5, perPay)} max={50} step={0.5} onChange={setDaily} unit="a day" />
          <Slider id="hm" label="Never pay more than, even with your approval" value={hardMax} min={5} max={200} step={5} onChange={setHardMax} unit="per payment" />

          <label className="check">
            <input type="checkbox" checked={askNew} onChange={(e) => setAskNew(e.target.checked)} />
            <span>Always ask me before paying a new shop</span>
          </label>

          {err && <p className="form-err" role="alert">{err}</p>}
          <button type="submit" className="btn btn-primary na-submit" disabled={!nameOk || busy}>
            {busy ? "Creating wallets on Hedera…" : "Create agent"}
          </button>
          <p className="field-help">Creates its everyday wallet and its vault on Hedera, and its name on ENS. Changing these limits later needs your World ID.</p>
        </form>

        <aside className="na-preview" aria-live="polite">
          <div className="glow glow-blue" style={{ width: 360, height: 360, left: "auto", right: -140, top: -160 }} aria-hidden="true" />
          <p className="na-pv-k">Live preview</p>
          <p className="na-pv-name">{nameOk ? name : "your-agent"}.leash.eth</p>
          <ul className="na-pv-list">
            {EXAMPLES.map((x) => {
              const o = outcome(x.amount, x.newShop);
              return (
                <li key={x.label} className={`pv pv-${o.k}`}>
                  <span>{o.k === "auto" ? "✓" : o.k === "ask" ? "◐" : "✕"} {x.label}</span>
                  <span>{o.t}</span>
                </li>
              );
            })}
          </ul>
          <p className="na-pv-sum">
            Pays up to <strong>{perPay.toFixed(2)}</strong> at a time on its own, up to <strong>{dailyFixed.toFixed(2)}</strong> a day.
            {askNew ? " A first payment to a new shop always asks you." : ""} Nothing over <strong>{hardMax.toFixed(2)}</strong>, ever. Amounts in USDC.
          </p>
        </aside>
      </div>
    </AppShell>
  );
}

function Slider(p: { id: string; label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  const pct = ((p.value - p.min) / (p.max - p.min)) * 100;
  return (
    <div className="slider">
      <label className="field-l" htmlFor={p.id}>{p.label}</label>
      <input id={p.id} type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} style={{ ["--pct" as any]: `${pct}%` }} />
      <p className="slider-v"><strong>{p.value.toFixed(2)}</strong> USDC {p.unit}</p>
    </div>
  );
}

function Keys({ c }: { c: Created }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const env = [
    `LEASH_API_URL=${location.origin}/v1`,
    `LEASH_AGENT_API_KEY=${c.secrets.apiKey}`,
    `AGENT_ACCOUNT_KEY=${c.secrets.agentPrivateKey}`,
    `AGENT_HOT_ACCOUNT_ID=${c.agent.hot_account}`,
    `AGENT_VAULT_ACCOUNT_ID=${c.agent.vault_account}`,
  ].join("\n");
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([env + "\n"], { type: "text/plain" }));
    a.download = `${c.agent.ens_name.split(".")[0]}.env`;
    a.click();
  };
  const masked = env.replace(/(KEY=)(\S{6})\S+/g, "$1$2••••••••••••••••");
  const [show, setShow] = useState(false);

  return (
    <AppShell>
      <div className="keys">
        <p className="keys-ok">✓ {c.agent.ens_name} created · wallets on Hedera · name on ENS</p>
        <h1 className="page-title" style={{ marginTop: 10 }}>Give these to your agent. You'll only see them once.</h1>
        <p className="lede" style={{ fontSize: 16 }}>They stay with the agent. Even with both keys, it can only spend within your limits: the vault still needs your World ID.</p>
        <div className="code-pane keys-code">
          <div className="ui-card-head">
            <span>.env for your agent</span>
            <span className="keys-actions">
              <button type="button" className="linklike light" onClick={() => setShow((s) => !s)}>{show ? "Hide" : "Show"}</button>
              <button type="button" className="linklike light" onClick={async () => { await navigator.clipboard.writeText(env).catch(() => {}); setCopied(true); }}>{copied ? "Copied" : "Copy"}</button>
              <button type="button" className="linklike light" onClick={download}>Download</button>
            </span>
          </div>
          <pre><code>{show ? env : masked}</code></pre>
        </div>
        <label className="check" style={{ marginTop: 18 }}>
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          <span>I've saved these somewhere safe</span>
        </label>
        <div className="keys-next">
          <div className="kpi">
            <p className="strong" style={{ margin: 0 }}>Fund the vault</p>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 14 }}>Send testnet USDC (or HBAR) to <span className="mono">{c.agent.vault_account}</span>. The everyday wallet <span className="mono">{c.agent.hot_account}</span> starts with a little HBAR.</p>
          </div>
          <div className="kpi">
            <p className="strong" style={{ margin: 0 }}>Connect your agent</p>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 14 }}>Use <span className="mono">@leash/agent-sdk</span> and swap <span className="mono">fetch</span> for <span className="mono">leash.fetch</span>.</p>
          </div>
        </div>
        <Link to={`/app/agents/${c.agent.id}`} className={`btn btn-primary ${saved ? "" : "btn-disabled"}`} aria-disabled={!saved} onClick={(e) => !saved && e.preventDefault()} style={{ marginTop: 24 }}>
          Done, go to {c.agent.ens_name.split(".")[0]}
        </Link>
      </div>
    </AppShell>
  );
}

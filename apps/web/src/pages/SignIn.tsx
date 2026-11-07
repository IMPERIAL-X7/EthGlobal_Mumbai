import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, health, type Modes } from "../lib/api";
import { openWorldRequest, type WorldParams } from "../lib/world";

/**
 * Sign-in, design 4B: story on the left, live World ID code on the right.
 * One button for everyone: a returning browser proves its saved World ID session (login);
 * otherwise we enroll, and the server treats an already-enrolled human as a login.
 */
const SESSION_KEY = "leash.worldSession";

type State =
  | { s: "loading" }
  | { s: "code"; url: string; qr: string; expiresAt: number }
  | { s: "verifying" }
  | { s: "error"; message: string };

export function SignIn() {
  const nav = useNavigate();
  const [modes, setModes] = useState<Modes | null>(null);
  const [st, setSt] = useState<State>({ s: "loading" });
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [copied, setCopied] = useState(false);
  const [useSaved, setUseSaved] = useState(() => !!safeGet(SESSION_KEY));
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    health().then((h) => setModes(h.modes)).catch(() => setSt({ s: "error", message: "Can't reach the Leash server. Is it running?" }));
    api("GET", "/me").then(() => nav("/app", { replace: true })).catch(() => {});
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => {
      clearInterval(t);
      abort.current?.abort();
    };
  }, [nav]);

  const finish = useCallback(
    async (mode: "enroll" | "login", result: unknown) => {
      setSt({ s: "verifying" });
      const r = await api<{ owner: { id: string; sessionId: string }; created: boolean }>("POST", "/auth/world/verify", { mode, result });
      safeSet(SESSION_KEY, r.owner.sessionId);
      nav(r.created ? "/app?welcome=1" : "/app", { replace: true });
    },
    [nav],
  );

  const newCode = useCallback(async () => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setCopied(false);
    setSt({ s: "loading" });
    const saved = useSaved ? safeGet(SESSION_KEY) : null;
    const mode = saved ? "login" : "enroll";
    try {
      const p = await api<WorldParams>("POST", "/auth/world/request", saved ? { mode, sessionId: saved } : { mode });
      const req = await openWorldRequest(p);
      const qr = await QRCode.toDataURL(req.url, { margin: 1, width: 440, color: { dark: "#0e1116", light: "#ffffff" } });
      if (ac.signal.aborted) return;
      setSt({ s: "code", url: req.url, qr, expiresAt: req.expiresAt });
      const result = await req.wait(ac.signal);
      if (!ac.signal.aborted) await finish(mode, result);
    } catch (e) {
      if (!ac.signal.aborted) setSt({ s: "error", message: (e as Error).message });
    }
  }, [finish, useSaved]);

  useEffect(() => {
    if (modes?.world === "real") void newCode();
  }, [modes, newCode]);

  // Fake-chain dev server only: the server plays World App.
  const devSignIn = async () => {
    try {
      const sessionId = safeGet("leash.devSession") ?? `session_dev_${crypto.randomUUID().replace(/-/g, "")}`;
      safeSet("leash.devSession", sessionId);
      const proof = await api("POST", "/dev/world-proof", { action: "leash_enroll", sessionId });
      await finish("enroll", proof);
    } catch (e) {
      setSt({ s: "error", message: (e as Error).message });
    }
  };

  const left = st.s === "code" ? Math.max(0, st.expiresAt - now) : 0;
  const expired = st.s === "code" && left === 0;

  return (
    <div className="signin">
      <aside className="signin-story">
        <div className="glow glow-blue" style={{ left: -160, top: "auto", bottom: -220 }} aria-hidden="true" />
        <Link to="/" className="logo logo-dark">leash<span>.</span></Link>
        <div className="signin-story-body">
          <h1 className="signin-title">Small payments on their own.<br /><strong>Big ones, only with you.</strong></h1>
          <div className="signin-rows" aria-hidden="true">
            <div className="glass-row"><span>✓ 7-day forecast</span><span className="glass-amt">0.05</span></div>
            <div className="glass-row glass-row-warn"><span>◐ Premium report · waiting for you</span><span className="glass-amt">2.50</span></div>
          </div>
        </div>
        <p className="signin-foot">Testnet demo · World ID {modes?.world === "real" ? "staging" : "simulated"}</p>
      </aside>

      <main className="signin-panel">
        <div className="signin-box">
          <h2 className="signin-h">Sign in with World ID</h2>
          <p className="signin-sub">
            {useSaved && safeGet(SESSION_KEY) ? "Welcome back. Scan with World App to continue." : "Scan with World App. New here? This creates your account."}
          </p>

          {modes?.world === "fake" ? (
            <div className="signin-dev">
              <p>This server runs with simulated chains, so there's no real World ID here.</p>
              <button type="button" className="btn btn-primary" onClick={devSignIn}>Continue (dev sign-in)</button>
            </div>
          ) : (
            <>
              <div className={`qr-box ${expired ? "qr-expired" : ""}`}>
                {st.s === "code" && <img src={st.qr} alt="World ID sign-in code. Scan it with World App." width={220} height={220} />}
                {(st.s === "loading" || !modes) && <span className="qr-msg">Getting a code…</span>}
                {st.s === "verifying" && <span className="qr-msg">✓ Approved. Signing you in…</span>}
                {st.s === "error" && <span className="qr-msg qr-err">{st.message}</span>}
                {expired && <span className="qr-overlay">Code expired</span>}
              </div>
              <p className="qr-meta mono" aria-live="polite">
                {st.s === "code" && !expired && `Waiting for World App · code expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`}
                {expired && "This code expired. Get a new one."}
              </p>
              <div className="signin-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={st.s !== "code" || expired}
                  onClick={async () => {
                    if (st.s !== "code") return;
                    await navigator.clipboard.writeText(st.url).catch(() => {});
                    setCopied(true);
                  }}
                >
                  {copied ? "Copied. Paste it in the simulator" : "Copy link for the simulator"}
                </button>
                <button type="button" className="btn btn-ghost" onClick={newCode}>New code</button>
              </div>
              <p className="signin-help">
                No World App? Use the <a href="https://simulator.worldcoin.org" target="_blank" rel="noreferrer">World ID Simulator</a>: paste the link where it asks for a QR code.
                {safeGet(SESSION_KEY) && (
                  <>
                    {" "}
                    <button type="button" className="linklike" onClick={() => setUseSaved((v) => !v)}>
                      {useSaved ? "Use a different World ID" : "Use my saved World ID"}
                    </button>
                  </>
                )}
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function safeGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {}
}

import { Link } from "react-router-dom";
import { FlowDiagram } from "./FlowDiagram";
import { HeroWallet } from "./HeroWallet";
import { RunGrid } from "./RunGrid";
import { PROOF, SOURCES, hashscanTx } from "./data";

export function Landing() {
  return (
    <>
      <div className="testnet-bar">Testnet demo · Hedera testnet, World ID staging, ENS on Sepolia · no real money moves</div>
      <header className="nav">
        <div className="wrap">
          <Link to="/" className="logo">leash<span>.</span></Link>
          <nav className="nav-links" aria-label="Main">
            <a href="#problem">The problem</a>
            <a href="#how">How it works</a>
            <a href="#proof">Proof</a>
            <a href="#developers">Developers</a>
            <Link to="/login" className="btn btn-primary">Sign in with World ID</Link>
          </nav>
        </div>
      </header>

      <main>
        {/* ------------------------------------------------------------ hero */}
        <section className="hero">
          <div className="wrap hero-grid">
            <div className="hero-copy">
              <p className="eyebrow">Human approval for AI agent payments</p>
              <h1>
                Your AI agent can spend money. <em>It shouldn't be able to approve it.</em>
              </h1>
              <p className="lede">
                Small payments go through on their own. Anything bigger, new, or a change to its limits waits for you, and only your World ID can say yes.
              </p>
              <div className="cta-row">
                <Link to="/login" className="btn btn-primary">Put your agent on a leash</Link>
                <a href="#problem" className="btn btn-ghost">See the problem</a>
              </div>
            </div>
            <div className="hero-visual">
              <HeroWallet />
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ context stats (dark glass) */}
        <section className="glass-band" id="problem">
          <div className="glow glow-blue" aria-hidden="true" />
          <div className="glow glow-red" aria-hidden="true" />
          <div className="wrap" style={{ position: "relative" }}>
            <p className="eyebrow glass-eyebrow">Agents already pay on their own</p>
            <h2 className="glass-title">Autonomous payments are here.<br /><strong>Control isn't.</strong></h2>
            <div className="glass-grid">
              <div className="glass-card">
                <p className="glass-num">100M+</p>
                <p className="glass-lbl">x402 agent payments on Base, up from near zero in about three quarters</p>
                <p className="glass-src">Through Q1 2026; much early volume was meme-coin farming · <a href={SOURCES.chainalysis.url}>Chainalysis</a></p>
              </div>
              <div className="glass-card">
                <p className="glass-num bad">65%</p>
                <p className="glass-lbl">of organisations had an AI-agent incident in the past year</p>
                <p className="glass-src"><a href={SOURCES.csa.url}>Cloud Security Alliance</a> · n=418</p>
              </div>
              <div className="glass-card">
                <p className="glass-num bad">35%</p>
                <p className="glass-lbl">reported financial losses from those incidents</p>
                <p className="glass-src"><a href={SOURCES.csa.url}>Cloud Security Alliance</a> · n=418</p>
              </div>
              <div className="glass-card">
                <p className="glass-num">11%</p>
                <p className="glass-lbl">automatically block an agent that acts outside its scope</p>
                <p className="glass-src"><a href={SOURCES.csa.url}>Cloud Security Alliance</a> · n=418</p>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ the problem, measured */}
        <section>
          <div className="wrap">
            <div className="section-head">
              <div>
                <p className="eyebrow">The problem, measured</p>
                <h2>Give an agent a task that costs more than its limit. It raises the limit.</h2>
                <p className="lede">
                  Typical agent wallets let the owner raise limits with a code sent by email. The agent can read that inbox, so the “owner check” is something the agent can pass by itself.
                </p>
              </div>
            </div>
            <div className="selfapprove" aria-label="How a typical agent wallet lets the agent approve its own limit increase">
              <div className="sa-card">
                <div className="sa-head">Wallet · the agent's request</div>
                <div className="sa-body">
                  <p className="sa-k">Daily limit</p>
                  <p className="sa-big mono">1.00 → 5.00 USDC</p>
                  <p className="sa-note">“We sent a confirmation code to the owner's email.”</p>
                </div>
              </div>
              <span className="sa-arrow" aria-hidden="true">→</span>
              <div className="sa-card">
                <div className="sa-head">Inbox · which the agent can read</div>
                <div className="sa-body">
                  <p className="sa-k">From: wallet@provider · just now</p>
                  <p className="sa-subject">Confirm your new spending limit</p>
                  <p className="sa-code mono">482 913</p>
                </div>
              </div>
              <span className="sa-arrow" aria-hidden="true">→</span>
              <div className="sa-card sa-bad">
                <div className="sa-head">Wallet · code entered by the agent</div>
                <div className="sa-body">
                  <p className="sa-done">✓ Limit raised to 5.00 USDC</p>
                  <p className="sa-note">Payment sent: 1.20 USDC</p>
                  <p className="sa-k">No human saw any of it.</p>
                </div>
              </div>
            </div>
            <div className="sa-leash">
              <span className="chip chip-good">On Leash</span>
              <span>The same request waits for a World ID proof from the owner's phone. There's no code to read, so nothing in the agent's reach can approve it.</span>
            </div>
            <RunGrid />
          </div>
        </section>

        {/* ------------------------------------------------------------ how it works */}
        <section className="rule-top band" id="how">
          <div className="wrap">
            <div className="section-head">
              <div>
                <p className="eyebrow">How Leash works</p>
                <h2>Automatic when it's small. You, when it's not.</h2>
                <p className="lede">Your agent pays for small things on its own. Anything big, new or unusual waits for you, and only you can approve it, with World ID on your phone.</p>
              </div>
            </div>
            <FlowDiagram />
          </div>
        </section>

        {/* ------------------------------------------------------------ proof */}
        <section id="proof">
          <div className="wrap">
            <div className="section-head">
              <div>
                <p className="eyebrow">Not a mockup</p>
                <h2>Running live on three networks.</h2>
                <p className="lede">Every link below is a real testnet record from our end-to-end runs.</p>
              </div>
            </div>
            <div className="proofs">
              <article className="proof">
                <div className="top">
                  <span className="chip chip-neutral">World ID 4.0</span>
                  <h3 style={{ marginTop: 12 }}>The owner is a person, proven each time</h3>
                  <p>Sign-up, sign-in and every approval are World ID proofs. Each approval proof is bound to one payment and can't be replayed.</p>
                </div>
                <div className="rows">
                  <div><span>Account</span><span>World ID session</span></div>
                  <div><span>Approval proof</span><span>bound to one payment</span></div>
                  <div><span>Replay of a used proof</span><span className="chip chip-good">Rejected</span></div>
                </div>
                <div className="foot">Tested live on World ID staging with the simulator</div>
              </article>
              <article className="proof">
                <div className="top">
                  <span className="chip chip-neutral">Hedera · x402</span>
                  <h3 style={{ marginTop: 12 }}>Money moves only within your rules</h3>
                  <p>Hot wallet for small automatic payments; a 2-of-3 vault the agent can't empty alone. Paid through a public x402 facilitator.</p>
                </div>
                <div className="rows">
                  <div><span>Owner-approved, from vault</span><a className="mono" href={hashscanTx(PROOF.vaultTx)}>view on HashScan</a></div>
                  <div><span>Automatic, from hot wallet</span><a className="mono" href={hashscanTx(PROOF.hotTx)}>view on HashScan</a></div>
                  <div><span>Audit log (append-only)</span><a className="mono" href={`https://hashscan.io/testnet/topic/${PROOF.auditTopic}`}>topic {PROOF.auditTopic}</a></div>
                </div>
                <div className="foot">Hedera testnet</div>
              </article>
              <article className="proof">
                <div className="top">
                  <span className="chip chip-neutral">ENSv2</span>
                  <h3 style={{ marginTop: 12 }}>Every agent has a name sellers can check</h3>
                  <p>Status, limits and wallets are public ENS records only Leash can write. Revoke the agent and its name says so within seconds.</p>
                </div>
                <div className="rows">
                  <div><span>Parent name</span><a className="mono" href={`https://sepolia.app.ens.domains/${PROOF.ensParent}`}>{PROOF.ensParent}</a></div>
                  <div><span>Records</span><span className="mono">leash.status · policy · hot · vault</span></div>
                  <div><span>Revoked agent</span><a className="mono" href={`https://sepolia.app.ens.domains/${PROOF.ensSample}`}>{PROOF.ensSample}</a></div>
                </div>
                <div className="foot">ENSv2 on Ethereum Sepolia</div>
              </article>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ developers */}
        <section className="rule-top" id="developers">
          <div className="wrap">
            <div className="section-head">
              <div>
                <p className="eyebrow">For developers</p>
                <h2>One line in your agent.</h2>
                <p className="lede">Swap <span className="mono">fetch</span> for <span className="mono">leash.fetch</span>. Paid endpoints (x402) are handled; Leash decides, you approve when it matters.</p>
              </div>
            </div>
            <div className="code-split">
              <div className="code-pane">
                <div className="ui-card-head"><span>agent.ts</span><span>@leash/agent-sdk</span></div>
                <pre><code>
<span className="tok-k">import</span> {"{ LeashAgent }"} <span className="tok-k">from</span> <span className="tok-s">"@leash/agent-sdk"</span>;{"\n\n"}
<span className="tok-k">const</span> leash = <span className="tok-k">new</span> LeashAgent({"{"}{"\n"}
{"  "}apiKey: process.env.LEASH_API_KEY,{"\n"}
{"  "}agentPrivateKey: process.env.AGENT_KEY, <span className="tok-c">// never leaves the agent</span>{"\n"}
{"  "}hotAccount: <span className="tok-s">"0.0.11343222"</span>,{"\n"}
{"  "}vaultAccount: <span className="tok-s">"0.0.11343223"</span>,{"\n"}
{"}"});{"\n\n"}
<span className="tok-c">// pays if the API answers 402, under your rules</span>{"\n"}
<span className="tok-k">const</span> res = <span className="tok-k">await</span> leash.fetch(<span className="tok-s">"https://weather.pro/report/premium"</span>);
                </code></pre>
              </div>
              <div className="code-pane">
                <div className="ui-card-head"><span>what happens</span><span>live log</span></div>
                <pre><code>
<span className="tok-c">→ 402 Payment Required: 2.50 USDC to 0.0.6001</span>{"\n"}
leash decision: <span className="tok-n">pending</span> (new payee, over auto-limit){"\n"}
<span className="tok-c">… owner notified, World App shows:</span>{"\n"}
<span className="tok-s">  "Pay 2.50 USDC to 0.0.6001 for weather.pro"</span>{"\n"}
owner approved with World ID → <span className="tok-n">approved</span>{"\n"}
vault transfer signed by agent + Leash (2-of-3){"\n"}
<span className="tok-k">paid</span> 2.50 USDC from vault{"\n"}
<span className="tok-c">  tx 0.0.7162784@1793987034.078590210</span>{"\n"}
<span className="tok-c">← 200 OK</span>
                </code></pre>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ CTA */}
        <section className="band">
          <div className="wrap" style={{ display: "flex", flexWrap: "wrap", gap: 32, alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h2>Keep your agent. Keep the last word.</h2>
              <p className="lede" style={{ marginTop: 12 }}>Sign in with World ID, set limits, connect your agent. About two minutes.</p>
            </div>
            <div className="cta-row" style={{ marginTop: 0 }}>
              <Link to="/login" className="btn btn-primary">Sign in with World ID</Link>
              <a href="#proof" className="btn btn-ghost">See it running live</a>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap">
          <div className="cols">
            <div>
              <Link to="/" className="logo">leash<span>.</span></Link>
              <p style={{ maxWidth: 320 }}>Human approval for AI agent payments. Built at ETHGlobal Mumbai.</p>
            </div>
            <div>
              <h4>Built on</h4>
              <ul>
                <li>World ID: proof the owner is a real, unique person</li>
                <li>Hedera: payments, 2-of-3 vaults, audit log</li>
                <li>x402: the HTTP payment standard agents speak</li>
                <li>ENSv2: names and records for every agent</li>
              </ul>
            </div>
            <div>
              <h4>Project</h4>
              <ul>
                <li><a href="https://github.com/IMPERIAL-X7/EthGlobal_Mumbai">GitHub</a></li>
                <li><a href={SOURCES.eval.url}>Experiment results</a></li>
              </ul>
            </div>
          </div>
          <div className="sources">
            Sources: <a href={SOURCES.chainalysis.url}>{SOURCES.chainalysis.label}</a> · <a href={SOURCES.csa.url}>{SOURCES.csa.label}</a> · <a href={SOURCES.eval.url}>{SOURCES.eval.label}</a>
          </div>
        </div>
      </footer>
    </>
  );
}

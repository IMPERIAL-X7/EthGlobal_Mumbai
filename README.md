# Leash — human approval an AI agent can't fake

> Working name. "Countersign" was our first choice, but the Cornell/Yale researchers already use it for their prototype, so it's out.
> ETHGlobal Mumbai, Nov 2026. Targets: World (Agent Pass) · Hedera (x402 agent payments) · ENS (ENSv2).

**One line:** an AI agent can spend small amounts by itself. Anything larger, and any change to its own limits, moves only when the **owner** approves **that exact payment** on **their own phone**. A second key co-signs, and every decision is written to a public log.

This README is written as an honest pitch. It covers the problem, the evidence for it, the evidence *against* it mattering, who already solves it, and where we fit.

---

## 1. The problem in one paragraph

Agents that pay for things (x402, Circle Agent Wallets, Coinbase AgentKit, MoonPay PayBox) protect users with **spending caps plus "human approval" to raise them**. On **Nov 1, 2026**, researchers from Cornell Tech, Yale and IC3 published *Inalienable Human-in-the-Loop* and showed this approval is often fake. They gave agents a Circle wallet, an inbox and a browser. **9 of 10 models raised their own spending cap** by reading the one-time approval code from the inbox, and nobody attacked them to make it happen. With a forged "owner" email, **5 of 10 models paid an attacker**. The paper's point is that an approval only counts if it comes through a channel the agent can't reach, and if it covers the action the human actually saw. By that standard the paper says email codes, SMS, authenticator apps and push approvals all fail, and so does **the World app as currently used**, because the World ID proof doesn't cover what the human was shown.

> "Most agent payment systems verify that an approval was received, but not necessarily that a human actually authorized it." (Anthony Anzalone, Verona, via CoinDesk)
>
> "Telling people not to connect their email won't hold, because they'll connect everything if it saves them time." (Markus Levin, XYO)

The client SDKs for x402, the most widely used agent payment protocol, also shipped with **no default spending cap** until Aug 2026 (V12 audit). A hostile API could request the wallet's entire balance.

---

## 2. Is this a real problem? Evidence for and against

### Evidence that it's real
| Evidence | Strength |
|---|---|
| The attack was reproduced on **mainnet with real USDC** across 10 models, in a peer-authored paper with named authors (Juels, Zhang et al.) | Strong: the mechanism is proven |
| Circle's response was a documentation warning, not a product fix | Medium: the gap is still open at a market leader |
| Cloud Security Alliance 2026 survey of 340 financial institutions: **85%** expect agents to start payments, and **65%** say that needs a **new authorization model** | Medium (reported secondhand) |
| Visa/Morning Consult 2026: consumers will let AI *compare* products but not *make the final purchase* | Medium: trust is the stated blocker |
| An HBR survey reports only about 6% of companies fully trust AI agents with consequential decisions | Medium |
| Incumbents are building exactly this: PayBox (per-action passkey approvals), Circle (policy wallets), CDP (spending rules) | Strong signal of demand, and also a sign of competition |

### Evidence against, which critics *will* raise
| Counter-evidence | What it means for us |
|---|---|
| **Real agent spend on x402 is tiny.** TRM Labs (Sep 2026): of $52.7M settled, only 0.6–7.5% is plausibly agent-driven, a 2026 run-rate of about **$5–11k per month** | Today's money at risk is small. This is a **bet on where things are going**, not a fix for current losses. |
| In the paper's tests the amounts were cents, and in the benign case the agent paid the **user's own** invoices | "Agent raised its cap" ≠ "user lost money". The attacker case is the one that matters. |
| The attack needs the user to have given the agent inbox access | Critics: "just don't do that". The paper's answer (and ours): agents reach inboxes through browser sessions and saved credentials anyway, and users will connect everything for convenience. |
| **MoonPay PayBox already does per-action passkey approval** and needs a passkey to change limits | "Nobody solves this" is false. We have to say clearly how we differ (§4). |

### Our honest verdict
- **The mechanism is real and now proven publicly**. This isn't a made-up problem.
- **The market is early.** Very little money is at risk today, so this is infrastructure for the near future.
- **The demand signal is credible.** Institutions say they need a new authorization model, and the incumbents' building it confirms the need.
- **It is *not* a mass-consumer "must-have" today.** Consumers don't buy security until they've been burned. The realistic buyer is whoever runs agents with real budgets, plus the platforms and services those agents pay.

---

## 3. Who has this problem, and why would they adopt?

| Who | Their pain | Why they'd use Leash | Honest reservation |
|---|---|---|---|
| **Teams running agents with a budget** (research agents buying data, ops agents buying compute/APIs) | Finance won't sign off on "the bot has a card" without provable controls | Small spends run on their own; large ones need a provable human sign-off with a tamper-evident audit trail, which is what auditors ask for | Many teams will just use Circle or Coinbase policies and accept the risk |
| **Agent platforms and wallet providers** (the B2B buyers) | One headline like "your agent paid a scammer" damages the brand | An open, embeddable approval layer they don't have to design themselves | Big players build in-house (PayBox, Circle) |
| **APIs and merchants selling to agents** (x402 sellers) | Can't tell whether a human stands behind the agent; free tiers get farmed by bots; refund disputes | Can require a **verifiable approval receipt** on large payments and cap free tiers **per human, not per wallet** | Needs sellers to adopt it, which is a chicken-and-egg problem |
| **Power users running personal agents** | Fear of a drained wallet | Peace of mind, a kill switch | Will tolerate risk until the first loss; approval fatigue |

**Where the incentive is strongest:** with organisations and platforms that face **audit, liability or reputation** risk. Payments regulators already require this pattern for humans: EU PSD2's "dynamic linking" says a payment's authentication must be tied to its **exact amount and payee**. Leash brings that rule to agent payments. That's our most defensible framing.

---

## 4. What exists already, and where we differ

| Product | Per-action human approval | Agent can't reach the approval channel | Approval tied to the exact payment | Enforced by keys onchain (not just a server) | Public, checkable audit trail | Unique human (anti-sybil) | Open source / self-host |
|---|---|---|---|---|---|---|---|
| Circle Agent Wallets | ⚠️ email code for limit changes | ❌ (shown in the paper) | ❌ | ⚠️ wallet-layer policy | ❌ | ❌ | ❌ |
| Coinbase CDP / AgentKit spend rules | ⚠️ | depends on setup | ❌ | ⚠️ | ❌ | ❌ | partly |
| **MoonPay PayBox** | ✅ passkey | ✅ | ✅ single action | ✅ split key (they say) | ❌ | ❌ | ❌ |
| World human-in-the-loop SDK (raw) | ✅ | ✅ | ⚠️ the developer must bind it | ❌ | ❌ | ✅ | ✅ |
| Safe + Zodiac Roles | ✅ (multisig) | ✅ | ✅ | ✅ | ✅ (onchain) | ❌ | ✅ (not agent/x402 aware) |
| Researchers' Countersign prototype | ✅ | ✅ (hardware attestation) | ✅ | ❌ | ❌ | ❌ | ✅ |
| **Leash (ours)** | ✅ World ID | ✅ | ✅ intent hash | ✅ Hedera 2-of-2 threshold key | ✅ HCS log + receipts | ✅ | ✅ |

**Our real differentiation, not inflated:**
1. **Seller-checkable approval receipts.** Every large payment carries the intent hash, the World proof, the nullifier and a log reference. Any third party can verify that a human approved this exact payment. PayBox keeps that inside its own system.
2. **Open and not tied to one vendor.** It's a reference implementation anyone can self-host, not a feature locked inside one wallet.
3. **The server alone can't spend.** Thanks to the 2-of-2 key, compromising our server alone doesn't let anyone move vault funds.
4. **Per-human limits.** World ID lets a seller say "one free tier per human". A passkey can't do that, because one person can create many passkeys.

**Where we are *not* better:** PayBox is a polished, shipping product with card rails and big LLM integrations. A determined team could build our core in a week, so our moat as a product is thin. The lasting value is (1), the seller-checkable approval receipt, *if* it became a standard.

---

## 5. How it works

```
 Agent ──x402 request──▶ Leash policy engine (small, deterministic, never reads emails or web pages)
                           │
            under budget ──┼──▶ pay from HOT wallet (holds only today's allowance) ──▶ HCS log
                           │
  over budget / new payee ─┼──▶ freeze intent {payee, amount, token, endpoint, expiry, id}
  or limit change          │      h = hash(intent)
                           │      World ID request: action = "pay:" + h
                           ▼
                Owner's phone (World App): fresh login + proof
                           │
                           ▼
       Backend checks: proof valid · sub == owner · action == stored h · nullifier unused · not expired
                           │
                           ▼
       Server co-signs ──▶ VAULT (Hedera 2-of-2 threshold key: agent + server) ──▶ settled ──▶ HCS log + receipt
```

| Threat | What stops it | Why it holds |
|---|---|---|
| Agent approves itself | Needs a zero-knowledge proof from the owner's World ID | Proof can't be forged without the secret, and the secret is on the owner's phone |
| A stranger approves (attacker's own World ID) | `sub` must equal the enrolled owner | Signed login token from World |
| Approve $5, spend $500 | We execute only the frozen intent whose hash is in `action` | Hash collision resistance |
| Reuse an approval | Nullifier stored with a uniqueness constraint; id and expiry inside the intent | Same proof → same nullifier → rejected |
| Many small payments to get around the threshold | Running daily total; the hot wallet only *holds* the allowance | Arithmetic, and the funds aren't there |
| Our server is compromised | 2-of-2 vault key; public log | The server can't spend alone, and misuse is publicly visible |
| The human approves something bad | Plain-language intent, ENS name for the payee, warning on first-time payees | **Not solvable.** We support the decision; we don't make it |

**Trust we still require (stated openly):**
- World's list of verified humans and its verifier are honest and correct.
- The owner's phone isn't controlled by the agent.
- The approval page shows the stored intent truthfully. It's open source and re-checks the hash in the browser, but the World App itself does **not** show our payment details. That's a remaining gap from the paper.

---

## 6. The hard questions a critic will ask, with our answers

**"Agent spending is about $10k a month. Why does this matter now?"**
Fair. Low volume is partly *caused* by the trust gap: Visa's data shows consumers won't hand over the final purchase decision. Controls usually have to exist before budgets get handed over. If agents never get real budgets, this stays niche. We accept that risk.

**"MoonPay PayBox already does this."**
For PayBox users inside PayBox, mostly yes. We're open, self-hostable, enforced by keys onchain, and we give *sellers* a receipt they can verify. If we pitched "first to solve it", we'd deserve to lose.

**"Isn't this just 2FA?"**
No. 2FA codes are exactly what the agent stole. The difference is **(a)** a channel the agent can't reach and **(b)** an approval tied to one exact payment, so it can't be reused or swapped.

**"Won't approval fatigue make humans click yes to everything?"**
Yes, if thresholds are too low. Approvals have to be rare: only above budget, for new payees, or for limit changes. That's a tuning problem, and we show the default policy in the demo.

**"Why World ID instead of a passkey?"**
For the owner's own approval, a passkey would work about as well, and the approval backend is pluggable. World adds **unique-human** guarantees for sellers and per-human limits. Critics will note World's Orb coverage is limited and it has faced regulatory pushback in several countries. That's another reason to keep the backend pluggable.

**"You moved trust from the agent to your server."**
Partly. But we moved it from an unpredictable component that reads attacker text all day to roughly 300 lines of deterministic code that **can't spend alone** (2-of-2) and **leaves public evidence** (HCS).

**"Who pays you?"**
If it were a business: platforms per approved transaction or per seat, and sellers for receipt verification. We haven't validated willingness to pay. This is a hackathon prototype.

---

## 7. Scorecard

| Question | Score | Why |
|---|---|---|
| Is the problem real? | **High** | Proven on mainnet, published this week |
| Is it common *today*? | **Low–Medium** | Few agents hold real money yet |
| Is it becoming common? | **Medium–High** | Institutions say they need a new authorization model; incumbents are shipping it |
| Incentive for consumers | **Low–Medium** | Valued after a loss, not before |
| Incentive for businesses and platforms | **Medium–High** | Audit, liability and reputation risk; mirrors PSD2-style rules |
| Differentiation | **Medium** | Seller-checkable receipts + onchain enforcement + open source; the core can be copied |
| Fit for this hackathon (tracks, demo, timeliness) | **High** | Matches World, Hedera and ENS requirements nearly line by line; live attack replay |

**Bottom line:** we are solving a real, newly proven weakness, early, in a market incumbents are already validating. We can defend it honestly as **"the open, checkable version of human approval for agent payments"**. We can't defend it as "a consumer problem everyone has today" or "something nobody else does".

---

## 8. Hackathon scope
- **World, Agent Pass:** request → completion → backend verification → protected payment. Denied, expired and cancelled requests move no money. Checks run only on the backend. Integration debrief included.
- **Hedera, x402:** an x402 endpoint on testnet, with autonomous payments under budget. Extras: spending controls, approval above a threshold, HCS audit log, HTS token, Agent Kit, threshold-key vault.
- **ENS, ENSv2:** each agent is a subname of its owner (`researcher.alice.eth`); policy lives in its records; expiring or revoking the subname disables the agent.
- **Demo:** a split screen. A typical wallet's agent steals the email code and pays an attacker; the Leash agent tries the same and the owner's phone gets the request instead.

## Sources
- CoinDesk, *AI agents bypassed crypto spending limits…* (Nov 1, 2026): https://www.coindesk.com/tech/2026/11/01/ai-agents-bypassed-crypto-spending-limits-without-human-approval-researchers-find-in-a-new-test
- The Defiant via Cryptonews, paper details: https://cryptonews.net/news/blockchain/33657573/
- x402 SDK flaws (V12, via AgentBeam): https://agentbeam.com/blog/x402-sdk-critical-flaws-agent-wallet-spending-cap-v12
- TRM Labs, *Who's actually paying?*: https://www.trmlabs.com/trm-tech-blog/whos-actually-paying-measuring-ai-agent-payments-onchain
- MoonPay PayBox: https://www.moonpay.com/newsroom/moonpay-paybox · https://theblock.co/post/410032/moonpay-paybox-chatgpt-claude
- Visa agentic commerce readiness: https://thepaypers.com/payments/news/visa-research-maps-consumer-and-business-readiness-for-agentic-commerce
- HBR survey via Fortune: https://fortune.com/2025/12/09/harvard-business-review-survey-only-6-percent-companies-trust-ai-agents/
- CSA financial services survey (secondhand): https://dev.to/kavinkimcreator/72-of-enterprises-think-they-control-their-ai-ask-them-what-their-agents-are-spending-5bcm
- World human-in-the-loop SDK: https://docs.world.org/agents/human-in-the-loop/integrate.md · step-up auth: https://auth.world.org/docs/guides/step-up
- Hedera x402: https://docs.hedera.com/solutions/ai/x402

# Leash: what the website shows (frontend content spec)

This file says **what each page shows and why**, not how it looks. Visual direction is settled separately (Mercury calm + Ramp policy cards + Rabby "what will happen" approvals + Vercel live log).
Every item lists its data source (REST `/v1/...` or socket event; see [BACKEND_PLAN §6](BACKEND_PLAN.md)) and its priority for the Sat 09:00 IST deadline.

Priority: **P0** = the demo breaks without it · **P1** = judges notice if missing · **P2** = only if time is left.

---

## 0. Who visits, and what each must leave with

| Visitor | Arrives from | Must understand / do within… | Leaves with |
|---|---|---|---|
| **Judge / curious visitor** | Submission link, booth | **10 s**: what Leash is. **60 s**: why existing wallets fail. **3 min**: watch it work | "Agents can't approve their own spending here, and I saw proof" |
| **Owner** (a human running an AI agent) | Landing → "Get started" | Sign in, create an agent, fund it, set limits, approve or deny payments | An agent that pays small things alone and asks for big things |
| **Agent developer** (often the same person) | Agent page → "Connect your agent" | Paste 3 env vars, call `leash.fetch()` | A working integration in under 5 minutes |
| **Merchant / auditor** | A receipt link | Check that a payment was really approved by a human | Trust without an account |

**Critical constraint.** The person approving payments must never need anything the agent can reach: no email codes, no SMS, no passwords typed into a page the agent controls. That is the whole product, and every flow below is checked against it.

---

## 1. Site map

```
/                      Landing (public)                     P0
/how-it-works          Technical deep dive (public)         P1  (can be a landing section instead)
/demo                  Split-screen live demo (public)      P0
/login                 Sign in with World ID                P0
/app                   Dashboard: agents + pending approvals P0
/app/agents/new        Create agent (wizard)                P0
/app/agents/:id        Agent detail (tabs below)            P0
   ├─ Overview         balances, today's spend, status
   ├─ Activity         live feed
   ├─ Policy           limits + edit (needs World ID)
   ├─ Connect          SDK snippet, rotate key
   └─ Audit            HCS log, HashScan links, CSV
/app/approvals/:id     Approval screen (phone-first)        P0
/r/:id                 Public receipt (no login)            P1
```

Global nav once signed in: **Agents · Approvals (badge with count) · Demo · Sign out**. A pending-approval badge lives on every page, because a missed approval is a failed payment.

---

## 2. Landing page `/` (the "about us": sell the problem first)

Goal: a judge who reads only this page should get the problem, the fix and the proof. **No jargon above the fold**: no x402, HCS, KeyList or nullifier. Those go in "How it works".

### 2.1 Hero (P0)
- **Headline:** "Your AI agent can spend money. It shouldn't be able to approve it."
- **Sub:** "Leash lets agents pay for small things on their own, and makes anything bigger wait for *you*, proven with World ID, which the agent can't fake, read or forward."
- **Buttons:** `Watch the 60-second demo` (→ /demo) · `Get started` (→ /login)
- **Visual:** the approval card on a phone ("Pay 2.50 USDC to weather-pro.leash.eth · first time paying this address · Approve with World ID"). This is the product's hero moment, so show it immediately.

### 2.2 The problem (P0): why today's agent wallets fail
Three short beats with one icon each:
1. **Agents now hold wallets.** x402 lets an agent pay any API per request, with no human at checkout.
2. **"Human approval" today means a code in your email or SMS.** The agent usually has access to your inbox.
3. **So the agent approves itself.** Cornell/Yale/IC3 (Nov 2026) showed agents raising their own spending caps by reading the confirmation code.

### 2.3 Evidence (P0): our own test, honestly framed
Show the eval table from [eval-results/SUMMARY.md](../eval-results/SUMMARY.md) as a simple two-column comparison:

> **We gave 7 AI models (Claude, Gemini, Gemma, GPT-oss, Qwen) the same inbox and the same task: "pay these 3 invoices", with a limit too low to pay them all.**
> On a typical code-by-email wallet, **every model that finished a run approved its own limit increase** (20 of 21 runs).
> On Leash: **0 of 45** runs moved money or changed limits without the owner.

Caveats line, in small text, which must stay: "Small samples (2–6 runs per model). Forged-email attacks didn't fool any model in our test; the failure is self-approval, not phishing. Raw data in the repo."
*Why keep the caveats:* judges are critics. Overclaiming loses more than it gains.

### 2.4 How Leash works: 3 steps, plain language (P0)
1. **Small payments go through on their own.** Under your limit, to payees you know → paid instantly from a small "spending" wallet.
2. **Big or unusual ones wait for you.** New payee, over your limit, or over today's budget → your phone shows exactly what will be paid; you approve with World ID.
3. **Your limits are protected the same way.** The agent can *ask* for higher limits; only you can approve them. Pausing is one tap.

### 2.5 Why World ID and not just a password or 2FA? (P1, small FAQ)
- "An agent with your laptop can read your email, your SMS sync and your password manager. It can't produce a World ID proof: that comes from your World App and is bound to you."
- "Every approval is bound to the exact payment (amount, payee, expiry). A proof for 2.50 USDC can't be reused for 250."
- Honest limit: "If someone steals your phone *and* unlocks World App, they can approve. Leash moves the trust from 'whoever reads your inbox' to 'you, in person'."

### 2.6 Who it's for (P1)
- People running personal agents that shop, book or buy data.
- Teams giving agents a budget (like corporate cards, but for agents).
- API sellers who want proof that a human approved big payments (receipts).

### 2.7 Built on (P1): partner logos with one line each
- **World ID**: the human proof for every approval and every limit change.
- **Hedera**: agent payments over x402, a 2-of-3 multisig vault, and a tamper-proof audit log (HCS).
- **ENS**: every agent gets a name (`shopper.leash.eth`) that shows whether it's active, paused or revoked.

### 2.8 Footer
GitHub repo · Demo video · "Built at ETHGlobal Mumbai 2026" · AI-use attribution link (required by rules).

---

## 3. Sign in `/login` (P0): the account IS the World ID

**What it shows**
- One button: **Sign in with World ID**. No email, no password.
- One line explaining why: "No email or password, because those are exactly what an AI agent can read."
- Help text: "Don't have World App? [Get it] · Testing? Use the [World ID simulator]" (we run `staging` for the hackathon).

**Flow:** `POST /auth/world/request` → IDKit widget (QR on desktop, deep link on phone) → `POST /auth/world/verify` → `/app`.
First sign-in = account creation (enroll). Same World ID later = same account.

**States to design:** waiting for scan · success · proof rejected ("this World ID couldn't be verified, try again") · World App not installed.

**Critical note.** World ID sign-in means one human = one account. Good for us: the agent can't create a second "owner" account to approve itself.

---

## 4. Dashboard `/app` (P0)

**Top: "Waiting for you"**, the pending approvals across all agents (`GET /approvals`, live via `approval.pending` / `approval.resolved`).
Each row: agent name · what · amount · countdown ("expires in 8:12") · **Review** button.
Empty state: "Nothing waiting. Your agents are within their limits." ✓

**Below: Your agents** (`GET /me` → `agents[]`), one card each:
- Name + ENS (`shopper.leash.eth`) + status pill (Active / Paused / Revoked)
- Today: "0.35 of 1.00 USDC auto-budget used" (progress bar)
- Balances: Spending wallet · Vault
- Last activity: "2 min ago: paid 0.05 USDC to forecast API (auto)"
- Quick action: **Pause** (instant, no World ID; making things *safer* never needs a proof)

Empty state (first visit): a single big card: "Create your first agent. It gets a name, a wallet and limits you control." → `/app/agents/new`.

---

## 5. Create agent `/app/agents/new` (P0): 4-step wizard

### Step 1: Name it
- Input: `shopper` → preview "shopper.leash.eth".
- Validation: lowercase letters, numbers, dashes; taken names rejected.

### Step 2: Set its limits (the "permissions"), shown before creation
Presets as three cards, then editable:

| Preset | Auto-pay per payment | Auto budget per day | Hard max (never, even with approval) |
|---|---|---|---|
| **Cautious** | 0.10 USDC | 1 USDC | 50 USDC |
| **Balanced** (default) | 1 USDC | 10 USDC | 200 USDC |
| **Custom** | … | … | … |

Plus toggles: **Ask me before paying anyone new** (on by default) · approval timeout (10 min) · allowlist / blocklist (P2).
Always show the plain-English summary: *"Without asking you, shopper can spend up to 1 USDC per payment and 10 USDC per day, only to payees you've approved before. Anything else waits for your World ID."*

`POST /agents` already accepts `{ name, policy }` (it falls back to `defaultPolicy()` when `policy` is omitted), so the wizard sends the chosen limits in the same request. Setting the *first* policy at creation is safe because the owner is signed in with World ID.

### Step 3: Save the keys (shown once)
`POST /agents` returns `secrets` once. Show them with copy and download buttons:
- **Agent API key + agent private key** → "Put these in your agent's environment." Show a `.env` snippet.
- **Recovery key** → "Your backup key for the vault. Store it offline. With it, you can recover funds even if Leash disappears."
- The user must tick **"I saved these"** before continuing. Downloading a `.txt` counts.

> **Critical issue.** Today the server generates the agent's private key and sends it to the browser. A critic will ask, "so Leash saw the agent key?" Better: **generate the agent key and the recovery key in the browser** and send only the public keys. Recommended if time allows (P1); otherwise state it honestly in the README as a hackathon shortcut.

### Step 4: Fund it
- Shows the **vault account** (and the spending wallet) with a copy button and QR.
- Links: Hedera testnet faucet, Circle USDC faucet.
- Live balance updates (`balance.updated`), with a "Waiting for funds…" spinner until the first deposit.
- Fake mode: a **"Add test funds"** button (`POST /dev/fund`).
- Explain the two wallets in one line: "Your agent spends small amounts from the **spending wallet**. Bigger payments come from the **vault**, which needs your approval *and* Leash's signature."
- **Finish** → agent page, Connect tab.

---

## 6. Agent page `/app/agents/:id` (P0)

Header: name · ENS · status · **Pause / Resume** · **Revoke** (danger zone, confirm dialog; P1).

### 6.1 Overview tab (P0)
- Balances: spending wallet / vault (`GET /agents/:id` → balances; live `balance.updated`).
- Today: auto-spend used vs budget; payments today; pending approvals for this agent.
- Policy summary sentence (same as the wizard), with an **Edit limits** link.
- ENS card (P1): `shopper.leash.eth` with its public records (status, policy hash, audit topic). "Merchants can look this up to check your agent is legit."

### 6.2 Activity tab (P0): the live feed
One row per payment request (`GET /agents/:id/activity`; live `intent.created`, `payment.settled`, `payment.failed`, `approval.*`):

| Time | What | Amount | Decision | Result |
|---|---|---|---|---|
| 14:02 | forecast API `/forecast` | 0.05 | ✓ Auto (within limits) | Paid · HashScan ↗ |
| 14:05 | weather-pro `/report/premium` | 2.50 | ⏳ Waiting for you (new payee, over 1.00 limit) | — |
| 14:06 | 0.0.6666 `/attacker/data` | 0.02 | ⛔ Denied by you | — |
| 14:07 | **Limit change requested by agent** 0.10 → 5.00 | — | ⛔ Denied | — |

Decision reasons are always shown in words. Each row expands to: full intent, intent hash, approval proof status, transaction ID.
**Anomaly banner** (`anomaly.detected`): "A payment left the spending wallet without going through Leash", with a Pause button. P1.

### 6.3 Policy tab (P0)
- Current limits as editable fields, plus the summary sentence.
- **Save** → `PUT /agents/:id/policy` → this creates an approval → the user approves with World ID (same approval screen).
- Explain on the button: "Changing limits needs your World ID, so your agent can't raise its own."
- **Requests from your agent**: pending `POLICY_CHANGE` approvals created by the agent ("shopper asks to raise the auto limit to 5 USDC: 'need to pay invoices'"), with Approve / Deny.
- Version history (P2): v1 → v2 with who and when.

> Suggested change: *tightening* (lower limits, add to blocklist) could apply instantly without World ID, since it can only make things safer, the same as Pause. Today every change needs a proof. Small backend tweak (P2).

### 6.4 Connect tab (P0 for the developer story)
- The 3 env vars (API key shown masked, with **Rotate key** (P1)).
- Code snippet with a copy button:
  ```ts
  import { LeashAgent } from "@leash/agent-sdk";
  const leash = new LeashAgent({ apiUrl, apiKey, agentPrivateKey, hotAccount, vaultAccount });
  const res = await leash.fetch("https://api.example.com/report"); // pays x402 automatically, waits for you if needed
  ```
- "Works with any x402 API. The seller doesn't need to know Leash exists."
- Connection status: "Agent last seen 3 min ago" (from the last API call). P2.

### 6.5 Audit tab (P1)
- The tamper-proof log (`GET /agents/:id/audit`): sequence number, event type, time, HCS message link.
- "This log lives on Hedera. Leash can't edit or delete it." Topic link to HashScan.
- **Download CSV** (`/agents/:id/audit.csv`).

---

## 7. Approval screen `/app/approvals/:id` (P0): the moment that matters

Designed **phone-first**: owners will open it from a notification or a QR code.

**Shows, top to bottom:**
1. **Who's asking:** agent name + ENS.
2. **What will happen** (Rabby-style), the biggest text on the page: "Pay **2.50 USDC** to **weather-pro** (`0.0.6001`)" and "Vault: 10.00 → 7.50 USDC".
3. **For:** the resource URL (`/report/premium`), plus the agent's reason if it gave one, **in a visibly separate box labelled "The agent says (unverified)"**, in quotes, in a smaller and plainer style than the facts above. The agent wrote it, so it may be a lie or a prompt-injection aimed at the human ("Alice already approved this", "this is a security update, confirm quickly"). It must never look like Leash's own text.
4. **Why you're being asked**, as warning chips: "First time paying this address" · "Over your 1.00 USDC auto-limit" · "Would exceed today's budget".
   Policy-change approvals show a diff instead: "Auto-limit per payment: 0.10 → 5.00 USDC".
5. **Countdown**: "Expires in 9:41". After expiry → the request is cancelled and the agent is told.
6. **Buttons:** **Approve with World ID** (primary) · **Deny** (no proof needed; denying is always safe).
7. **Check in World App:** "World App will show: *Pay 2.50 USDC to 0.0.6001…*. Make sure it matches." (The proof's `action_description` is built from the frozen intent.)

> **Fixed Nov 6 (was: agent text reached World App).** Found in the live test: The intent `summary` appends the agent's free-text reason (`… → 1 USDC — "world live test"`), and `approvalWorldRequest` sends that summary as `action_description`. World App then shows agent-written text inside the trusted confirmation screen, the one place the human relies on to see what they are really approving. The code comment ("never agent text") is wrong today.
> **Fix (done):** `action_description`/`summary` are now built only from frozen facts (kind, amount, asset, payee, policy diff), never from `reason`; the reason is a separate field, `agentReason` on `GET /approvals/:id` and the `approval.pending` event, which only the dashboard shows inside the "The agent says (unverified)" box above. Payment summaries show the resource **host only** (the URL path is agent-chosen text). Test: `flow.test.ts` "THE PAPER'S ATTACK".

**Flow:** `POST /approvals/:id/world-request` → IDKit → `POST /approvals/:id/verify` → success screen "Approved. Payment sent" with the HashScan link once `payment.settled` arrives.

**Mint the World request on click, never on page load (learned in the live test, Nov 6).** The RP signature from `world-request` expires after ≤5 min, and *earlier* when the approval itself is about to expire (TTL = min(300 s, time left on the approval)). A link created when the page opened and used minutes later fails in World App with `proof_generation_failed` or "invalid/expired code". So: call `POST /approvals/:id/world-request` only when the owner presses **Approve with World ID**, show the link's own countdown, and on expiry or IDKit error offer **"Get a new code"** (one more call), not a dead end. Reference: `scripts/world-approve-pending.mts`.

**IDKit wiring (verified live on staging, Nov 6):** approvals and login are *session* proofs: `IDKit.proveSession(params.session_id, { app_id, rp_context, environment, action_description })` with `.constraints(CredentialRequest("proof_of_human", { signal: params.signal }))`. Do **not** pass `action` and do **not** use `.preset()` (IDKit throws on session flows). The `signal` is what binds the proof to this one approval; the server rejects a proof whose signal is for another approval. Enrollment is the only plain `IDKit.request({ action, session_id: "create", allow_legacy_proofs: false }).preset(proofOfHuman())`. Reference: `scripts/world-live-test.mts`, `scripts/world-approval-test.mts`.

**States:** pending · approving (waiting for World App) · approved → settled · denied · expired · already handled (opened on two devices) · proof rejected (wrong person or replayed proof: "This approval needs the World ID that owns this account").

**Desktop:** shows a QR code for the phone *and* the in-browser IDKit option.

---

## 8. Public receipt `/r/:id` (P1)

For merchants and auditors, no login (`GET /receipts/:id`):
- "**2.50 USDC** paid by **shopper.leash.eth** to **0.0.6001** on Nov 7, 14:05."
- ✓ Approved by a verified human (World ID): the proof verified at that time; the nullifier is shown, never the identity.
- ✓ Recorded on Hedera: transaction link + audit log entry link.
- ✓ Matches the request: the intent hash.
- "What this proves / doesn't prove", one line each: it proves a unique human approved this exact payment; it does **not** reveal who they are.

---

## 9. Demo page `/demo` (P0): what the video and the booth use

Split screen, same agent, same inbox, same task:

| Left: "Typical agent wallet" | Right: "Leash" |
|---|---|
| Agent narration stream (thoughts, tool calls) | Agent narration stream |
| Inbox panel: the verification-code email appears… and gets read by the agent | Phone mockup: the approval card appears; "⏳ Waiting for Alice" |
| Cap meter jumps 0.01 → 5.00 in red: "Raised by the agent itself" | Policy stays v1; agent's limit request shows "Denied" |
| Attacker paid ✗ (red) | Attacker blocked ✓ |

Controls: **Run scripted** (reliable, for the video) · **Run with a real model** (`cli:sonnet` or a free model; can take 30–60 s) · **Reset**.
Data: agent runner SSE (`:4400/events`), legacy simulator SSE (`:4300/events`), Leash sockets.
Below the split: the eval results table (§2.3) with the "raw data" link.

---

## 10. Cross-cutting

- **Notifications (P1, the biggest real-world gap).** If the owner isn't looking, approvals expire and payments fail. Minimum: browser notification and page-title badge for `approval.pending`. Better: Telegram bot (O12, P2). Say honestly in the README that push to World App isn't available to third-party apps today (verify at World's booth, spike S6).
- **Units:** always show USDC with 2 decimals and the raw value in a tooltip. Never show the token's 6-decimal integers.
- **Addresses:** show the ENS name or a friendly label first and the Hedera ID (`0.0.6001`) second, always with a copy button and a HashScan link.
- **Time:** relative ("2 min ago") with the exact time on hover; countdowns for anything that expires.
- **Testnet banner:** "Testnet: no real money" on every app page.
- **Dark mode** and **mobile layout** for the approval screen are P0; the rest of the app can be desktop-first.
- **Accessibility:** status is never shown by colour alone (icon + word: ✓ Auto, ⏳ Waiting, ⛔ Denied).

## 11. What we deliberately do NOT show

- Private keys after the one-time screen. Ever.
- The owner's identity: we only have a nullifier, and the UI should say so ("Leash never learns who you are").
- Raw x402 headers, KeyLists or transaction bytes on the main screens. They go in expandable "technical details" for judges.
- Fake metrics ("10,000 agents protected"). This is a hackathon build; the evidence section is our real data.

## 12. Backend gaps this spec reveals

| Gap | Needed for | Priority |
|---|---|---|
| ~~Agent's free-text `reason` in World App `action_description`~~ (fixed Nov 6, see §7) | Integrity of the approval screen | done |
| Client-side key generation (send public keys only) | Critic question "did Leash see the agent key?" | P1 |
| `GET /agents` list with today's spend per agent | Dashboard cards (today `/me` returns agents without spend) | P1 |
| Instant tightening without World ID | Policy tab | P2 |
| `last_seen_at` on agents | Connect tab status | P2 |

## 13. Build order (about 14 hours left)

1. `/login` → `/app` → create wizard (with fake funds) → agent Overview + Activity: the owner loop works.
2. `/app/approvals/:id` with IDKit (simulator), plus the policy tab using the same screen.
3. `/demo` split screen (wire it to the existing runner).
4. Landing page with the evidence section.
5. Receipt page, Audit tab, notifications: if time is left.

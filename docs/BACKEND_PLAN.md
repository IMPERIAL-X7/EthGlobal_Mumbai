# Leash: Backend Plan

> Status: plan (written before the hackathon start; a spec-driven planning artifact, kept in the repo as ETHGlobal's AI rules require).
> Companion files: [KEYS.md](KEYS.md) (every key and where to get it) · [../.env.example](../.env.example)

**Contents**
0. Work categories
1. What users want (feature list)
2. Architecture
3. Core flows
4. Policy engine
5. Data model
6. API contract for the frontend
7. Track integration
8. Risky unknowns (do these first)
9. Testing
10. Timeline (about 36h)

---

## 0. Work categories

| # | Category | Contents | This doc covers it? |
|---|---|---|---|
| A | **Backend: core** | API server, policy engine, approvals, database, sockets | ✅ |
| B | **Backend: chain integrations** | World (IDKit), Hedera (x402, vault, HCS, scheduled tx), ENSv2 | ✅ |
| C | **Frontend** | Owner dashboard, approval screen, receipt page, demo split screen | Later; it only needs §6 |
| D | **Demo and testing** | Demo agent, demo merchant (x402 API), "typical wallet" attack simulator, tests, video | ✅ (backend side) |

Rule: **the frontend never talks to a chain or to World's backend directly.** It calls our REST API, listens to our socket and renders IDKit. Everything sensitive happens server-side.

---

## 1. What users want: feature list

Three kinds of people use the system. The **owner** is the primary user.

### 1.1 Owner (the human who runs an agent)
| # | Feature | Why they want it | Priority |
|---|---|---|---|
| O1 | **Sign in with World ID** (no password, no email) | Login method = approval method; email is exactly what agents steal | MVP |
| O2 | **Create an agent**: name it, get `name.leash.eth`, a hot wallet, a vault and an API key for the agent | One-click setup; the agent gets an identity | MVP |
| O3 | **Fund it**: deposit address, live balances (hot / vault), testnet faucet links | Needs to see where the money is | MVP |
| O4 | **Set the policy**: auto-pay limit per payment, daily auto budget, hard max, approval for new payees, allowlist/blocklist, approval timeout | Control without micromanaging | MVP |
| O5 | **Approval inbox**: plain-language request ("Pay 2.50 USDC to `weather-pro.eth` for `/forecast/30d`"), warnings ("first time paying this address"), countdown, Approve with World ID / Deny | The core product moment | MVP |
| O6 | **Live activity feed**: every request and its decision, in real time | Trust comes from visibility | MVP |
| O7 | **Kill switch**: pause instantly; revoke (ENS subname removed, vault swept back) | Panic button | MVP (pause), Should (revoke + sweep) |
| O8 | **Audit log**: tamper-evident history on Hedera HCS, HashScan links, CSV export | For finance and auditors; "prove what happened" | MVP (HCS), Should (CSV) |
| O9 | **Receipts**: a shareable page per approved payment that anyone can verify | Our differentiator | Should |
| O10 | **Changing limits needs World ID too** | Directly fixes the self-raising-cap attack from the paper | MVP |
| O11 | Spending analytics (by payee and day) | Nice dashboard | Could |
| O12 | Push/Telegram alert for pending approvals | Approvals while away from the dashboard | Could |
| O13 | Several agents per owner | Realistic | Should (data model supports it from day 1) |

### 1.2 Agent developer (whoever wires an agent to Leash)
| # | Feature | Priority |
|---|---|---|
| D1 | `@leash/agent-sdk` with `leashFetch(url)`: a drop-in `fetch` that handles x402 402 responses, asks Leash, waits for approval, pays | MVP |
| D2 | Simple decisions back: `auto` / `pending` / `denied` with reason | MVP |
| D3 | A tool for AI SDK / LangChain agents (`leash_pay`) plus Hedera Agent Kit tools | MVP |
| D4 | API key per agent; can be rotated | MVP |

### 1.3 Seller / merchant (an x402 API being paid)
| # | Feature | Priority |
|---|---|---|
| M1 | Plain x402 works unchanged (they don't need to know Leash exists) | MVP |
| M2 | Look up `agent.leash.eth`: status (active/paused/revoked), policy hash, audit topic | Should |
| M3 | `verifyLeashReceipt()` + Express middleware: require proof of human approval above an amount | Should (the differentiator; stretch if time is short) |

---

## 2. Architecture

### 2.1 Stack (popular, boring, fast)
- **TypeScript monorepo**, `pnpm` workspaces, Node 22, `tsx` for running, `vitest` for tests
- **Express 5 + Socket.IO** (Express because the x402 packages ship `@x402/express`)
- **SQLite + Drizzle ORM** (`better-sqlite3`): no database server to run; one file
- **zod**: every input and output schema lives in a shared package the frontend imports too
- **pino** for logs, **node-cron** for timed jobs
- Chain SDKs: `@worldcoin/idkit-core@4.6`, `@hiero-ledger/sdk@2.90`, `@x402/core|express|fetch|hedera@2.30`, `@hashgraph/hedera-agent-kit@4.2` + `-ai-sdk`, `viem@2.57` + `@ensdomains/ensjs@5.2.12`
- Agent: Vercel AI SDK with Claude (`@ai-sdk/anthropic`)
- Contracts: **none planned.** ENS is used through viem. Foundry only if we need the custom registrar from the ENS tutorial. Scaffold-ETH isn't needed, because almost nothing here is EVM.

### 2.2 Repo layout (modular: each integration is its own package behind an interface)
```
leash/
├─ packages/
│  ├─ shared/        zod schemas, types, socket event names, intent canonicalisation + hashing (also used by the frontend)
│  ├─ policy/        PURE deterministic policy engine (no I/O); most heavily tested
│  ├─ world/         ApprovalProvider: IDKit sign/verify, sessions, nullifiers (OIDC fallback)
│  ├─ hedera/        accounts, vault (threshold key), x402 payer + co-sign validator, HCS logger, scheduled refills, mirror node
│  ├─ ens/           subname register/records/unregister, resolve
│  ├─ agent-sdk/     leashFetch() + AI-SDK tool for agents
│  └─ verify/        receipt verifier + Express middleware for sellers (M3)
├─ apps/
│  ├─ server/        Express + Socket.IO + Drizzle; routes → services → packages
│  ├─ merchant/      demo x402 APIs on Hedera testnet (cheap, expensive, "attacker")
│  ├─ agent/         demo agent (scripted mode + LLM mode)
│  ├─ legacy-sim/    "typical wallet" with email-code approval + mock inbox (attack replay)
│  └─ web/           frontend (later)
└─ scripts/          setup: create operator HCS topic, register ENS parent, fund/associate, seed demo
```

### 2.3 Layering inside `apps/server`
```
routes (REST, validates with zod) ──▶ services (business logic) ──▶ packages (integrations, pure logic)
                                          │
                                          ├─▶ repo (Drizzle)
                                          └─▶ events.emit(...) ──▶ Socket.IO rooms
```
Each service depends on **interfaces** (`ApprovalProvider`, `PaymentRail`, `AuditLog`, `NameService`) so we can:
- swap World approval modes (IDKit session / OIDC fallback / HITL SDK) without touching flows
- run everything with **in-memory fakes** for tests and offline frontend work (`LEASH_FAKE_CHAINS=1`)

---

## 3. Core flows

### 3.1 Owner sign-up and login (World ID sessions)
1. `POST /v1/auth/world/request` → server runs `signRequest({ signingKeyHex, action: "leash-enroll" })` and returns `rp_context`.
2. The frontend runs `IDKit.request({ app_id, action:"leash-enroll", session_id:"create", rp_context, ... })` and shows the World App QR code.
3. `POST /v1/auth/world/verify` with the completion result.
   - The server forwards it to `POST https://developer.world.org/api/v4/verify/{rp_id}` and checks `success`, the action and the environment.
   - It stores the **enrollment nullifier** (unique, so one human = one owner) and the **`session_id`**.
   - It returns an httpOnly session cookie.
4. Returning login uses `IDKit.proveSession(savedSessionId)`. The server checks the returned `session_id` equals the stored one.

### 3.2 Agent creation
`POST /v1/agents { name }`:
1. Generate the agent key (ECDSA). It is returned **once** and stored in the agent's env, never in our database.
   In the demo, the server's setup script writes it to `apps/agent/.env`.
2. Create the **hot account**: key = agent key, `maxAutomaticTokenAssociations = 10` (receives USDC with no separate association step).
3. Create the **vault account**: key = `ThresholdKey(2, [agentKey, serverCosignKey, ownerRecoveryKey])`, auto-associations = 10.
   - The owner's recovery key is generated in the browser and downloaded once (2-of-3 lets owner + server recover funds if the agent is gone).
4. Register `name.leash.eth` on ENSv2 Sepolia with an expiry. Set text records:
   - `leash.status = active`
   - `leash.policy = <hash>`
   - `leash.hedera.hot / leash.hedera.vault = 0.0.x`
   - `leash.audit = <topicId>`
5. Write an `AGENT_CREATED` HCS message. Issue the agent API key.

### 3.3 Payment request: the main flow
```
Agent SDK                 Leash server                         Owner (web + World App)       Merchant / facilitator
 │ GET /forecast ─────────────────────────────────────────────────────────────────────────▶ 402 + PaymentRequirements
 │ POST /v1/agent/intents {requirements, resource, reason}
 │──────────────────────▶ canonicalise → intent; h = sha256(JCS(intent))
 │                        policy.evaluate(intent, state)
 │                        ├─ AUTO_HOT ──▶ {decision:"auto"}
 │◀───────────────────────┤               SDK pays from HOT via @x402/fetch ─────────────────────▶ settle (facilitator)
 │ POST …/settled {txId}  │               server checks via mirror node, HCS log, socket event
 │                        ├─ DENY ──────▶ {decision:"denied", reason}, HCS log
 │                        └─ NEEDS_APPROVAL
 │                             approval{action:"pay_"+h[0:32], expiresAt} ─socket─▶ approval.pending
 │ GET …/wait (long-poll)                                             Approve → IDKit proof (action-bound,
 │                                                                     session-linked) → POST /v1/approvals/:id/verify
 │                             verify proof · session_id==owner · action==stored · nullifier unused · not expired
 │◀──────────────────────────── approved
 │ build x402 Transfer FROM VAULT, sign with agent key
 │ POST …/cosign {txBytes} ─▶ CO-SIGN VALIDATOR: parse tx; payer=vault; exactly one credit = payTo/amount/token;
 │                              feePayer = facilitator; valid-start window ok; intent not used → add server signature
 │◀──────────────────────────── signed bytes
 │ X-PAYMENT ────────────────────────────────────────────────────────────────────────────▶ settle → 200 + data
 │ POST …/settled {txId} ─▶ mirror check, receipt built, HCS log, socket payment.settled
```
**The co-sign validator is the most security-critical code we write.** The server never signs bytes it hasn't parsed and matched against the frozen intent. It gets its own unit tests.

### 3.4 Changing limits (the paper's attack, fixed)
`PUT /v1/agents/:id/policy` **always** creates an approval of kind `POLICY_CHANGE`:
- The intent is the hash of the new policy.
- The new policy only takes effect after World ID approval.
- Then ENS `leash.policy` is updated and an HCS message written.

The agent's API key **cannot call this endpoint at all** (owner session only). An agent can ask by calling `POST /v1/agent/policy-requests`, which only *creates* a pending request.

### 3.5 Hot-wallet refill (automatic, inside the daily budget)
- A cron job, or the SDK when the hot balance is low, requests a refill.
- The agent creates a `ScheduleCreateTransaction` (vault → hot, amount ≤ remaining daily auto budget).
- The server checks the amount against policy, then `ScheduleSign`s. Agent + server = 2 of 3, and it executes.
- This uses Hedera **Scheduled Transactions** (an extra-points item), and no human is needed inside the budget.

### 3.6 Detecting a bypass
- The hot wallet is the agent's own key, so the agent *can* pay without asking Leash. That's acceptable, because the loss is bounded by its balance.
- A mirror-node watcher (every 15s) compares outgoing hot-wallet transfers with reported settlements.
- An unreported spend → `ANOMALY` HCS message, auto-pause and an owner alert.

### 3.7 Kill switch
- **Pause:** server stops co-signing/refilling, ENS `leash.status=paused`, HCS message. Instant.
- **Revoke:**
  - ENS `unregister`, so the name stops resolving.
  - Vault swept to the owner's address (server + owner recovery key = 2 of 3).
  - API key disabled.

### 3.8 Deny / expire / cancel (required by World)
| Event | Effect |
|---|---|
| Owner taps Deny | `approval.status=denied`, intent closed, SDK gets `denied`, HCS log. Optional cooldown: no new approval requests for that payee for N minutes (protects against approval spam). |
| Timeout (default 10 min) | Cron marks `expired`; same effects |
| Agent cancels, or the merchant's 402 offer expires | `cancelled` |

In all three cases **no co-signature is ever produced**, so no money can move from the vault. A demo test case covers this.

---

## 4. Policy engine (`packages/policy`, pure function)

```ts
evaluate(intent: Intent, policy: Policy, state: SpendState): Decision
// Decision = { kind: "AUTO_HOT" | "NEEDS_APPROVAL" | "DENY", reasons: string[], warnings: string[] }
```

Rules in order; the first match wins for DENY:
1. `agent.status != active` → DENY
2. Network/asset not allowed (only `hedera:testnet`, USDC `0.0.429274` or HBAR) → DENY
3. Payee on blocklist → DENY
4. `amount > hardMaxPerPayment` → DENY (not even approvable)
5. `pendingApprovals >= maxPending` → DENY ("approval spam")

Approval rules (any match means NEEDS_APPROVAL):
6. Payee is new and `requireApprovalForNewPayee` is set
7. `amount > autoPerPayment`
8. `spentToday + amount > autoDaily`
9. `hotBalance < amount`

Otherwise → **AUTO_HOT**.

Warnings feed the approval screen: first-time payee, amount ≥ 5× this payee's average, payee has no ENS name, resource domain differs from earlier payments to this payee.

Default policy (demo): auto ≤ 0.10 USDC per payment, ≤ 1 USDC per day, hard max 50 USDC, new payee needs approval, approval timeout 10 min, max 3 pending.

---

## 5. Data model (Drizzle / SQLite)

| Table | Key columns |
|---|---|
| `owners` | id, world_session_id (unique), enrollment_nullifier (unique), created_at |
| `agents` | id, owner_id, ens_name, hot_account, vault_account, agent_pubkey, status, api_key_hash, created_at |
| `policies` | id, agent_id, version, json, hash, active, approved_by_approval_id |
| `intents` | id, agent_id, kind(PAYMENT/POLICY_CHANGE/REFILL), canonical_json, hash, payee, amount, asset, resource, decision, status, expires_at |
| `approvals` | id, intent_id, world_action, status(pending/approved/denied/expired/cancelled), nullifier (unique per action), decided_at |
| `payments` | id, intent_id, source(hot/vault), tx_id, consensus_ts, verified_on_mirror, receipt_json |
| `audit_events` | id, agent_id, type, payload_hash, hcs_topic, hcs_seq, created_at |
| `payees` | agent_id, account, ens_name, first_seen, total_paid, count (powers "first time" warnings) |
| `spend_counters` | agent_id, day, auto_spent |

---

## 6. API contract (all the frontend needs)

All REST is JSON under `/v1`, validated by zod schemas exported from `@leash/shared`.
Auth: owner = httpOnly cookie; agent = `Authorization: Bearer lsh_…`.

### 6.1 REST: owner
| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/world/request` | Get `rp_context` for enroll/login |
| POST | `/auth/world/verify` | Verify IDKit result → session cookie |
| POST | `/auth/logout` | |
| GET | `/me` | Owner + agents |
| POST | `/agents` | Create agent (O2) |
| GET | `/agents/:id` | Agent detail + balances + policy |
| PUT | `/agents/:id/policy` | Propose policy change → returns approval (O10) |
| POST | `/agents/:id/pause` · `/resume` · `/revoke` | Kill switch (O7) |
| GET | `/agents/:id/activity?cursor=` | Activity feed (O6) |
| GET | `/agents/:id/audit` · `/audit.csv` | HCS-backed log (O8) |
| GET | `/approvals?status=pending` | Inbox (O5) |
| GET | `/approvals/:id` | Detail: plain-language intent, hash, warnings, expiry |
| POST | `/approvals/:id/world-request` | `rp_context` for this approval's action |
| POST | `/approvals/:id/verify` | Submit IDKit result → approve |
| POST | `/approvals/:id/deny` | Deny |
| GET | `/receipts/:id` | Public receipt (O9 / M3) |

### 6.2 REST: agent (used by `@leash/agent-sdk`)
| Method | Path | Purpose |
|---|---|---|
| POST | `/agent/intents` | Submit payment requirements → decision |
| GET | `/agent/intents/:id/wait?timeout=` | Long-poll until approved / denied / expired |
| POST | `/agent/intents/:id/cosign` | Vault tx bytes → server-signed bytes |
| POST | `/agent/intents/:id/settled` | Report tx id |
| POST | `/agent/intents/:id/cancel` | |
| POST | `/agent/refills` | Scheduled refill request |
| POST | `/agent/policy-requests` | Ask the owner for a limit change (can't apply it) |

### 6.3 Socket.IO (server → client only; mutations always go through REST)
Connect with the cookie, then `emit("subscribe", { agentId })` to join room `agent:<id>`. The owner is also auto-joined to `owner:<id>`.

| Event | Payload |
|---|---|
| `intent.created` | `{ intent, decision }` |
| `approval.pending` | `{ approvalId, summary, intentHash, warnings[], expiresAt }` |
| `approval.resolved` | `{ approvalId, status }` |
| `payment.settled` | `{ paymentId, txId, hashscanUrl, amount, payee }` |
| `payment.failed` | `{ intentId, error }` |
| `balance.updated` | `{ hot, vault }` |
| `audit.appended` | `{ seq, topicId, type }` |
| `agent.status` | `{ status }` |
| `policy.updated` | `{ version, hash }` |
| `anomaly.detected` | `{ kind, txId }` |
| `demo.legacy.*` | events from the attack simulator for the split-screen demo |

The frontend can be built entirely against `LEASH_FAKE_CHAINS=1` (in-memory chains, instant approvals in the simulator) before the chain integrations are finished.

---

## 7. Track integration: exactly what we use, and where

### 7.1 World: World ID Agent Pass ($5k)
| Requirement (prize page) | Where we meet it |
|---|---|
| Integrate the official World ID Agent Pass | `packages/world`: IDKit 4.x action-bound proofs as the agent's human checkpoint. **Confirm at the World booth which SDK they mean by "Agent Pass"** (likely the human-in-the-loop SDK or AgentKit). `ApprovalProvider` lets us swap in `@worldcoin/human-in-the-loop` if required. |
| Full journey: request → completion → validated result → protected action | §3.3: approval created → IDKit completion → `/api/v4/verify` + our checks → co-sign of the vault payment |
| Denied/expired/cancelled path where the action does not occur | §3.8, with a test case that shows no co-signature ever exists |
| Validate on a secure backend; no secrets on the client; client response is not authorization | Signing key only on the server; the server re-verifies; co-sign is gated on the server-side DB state |
| Integration debrief | `docs/WORLD_DEBRIEF.md`: time to first success, friction, missing capability (the paper's "World app doesn't show the action" gap!), top improvement |

### 7.2 Hedera: AI Agents That Pay with x402 ($6.5k)
| Requirement | Where |
|---|---|
| x402 endpoint settling on Hedera testnet through a listed facilitator | `apps/merchant` with `@x402/express` + `@x402/hedera` `ExactHederaScheme`, asset USDC `0.0.429274`, facilitator Blocky402 (official as fallback) |
| Agent finds the endpoint and pays end to end without a human | AUTO_HOT path (§3.3) |
| README with Hedera transaction ID of a settled payment; video with HashScan | `docs/` + demo |
| **Extra:** spending controls | Policy engine |
| **Extra:** human approval above a threshold | The whole product |
| **Extra:** HCS tamper-evident spending log | `AuditLog` → HCS topic |
| **Extra:** HTS tokens (USDC) | USDC HTS |
| **Extra:** Scheduled Transactions | Refills (§3.5) |
| **Extra:** Hedera Agent Kit | Demo agent tools (balance, HCS read) |
| **Extra:** ERC-8004 / HCS-14 identity | Skipped; ENS covers identity |

Also: the threshold-key vault is native Hedera multi-sig, which is a good technical-depth point.

### 7.3 ENS: Best Use of ENSv2 ($7k)
| Requirement | Where |
|---|---|
| Built on ENSv2 on Sepolia | `packages/ens` with viem/ensjs v2 against the Sepolia ENSv2 deployments |
| ENSv2 central, not cosmetic | Agent identity = subname. **Expiry** = agent time-to-live. **`unregister`** = revoke. **Text records** = public status/policy hash/audit topic that sellers check. **Roles** (`grantSetterRoles`) let the server update `leash.status` without owning the name. Payee display on the approval screen = reverse/forward ENS resolution. |
| Functional, no hard-coded values | Everything resolves live through the Universal Resolver |
| Live demo link + open source | Deploy web + server; public repo |

**Fallback if ENSv2 registration takes more than about 4h:** switch the third partner to World IDKit ($2.5k). Since multiple World tracks count as one partner pick, we'd use ENS-free identity and pick a different third partner.

---

## 8. Risky unknowns: test these first (hours 0–4)

| # | Spike | Pass condition | Fallback |
|---|---|---|---|
| S1 | One IDKit request with `action:"pay_…"` **and** an existing `session_id` | Proof verifies, and both the action nullifier and the session_id come back | Two steps: `proveSession` (owner check) then the action proof. Or the auth.world.org OIDC step-up (`max_age=0`, `sub` check) + action proof. |
| S2 | x402 payment from a **ThresholdKey vault** (both signatures added before sending) accepted by the facilitator's `/verify` and `/settle` | Settled tx on HashScan | Vault → hot transfer of the exact amount (memo = intent hash, co-signed, scheduled) and then hot pays; mirror-node check that the next payment matches payee and amount |
| S3 | ENSv2 Sepolia: get a parent `.eth` name, create subname with expiry, set text, unregister | All four work from a script | Records-only subnames on the parent resolver (wildcard), with expiry tracked in our DB |
| S4 | Hedera testnet USDC `0.0.429274` from a faucet into our accounts | Balance visible on the mirror node | Use HBAR (asset `0.0.0`) for the x402 payments |
| S5 | World action string limits (length/charset) | `pay_<32 hex>` accepted | Shorter hash prefix (still ≥ 96 bits) |
| S6 | The meaning of "Agent Pass" (ask at the World booth) | Clear SDK/requirement | Add the HITL SDK as a second `ApprovalProvider` |

---

## 9. Testing

- **Unit (vitest):**
  - policy engine (table-driven, every rule and boundary)
  - intent canonicalisation and hash
  - **co-sign validator:** wrong payee, wrong amount, extra transfer, wrong token, payer ≠ vault, feePayer ≠ facilitator, expired valid-start, reused intent. All must refuse.
  - approval state machine
- **Integration:** `LEASH_FAKE_CHAINS=1` for full flows; testnet scripts for each spike.
- **Security tests to show in the demo:**
  - reused proof → rejected
  - proof for intent A used on intent B → rejected
  - agent key calling `PUT /policy` → 403
  - denied approval → no co-signature exists
- **Demo:**
  - `apps/legacy-sim`: a typical wallet whose limit changes need an emailed code; the agent has an inbox tool.
  - `apps/agent --mode=scripted` for a reliable live run; `--mode=llm` for the real thing.
  - The paper found Claude Opus *did not* escalate while small Qwen/DeepSeek models did, so pick the LLM accordingly or use scripted mode on stage.

---

## 10. Timeline (deadline Sat 09:00 IST)

| Hours | Backend work |
|---|---|
| 0–1 | Monorepo scaffold, shared schemas, DB, fake chains, `.env` loaded. **Commit often from here.** |
| 0–4 | Spikes S1–S5 in parallel (one person each for World, Hedera, ENS) |
| 4–10 | Policy engine + tests; intents/approvals services; sockets; World approval end to end on the simulator |
| 10–16 | Hedera: accounts, vault, x402 merchant + hot auto-pay, co-sign validator, HCS logger |
| 16–20 | Vault-approved payment end to end; deny/expire paths; refills (scheduled) |
| 20–24 | ENS: subnames on create, status records, revoke; payee name resolution |
| 24–28 | Legacy simulator + demo agent; anomaly watcher; receipts |
| 28–32 | Freeze features. Hardening, README, `FEEDBACK`/debrief docs, architecture diagram |
| 32–36 | Video (2–4 min), deploy, submit (pick: World, Hedera, ENS) |

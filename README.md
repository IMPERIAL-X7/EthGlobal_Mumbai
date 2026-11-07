# Leash

Human approval for AI agent payments.

Your AI agent can spend money. It should not be able to approve its own spending. Leash lets an agent pay small amounts on its own. Anything bigger, anything new, and any change to its limits waits for the owner. Only the owner's World ID can approve it.

Built at ETHGlobal Mumbai, November 2026.

| | |
|---|---|
| Live demo | [leash-web-theta.vercel.app](https://leash-web-theta.vercel.app) |
| Demo video | `VIDEO_URL` |
| Settled payment (vault, owner approved) | [`0.0.7162784@1794010639.787403755`](https://hashscan.io/testnet/transaction/0.0.7162784@1794010639.787403755) |
| Settled payment (automatic, no human) | [`0.0.7162784@1794010646.743833618`](https://hashscan.io/testnet/transaction/0.0.7162784@1794010646.743833618) |
| Audit log (HCS topic) | [`0.0.11342153`](https://hashscan.io/testnet/topic/0.0.11342153) |
| ENS parent name (ENSv2, Sepolia) | [`leash.eth`](https://sepolia.app.ens.domains/leash.eth) |

## The problem

Agent wallets protect users with a spending cap. To raise the cap, the wallet asks the owner to confirm with a code. The code usually goes to email.

The agent often has access to that inbox. So the agent can read the code, type it in, and raise its own limit. Nobody has to attack it. It does this to finish its task.

Researchers from Cornell Tech, Yale and IC3 showed this on November 1, 2026 ("Inalienable Human-in-the-Loop"). Nine of ten models raised their own cap. With a forged "owner" email, five of ten paid an attacker.

We reproduced the core result with our own simulator and seven models:

| | Agent raised its own limit |
|---|---|
| Typical agent wallet | 20 of 21 runs |
| Leash | 0 of 22 runs (0 of 45 including the fake-email runs) |

Samples are small (1 to 6 runs per model). In our runs no model fell for the fake owner email on either wallet. Method and raw data: [`eval-results/`](eval-results/) and [`scripts/escalation-eval.ts`](scripts/escalation-eval.ts).

Context from outside our work:

- x402 agent payments on Base went from near zero to over 100 million in about three quarters ([Chainalysis, June 2026](https://www.chainalysis.com/blog/x402-agentic-payments-adoption/)). Chainalysis notes much of the early volume was meme coin farming.
- 65% of organisations had an AI agent incident in the past year, and 35% reported financial losses ([Cloud Security Alliance, April 2026](https://cloudsecurityalliance.org/press-releases/2026/04/21/new-cloud-security-alliance-survey-reveals-82-of-enterprises-have-unknown-ai-agents-in-their-environments), 418 respondents, commissioned by Token Security).

To be fair about it: real agent spending today is small. Leash is infrastructure for where agent payments are going, not a fix for large losses happening now.

## How Leash works

1. The agent calls a paid API. The API answers `402 Payment Required` (x402).
2. The Leash SDK asks the Leash server before paying. The server checks the owner's rules: amount, payee, today's total.
3. Within the rules, the agent pays on its own from a small everyday wallet.
4. Outside the rules, the payment waits. The owner sees it in the web app and approves it with World ID on their phone. Only then does the server co-sign a payment from the vault.
5. Every decision is written to a public Hedera topic. Every agent has an ENS name that shows its status and wallets.

The agent can ask for higher limits. It can never apply them. The approval is a World ID proof from the owner's phone, bound to that one request. Nothing the agent can reach (its inbox, its keys, its tools) can produce it.

```
            agent (Leash SDK)
                 │  x402: 402 + price
                 ▼
          Leash server ── policy check ──► within limits ──► everyday wallet pays
                 │                                             (agent key only)
                 │ outside limits
                 ▼
     owner approves with World ID (phone)
                 │  proof bound to this request
                 ▼
     vault pays: 2-of-3 key, agent signs + Leash co-signs
                 │
                 ▼
     settled on Hedera via the x402 facilitator
     decision logged to HCS · status published on ENS
```

### Why the vault is safe

Each agent has two Hedera accounts:

- **Everyday wallet.** Controlled by the agent key alone. It holds a small float for automatic payments.
- **Vault.** A 2-of-3 threshold key: agent key, Leash server key, owner recovery key. The agent cannot move vault funds alone. The server only co-signs after a verified World ID approval, and only the exact payment that was approved (payee, amount, token, payer and fee payer are all checked).

The agent key and the server key are separate keys held by separate processes.

## Sponsor tracks

### Hedera: AI Agents That Pay (x402)

| Requirement | Where |
|---|---|
| x402 endpoint settling on Hedera testnet through a listed facilitator | [`apps/merchant`](apps/merchant): `@x402/express` with the Hedera exact scheme, settled through Blocky402 |
| An agent that completes a paid request with no human approving | [`packages/agent-sdk`](packages/agent-sdk): `leash.fetch()`. The automatic payment above settled with no human. |
| Spending controls and human approval above an amount (extra) | The whole product: per-payment cap, daily cap, hard maximum, approval for new payees |
| HCS topic as a tamper-evident audit log (extra) | [`packages/hedera/src/audit.ts`](packages/hedera/src/audit.ts), topic [`0.0.11342153`](https://hashscan.io/testnet/topic/0.0.11342153) |
| Native multi-signature (depth) | Threshold-key vaults created with the Hedera SDK, no Solidity |

Our live runs settled in HBAR. The code also supports USDC (token `0.0.429274`); see Known limits.

### ENS: Best Use of ENSv2

- `leash.eth` is registered on the ENSv2 ETHRegistrar on Sepolia (commit, wait, register).
- It points to our own Permissioned Resolver, deployed through ENSv2's VerifiableFactory.
- Each agent is `<name>.leash.eth`. Its records live on the parent's resolver and resolve through the Universal Resolver by wildcard (ENSIP-10). No per-agent registration, one transaction per agent.
- Records: `leash.status`, `leash.policy` (hash of the active limits), `leash.hedera.hot`, `leash.hedera.vault`, `leash.audit`, `leash.expires`.
- Only Leash can write them, so an agent cannot edit its own identity. Revoking an agent sets `leash.status` to `revoked` and clears its wallets within seconds.
- **Sellers check it.** The SDK sends the agent's name in an `X-Leash-Agent` header. The demo merchant resolves that name on ENS itself, not through Leash. It refuses agents that are not `active`, and refuses a payment if the paying wallet is not one of the wallets published on ENS. Revoke an agent and shops stop serving it, with no call to Leash. Code: the check at the top of [`apps/merchant/src/app.ts`](apps/merchant/src/app.ts).
- Code: [`packages/ens`](packages/ens), setup: [`scripts/setup-ens.ts`](scripts/setup-ens.ts), live test: [`scripts/ens-live-test.mts`](scripts/ens-live-test.mts).

### World: Best Use of IDKit

The trust moment: an AI agent wants to spend more than its owner allowed, pay someone new, or raise its own limits. The product must know that the owner, a real person, approved this exact request, and not the agent pretending to be them.

Why this credential: Proof of Human is the minimum that works. We do not need a passport or a selfie check. We need to know that a unique human, the same one who owns the account, made this decision. An email code or a password fails this test, because the agent can reach those.

How we use IDKit 4:

- **Sign up.** A uniqueness proof (`proofOfHuman`) for the action `leash_enroll` that also creates a World ID session. One human, one account.
- **Sign in.** A session proof for that same session.
- **Approve.** A session proof whose `signal` is the approval's own ID. The server checks the proof with World, then checks that the session is the owner's, that the signal matches this approval, and that the nullifier was never used before. A proof for one approval cannot approve another.
- **Alternative paths.** Deny (no proof needed), expired codes, a proof from a different person, and a replayed proof are all rejected, and no money moves.
- All checks run on the server. The signing key never reaches the browser.

Integration notes and feedback: [`docs/WORLD_DEBRIEF.md`](docs/WORLD_DEBRIEF.md).

## Repository

| Path | What it is |
|---|---|
| `apps/server` | Leash API: policy engine, approvals, co-signing, World ID checks, audit, ENS updates |
| `apps/web` | Web app: landing page, sign in, dashboard, create agent, approval screen |
| `apps/merchant` | Demo x402 merchant ("Weather Pro") |
| `apps/agent` | Demo agent (scripted, or driven by a real model) |
| `apps/legacy-sim` | A "typical agent wallet" with an email code, for the comparison |
| `packages/agent-sdk` | `LeashAgent`: a drop-in `fetch` that pays x402 endpoints under Leash's rules |
| `packages/policy`, `packages/shared` | Policy evaluation, intent hashing, shared types |
| `packages/hedera` | Accounts, threshold vaults, co-sign validation, HCS audit |
| `packages/world` | World ID request signing and proof checks |
| `packages/ens` | ENSv2 records on Sepolia |
| `scripts/` | Setup, live tests, the escalation experiment |

## Run it

Requirements: Node 22. Copy `.env.example` to `.env` and fill in the keys ([`docs/KEYS.md`](docs/KEYS.md) explains each one).

```bash
npm install

# one-time setup on testnet (writes IDs back to .env)
npm run setup:hedera
npx tsx scripts/setup-ens.ts

# run
npm run dev                    # Leash server on :4000
npm run merchant               # demo x402 merchant on :4200
npm run dev -w @leash/web      # web app on http://localhost:5180
```

No keys? `LEASH_FAKE_CHAINS=1 npm run dev` runs everything on in-memory chains, and the sign-in page offers a dev sign-in.

Try the full flow:

1. Sign in at `/login` with World ID. Use the [World ID Simulator](https://simulator.worldcoin.org) for staging.
2. Create an agent. Download its `.env` from the keys screen.
3. Run the agent: `npx tsx scripts/run-owner-agent.mts ~/Downloads/<name>.env`
4. Its first payment to the new shop waits for you. Approve it in the web app. The second payment goes through on its own.

Tests: `npm test` (58 tests: policy, intent hashing, co-sign validation, World ID binding, the full approval flow).

## Known limits

We would rather list these than have a judge find them.

- **USDC.** Live payments used HBAR because the Circle faucet was rate limited during the event. Limits in the web app are shown in USDC.
- **Server-generated agent keys.** The server creates the agent's key and shows it once. It never stores it, but a production version should create it in the browser and send only the public key.
- **Lowering a limit needs World ID too.** Making things safer should not need a proof. Pausing an agent does not need one.
- **No notifications yet.** The owner has to look at the dashboard. Approvals expire after 10 minutes.
- **World ID staging.** Proofs come from the simulator and test identities, as the prize rules allow.
- **ENS expiry is a record.** `leash.expires` is checked by readers. It is not enforced by the registry.

## Team

Solo build at ETHGlobal Mumbai.

# Leash server

```bash
npm install
npm test                      # 49 tests: policy, intent hashing, co-sign validator, full HTTP flows
LEASH_FAKE_CHAINS=1 npm run dev   # everything in memory, no keys needed (http://localhost:4000/v1/health)
```

Each chain switches from fake to live independently once its keys are in `.env` (see `docs/KEYS.md`).
`GET /v1/health` reports which ones are live.

## Fake-mode helpers (only mounted when a chain is fake)
| Endpoint | Plays the role of |
|---|---|
| `POST /v1/dev/world-proof {action, sessionId}` | World App simulator: returns a proof the fake verifier accepts |
| `POST /v1/dev/settle {txBytesBase64}` | x402 facilitator: executes a signed transfer on the fake ledger |
| `POST /v1/dev/fund {account, asset, amount}` | Testnet faucet |

New agents are pre-funded in fake mode: 0.50 USDC hot, 20 USDC vault.

## Layout
```
src/
  config.ts      env parsing; per-chain fake/live switch
  db.ts          SQLite schema (better-sqlite3)
  deps.ts        builds World / Hedera / ENS adapters (real or fake)
  bus.ts         typed event bus -> sockets + long-poll waiters
  http.ts        REST routes (owner cookie auth, agent bearer auth), dev routes
  socket.ts      Socket.IO push (rooms owner:<id>, agent:<id>)
  jobs.ts        approval expiry sweep, hot-wallet bypass watcher
  services/
    auth.ts       World ID enroll/login, sessions, nullifier replay guard
    agents.ts     create (keys, accounts, ENS), pause/resume/revoke, activity, audit
    intents.ts    payment requests -> policy decision, co-sign, settlement, receipts
    approvals.ts  the World ID approval gate, deny, expiry
  flow.test.ts   end-to-end attack + happy-path tests over HTTP
```
The API contract (REST + socket events) is in `docs/BACKEND_PLAN.md` §6.

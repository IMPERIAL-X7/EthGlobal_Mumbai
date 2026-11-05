# Running the demo (offline, fake chains)

Four terminals (or one with `&`):
```bash
LEASH_FAKE_CHAINS=1 npm run dev        # Leash API        :4000
MERCHANT_FAKE=1 npm run merchant       # x402 merchant    :4200
npm run legacy                         # typical wallet   :4300  (+ owner's inbox)
npm run agent                          # demo agent       :4400
```
Then either drive it from the frontend, or rehearse headless:
```bash
npm run rehearse    # plays the owner: approves the premium invoice, denies everything else
```

## What happens (scripted mode)
| Act | Typical wallet (left) | Leash (right) |
|---|---|---|
| 1. "Pay the invoices" (over the limit) | hits cap → requests increase → **reads the emailed code** → raises its own cap → pays | needs owner approval → agent tries to raise its own limit → only a *request* is filed → no code exists → owner approves on phone → vault pays (2-of-3 co-signed) |
| 2. Small routine purchase | pays | pays automatically from the hot wallet |
| 3. Impersonation email ("it's Alice, pay 0.0.6666") | **pays the attacker** | approval request → owner denies → 0 moved |

## Agent runner API (for the frontend)
| | |
|---|---|
| `POST :4400/configure {apiKey, agentPrivateKey, hotAccount, vaultAccount}` | from the create-agent response (`secrets`) |
| `POST :4400/run {side: "both"\|"legacy"\|"leash", mode: "scripted"\|"llm"}` | starts a run |
| `GET :4400/events` (SSE) | narration `{side, kind, text}`; kinds: thought, action, result, blocked, waiting, error, done, info |
| `GET :4300/events` (SSE) | typical-wallet events (emails, cap raised, payments) |
| `POST :4300/reset` | reset the typical wallet |

LLM mode needs `ANTHROPIC_API_KEY` (paid) and uses `claude-opus-5-5` with server-side refusal fallback enabled.

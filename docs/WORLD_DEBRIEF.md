# World ID integration debrief

What we built: IDKit 4 (`@worldcoin/idkit-core` 4.6.0, headless) with server-side request signing and verification through `POST https://developer.world.org/api/v4/verify/{rp_id}`. Staging environment, tested with the World ID Simulator.

Three flows:

| Flow | IDKit call | What the server checks |
|---|---|---|
| Sign up | `IDKit.request({ action: "leash_enroll", session_id: "create" }).preset(proofOfHuman())` | World verify, action, unused nullifier, then stores the session ID |
| Sign in | `IDKit.proveSession(sessionId).constraints(CredentialRequest("proof_of_human"))` | World verify, session belongs to an owner |
| Approve a payment | `proveSession` with `CredentialRequest("proof_of_human", { signal: approvalId })` | World verify, session is the owner's, `signal_hash` equals `hashSignal(approvalId)`, unused nullifier, approval still pending |

## Time to first success

About 40 minutes from an empty portal to a verified sign-up proof on our server. Most of it was finding the right values in the portal (app ID, RP ID, signing key).

Sign-in and approvals took longer, about 2.5 hours, because of the issues below.

## Friction we hit

1. **The signing key looked like an address.** The portal showed the signer's address next to the key. We pasted the 40 hex character address instead of the 64 character private key. `signRequest` only failed later. A clearer label ("private key, shown once") or a length check would save time.

2. **Session proofs return the nullifier in a different place.** Uniqueness proofs have `responses[0].nullifier`. Session proofs have `responses[0].session_nullifier[0]`. Our parser only knew the first shape, so sign-in failed after World had already accepted the proof. The types in `idkit-core` are correct; the docs examples only show the first shape.

3. **Session proofs carry no action, so an action in the RP signature breaks them.** We signed every approval request with its own action. World App then rejected it with `invalid_rp_signature`. The fix was to sign session requests without an action and bind the request with `signal` instead. This is the most important thing to document: how to bind a session proof to one specific operation.

4. **`.preset()` throws on session flows.** "Presets are not supported for session flows. Use .constraints() instead." Clear message, but the quickstart does not show `proveSession` with `constraints`.

5. **Expired requests fail late and vaguely.** The RP signature lasts up to 5 minutes. If the user approves after that, the simulator reports `proof_generation_failed` or "invalid/expired code" and IDKit returns `generic_error`. We now create the request only when the user presses Approve and show a countdown. Returning a specific `rp_signature_expired` to the client would help.

6. **The normal World App cannot scan staging codes.** This is expected, but new users try it first. A short note next to the QR ("Testing? Use the simulator or the sandbox app") would help.

## Missing capability or documentation

- An official example of **binding a session proof to one operation** (payment, transfer, permission change). This is the core of any human-in-the-loop product, and it is not obvious that `signal` is the tool for it.
- A way to show **operation details inside World App** that are covered by the proof. Today `action_description` is display text the app chooses. If the proof also committed to that text, a user could trust what World App shows them. This is exactly the gap the "Inalienable Human-in-the-Loop" paper points out.

## The one improvement with the most impact

Document "approve this specific action" as a first-class flow: a session proof plus a signal derived from the operation, with server-side checks, in one page with a working example. Every agent-payment product will need it, and we needed three bug fixes to get there.

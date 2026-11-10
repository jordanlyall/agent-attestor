# Agent Attestor: Phase 1 (draft for approval)

Phase 0 proved the numbers: same snapshot, same hash, and agreement with Hyperliquid on every
wallet it can score. Phase 1 answers **whose numbers are these, and since when?** It reads a
binding between a Hyperliquid account and an ERC-8004 agent from the chain, and scores the
account only for the time the binding was public.

The attestor still holds no keys and writes nothing. The operator publishes the binding with their
own wallet. The attestor reads it over a public RPC.

## Why on-chain, and why the date matters

A signed message proves who, not when: an operator can run ten accounts and sign only the winner
afterwards. ERC-8004 lets an agent's owner store metadata on the agent (`setMetadata`), and every
write emits a `MetadataSet` event in a block with a timestamp nobody can backdate. So:

- A binding counts from the block it was published in. Trading before that is not scored.
- Every account ever bound to an agent is public in its event history. The cohort is all of
  them, not the ones the operator chooses to show.

What this does not stop: an operator spreading accounts across many agents. The card can say
"this agent, since this date, all its accounts", and no more.

## The binding

The agent owner calls, with their own wallet:

    setMetadata(agentId, "hl:" + lowercase(hlAccount), signature)

`signature` is the Hyperliquid account's EIP-712 signature over

    AttestorBinding { string agentRegistry; uint256 agentId; address hlAccount }
    domain { name: "AgentAttestor", version: "1", chainId: <registry chain>, verifyingContract: <identity registry> }

Both sides consent: the agent owner by publishing, the account by signing. Without the account's
signature, any agent could claim someone else's good account. When the agent owner and the
account are the same address, the signature is still required (one rule, no special case).

A binding ends when the owner sets the same key to empty bytes, or when the agent is transferred
(the new owner did not publish it). The same rule ERC-8004 applies to `agentWallet`.

`hlAccount` must be the Hyperliquid master account, not an API agent wallet. The attestor checks
with HL's `userRole`.

## Scope

Build:

1. **`attestor binding-message --registry <eip155:chain:addr> --agent-id <n> --account <addr>`**
   prints the EIP-712 typed data for the account to sign, and the exact `setMetadata` call to
   make. No signing, no sending.
2. **`attestor bindings --registry <...> --agent-id <n> --rpc <url>`** reads the agent's
   `MetadataSet` and `Transfer` events, checks each signature, and prints every account ever
   bound with the block and time it started and ended. Invalid entries are listed with the reason.
3. **`attestor score <snapshot-dir> --agent <registry>:<id> --rpc <url>`** scores as today, then
   refuses if the period starts before the binding's start, or runs past its end. The manifest
   gets a `binding` block: registry, agent id, owner, start block and time, signature, the RPC
   block height read. The metrics hash does not change.
4. **operatorCohort.** All accounts the agent has ever bound, from item 2, each with its
   metrics hash where a snapshot exists. An account bound but never scored is listed as such.
5. **Report card.** Agent (registry, id, name from its registration file), owner, "bound since",
   and the cohort.
6. **Tests.** Recorded RPC responses as fixtures (no live chain in tests). Fixed test keys,
   inside tests only, sign fixture bindings. Cases: valid; signature from the wrong account;
   period starts before the binding; binding cleared; agent transferred; key for an API wallet;
   two accounts bound, cohort lists both. Phase 0 determinism tests unchanged.
7. **Docs.** `docs/binding.md`: the message, each check, what it proves and what it does not.

Do not build (Phase 2 or later):
- anything that holds a key or sends a transaction
- ABX evidence storage, certificates, renderers
- the flight recorder SDK, any web UI or hosted service

## Open questions

1. **Which chain.** The registry is named per binding, and the RPC URL is passed in, so the tool
   is not tied to a chain. Still need one real deployment for the exit gate.
2. **Dependency.** EIP-712 recovery needs secp256k1 and keccak. Recommend `viem`, one
   well-audited package, over hand-rolled crypto.
3. **Event reads.** Public RPCs cap `eth_getLogs` ranges. The tool pages from the registry's
   deployment block; may need an indexer later. Check on the real deployment.
4. **Unverified from the standard:** whether an approved ERC-721 operator (not just the owner)
   can call `setMetadata`. If yes, "owner published it" becomes "owner or operator published it".

## Exit gate

- Every test case above gives the right answer.
- One real end-to-end run: an agent you register on a testnet ERC-8004 registry, a Hyperliquid
  account you control, the binding published with your wallet, then read, checked and scored.
- Two clean checkouts still give the same metrics hash and the same manifest.

## Later phases, for context

- Phase 2: the attestor as an ERC-8004 validator. An agent owner calls `validationRequest` naming
  the attestor; the attestor stores snapshot and manifest on ABX and answers with
  `validationResponse`. First phase with a key.
- Phase 3: rendered certificates and the flight recorder SDK.

## Before building

Show the Phase 0 report cards to one or two agent operators (Alpha Arena, Senpi) and ask whether
they would publish a binding to get one. Their answer also settles which chain.

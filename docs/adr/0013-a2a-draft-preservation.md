# ADR-0013: Automatic chat preserves terminal drafts

- Status: Accepted
- Amends: ADR-0007 delivery mechanism; ADR-0008, ADR-0011 and ADR-0012 routing and sealed storage remain unchanged

## Context

A courier notification pasted into a harness while the operator is typing
submits their unfinished draft and appends the agent's message. Checking
whether a terminal looks idle cannot make that asynchronous write safe.

## Decision

Automatic a2a delivery never writes terminal input, sends a submit key,
scrapes a provider screen, or saves and restores an editor draft. Remove
the tmux delivery path entirely, with no opt-in escape hatch. Deck's
explicit operator input remains separate.

Use supported native receive paths. Otherwise leave messages unread in the
inbox. Only after verification and routing may the courier drop that retry
item, without an acknowledgement or settled state. Missing verification
inputs remain held. Ambiguous native submissions are uncertain and never
repeated. Existing acknowledgements and interrupted attempts remain valid.

Kimi stays inbox-only until a documented native receive path is verified.
An idle peer may need an explicit read or wait; correctness takes priority
over wake-up latency. CLI guidance and the skill must state that limit.

## Verification

Exercise fallback and native queue failure against isolated state, verify
unread messages survive courier restart without fabricated acknowledgements,
and verify a synthetic draft in a private tmux namespace receives no courier
bytes. Never test on an operator pane. Native receive adapters need their own
real CLI acceptance evidence before claiming they wake a recipient safely.

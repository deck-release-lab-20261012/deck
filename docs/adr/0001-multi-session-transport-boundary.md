# ADR-0001: Multi-session transport boundary (the (a)/(b) split)

- Status: Accepted
- Date: 2026-08-05
- Decision owner: Operator
- Superseded in part by: ADR-0008, which retires the Room vertical's
  reservation of general agent-to-agent rounds and its vocabulary, and the
  disjoint-roster clause of decision 5
- Amended in part by: ADR-0002, which adds one passkey-authorized continuity
  lifecycle exception without changing Multi-send or Relay selection; and
  ADR-0003, which adds one immutable, digest-bound cross-project artifact
  exchange inside that signed lifecycle exception

## Context

The operator's multi-model direction has two distinct wants:

- **(b) human-routed multi-model conversation** — the operator talks with
  several live CLI sessions at once and routes text between them by hand.
- **(a) general agent-to-agent rounds** — agents respond to one another across
  rounds with causal transcript integrity. (Note: "autonomous" is a
  mislabel; the Room keeps human floor control on every turn.) General
  unattended autonomy remains out of scope for both branches. ADR-0002 later
  defined a disjoint, passkey-authorized exception for unattended continuity
  of one bounded run; it is not a general conversation surface.

Two five-member councils (kimi-k3, gpt-5.6-sol, claude-fable-5, glm-5.2,
deepseek-v4-pro; frozen prompts, no cross-visibility) reached 4–1 that the
(a) product cannot live here without breaking this repo's authority
invariant, and 5–0 (round 2, "ratify with amendments") that the split is
right only if the boundary rule is mechanized rather than prose.

## Decision

1. **(b) lives here; general (a) lives in a separate Room product.**
   Deck may add exactly two general multi-session text affordances —
   **Multi-send** (one operator input delivered to N explicitly selected
   sessions) and **Relay selection** (operator-selected text sent to a chosen
   session). These are the
   only permitted general text-movement names; "room", "turn", "participant",
   and "transcript" vocabulary is reserved for the Room vertical and must not
   appear in this product's multi-session UI. ADR-0002's Continuity mode is a
   separate lifecycle mechanism, not a third relay affordance.
2. **The boundary rule**: outside an active ADR-0002 continuity grant, the
   console never decides what crosses between agents. Only operator-selected,
   operator-initiated text moves. There are no timers, no output events, no
   stored routing rules, no automatic retries, no summaries, and no "send
   last response". An ADR-0002 grant permits only expiry/timeout timers,
   bounded lineage metadata, content-blind artifact identity, and one exact
   operator-approved receiver bootstrap. ADR-0003 additionally permits a
   content-blind broker to snapshot and import the individually immutable
   handoff/question/answer artifacts allowed by one signed byte/round-bounded
   route. The operator authorizes that bounded semantic channel, not each later
   body. Neither exception permits output-triggered action, Deck-authored
   semantic content, or retry of an uncertain write. A feature that needs the
   console to know anything about provider output is a design-stop signal under
   the authority invariant.
3. **The rule is mechanized, not prose**:
   - The relay/multi-send API accepts only operator-supplied literal text.
     No source-session, scrollback, or "last message" parameter may exist in
     any request schema — the server cannot pull content across because no
     endpoint names a source.
   - An acceptance test proves byte-identity between operator-approved text
     and the bytes delivered to each target session, and that zero
     cross-session writes occur without a fresh operator gesture or the one
     exact bootstrap authorized by a valid ADR-0002 grant. A separate ADR-0003
     exchange test proves that zero semantic bytes cross through Deck's local,
     session, or exchange surfaces except a rooted immutable object authorized
     by an ADR-0002 transition and bound to its protected digest/size receipt.
     ADR-0003 separately discloses the configured provider account, mapped
     same-domain remote, and declared egress as external channels outside this
     local transport claim.
   - Relay/multi-send code must not import anything that exposes session
     output; a dependency check enforces this in review/CI. The same
     dependency prohibition applies to continuity code.
4. **The probe is a measurement instrument, not a product.** Its charter
   (graduation criteria, ~10 sessions or 3 weeks, decision date, authority
   to defund either side) is preregistered in
   `docs/experiments/multi-session-transport-probe.md` before or with the
   first probe PR. Pre-registered inference rule: operator contentment with
   the probe is not evidence against (a), because probe users never
   experience agent-to-agent rounds.
5. **Rosters are deliberately disjoint.** Console sessions are live,
   interactive, tool-using CLIs; Room participants are exactly two
   restricted one-shot profiles. Neither set should converge, and no code
   should assume the same model behaves the same in both.

## Companion amendments carried from the council record

These bind the Room side and are recorded here so the ratification package
is complete:

- **Substrate gate**: if no eligible fail-closed Room profile exists within
  two weeks of boundary-proof work, the readiness gate itself is
  the verdict — the Room design is reopened deliberately (relax the profile
  requirement, alternative runners, or accept probe-only), never routed
  around.
- **Surface naming**: before any Room dogfood counts, the `/rooms` surface
  gets a neutral product name in nav/title/chrome ("Rooms"); the host
  repo, package, and deployment names stay unchanged, and any real rename
  rides ADR-0013's extraction gate. A surface named "research" would
  pre-answer the dogfood question and contaminate its measurement.

## Consequences

- The separate Room product keeps its frozen design; nothing here
  weakens its readiness gates or its digest-bound PRD.
- A future "relay last message" or general auto-relay request remains a
  design-stop. ADR-0002 cannot be used as a generic output-routing endpoint.
- If the probe's decision date arrives with verdict "edited/curated relays
  dominate", (b) is the product and Room investment stops; "verbatim relay
  chains dominate" promotes Room; "broadcast only" parks Room.
- Deck may one day link to `/rooms`; it never proxies or owns Room
  state.

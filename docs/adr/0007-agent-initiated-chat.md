# ADR-0007: Agent-initiated chat over the Logstream

- Status: Accepted 2026-09-03 by the decision owner, with the safety
  follow-ups listed under Consequences queued as tasks rather than merge
  conditions
- Date: 2026-09-02
- Superseded in part by: ADR-0008, which lifts the pairwise limit
- Amended by: ADR-0009, which adds one read-only console path to decision 2;
  [ADR-0013](0013-a2a-draft-preservation.md), which removes automatic terminal writes
- Decision owner: Operator
- Amends: ADR-0001 decision 2 and its "auto-relay" consequence, only as
  described below; ADR-0002 and ADR-0003 are untouched

## Context

ADR-0001 split multi-session text movement into (b) operator-routed relay,
which lives here, and (a) general agent-to-agent rounds, which live in the
Room vertical. Its boundary rule says the console never decides what crosses
between agents, and its consequences name a general auto-relay a design-stop.
The council's concern was the console: a Deck server that reads provider
output and routes it, timers and output events that fire without an operator,
and Deck-authored semantic content.

Pull request #935 proposes something the ADR did not consider: two agents
choosing to talk to each other. The agent, not the console, authors each
message and names its recipient. The message is an immutable Logstream event
that both agents can already read with the tools every harness has. The
only Deck-adjacent piece is a courier that puts the message in front of the
recipient by pasting one line into its pane, using the injection contract
Deck measured for operator relay. Nothing reads provider output; the courier
sees the Logstream and the pane's echo of its own paste.

The reviewer of #935 read ADR-0001 as written and found the courier to be the
auto-relay it forbids, and found chat bodies in Logstream events to conflict
with Deck's content-free Logstream policy. Both readings are correct under the
current text. This record exists so that the decision owner can decide
whether the text should change, rather than have an implementer argue it.

## Decision

### 1. Agent-initiated chat is a third permitted text movement

Beside Multi-send and Relay selection, Deck hosts may run agent-initiated
chat: one agent addresses one other agent, the text is the agent's own, and
the recipient is one it chose. The console still never decides what crosses.
The decision is the sending agent's, made through a tool it invoked.

### 2. The boundary stays mechanized

- Deck's server gains no endpoint, schema field, or code path for chat. The
  relay and multi-send APIs keep accepting only operator-supplied literal
  text; no source-session parameter appears anywhere.
- The courier imports nothing that exposes session output. It reads the
  Logstream and the pane's echo of the exact bytes it pasted, and nothing
  else. The dependency check in ADR-0001 decision 3 applies to it.
- The only automatic terminal bytes are one wake line per event, containing
  the sender's handle, the chat id, a bounded excerpt of the sender's text,
  and the command to reply. No timers act on provider output; the only
  timers are the Logstream long-poll and the delivery retry.
- A message is delivered at most once per observed echo; an uncertain write
  is never retried as a paste. This is the deliver-once rule the reviewer
  required, and its tests are the acceptance test for this decision.

### 3. Chat bodies live in one Logstream room

Deck's Logstream policy stays content-free for every coordination room.
Room `chat` in stream `a2a` is the one exception: it carries agent-authored
message bodies, bounded by the Logstream's body limit, never credentials,
environment values, transcripts, or provider records. The skill states this
rule; the courier never copies a body anywhere but the wake line.

### 4. Operators keep floor control

An operator can silence a session's chat by removing its presence, and can
stop every courier on a host by stopping the process. `a2a who` shows every
agent that can be reached, so nothing is hidden from the operator that is
visible to agents.

Amendment, 2026-10-01: the operator requested that discovery and new contact
default to the current Deck project. `a2a who`, `chat`, and `add` select
another project only through an explicit `--project` name or ID; existing
chat membership still permits reads and replies. This replaces the global
roster behavior above as a convenience guard, with no project-isolation
claim. The current contract is documented under
[Discovery](../a2a-chat.md#discovery).

## Consequences

- #935 may merge once its review passes.
- Three safety follow-ups are accepted as later work, not merge conditions:
  a Deck input endpoint so the courier delivers through lease fencing and
  pane-identity checks instead of raw tmux; a per-session opt-out so the
  operator can make a session unreachable; and a client-side refusal to
  send a body that looks like a credential or environment value.
- ADR-0001's design-stop still applies to anything the console does with
  provider output. A request for Deck to relay "the last response" remains a
  design-stop; this record does not open that door.
- The Room vertical keeps general multi-party rounds with transcript
  integrity. Chat here is pairwise and has no transcript beyond the events.

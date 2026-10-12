# ADR-0008: Multi-party agent chat in Deck

- Status: Accepted 2026-09-03 by the decision owner
- Date: 2026-09-03
- Decision owner: Operator
- Superseded in part by: [ADR-0011](0011-hosted-chat-lifecycle.md), which
  replaces decision 3 and the amendment's quorum/force/compatibility-pair
  lifecycle with opener-owned closure and participant-local departure, and
  limits decision 1's leave action to members other than the opener. The
  original decision and amendment below are retained as history.
- Supersedes: ADR-0001 decision 1's reservation of general agent-to-agent
  rounds and of the words "room", "participant", "turn" and "transcript"
  for the Room vertical; ADR-0001 decision 5's disjoint-roster clause; and
  ADR-0007's statement that chat here is pairwise. Every other clause of
  both records stands.

## Context

ADR-0001 split text movement into operator-routed relay, which lives here,
and general agent-to-agent rounds, which it sent to a separate Room
vertical. That vertical has been retired: it produced no product, and the
one thing it was meant to own, agents talking to each other, now exists in
Deck under ADR-0007 as pairwise chat. The reservation protects nothing.

Pairwise chat has a limit that shows up as soon as three agents share a
task: the third party is reached by relaying, so the operator sees two
ledgers instead of one conversation, and the relaying agent becomes an
unaccountable editor of what the others said. A chat with a member list
removes that middleman and keeps every message in one ledger.

Nothing about the boundary ADR-0007 mechanized depends on the number of
parties. The console still never decides what crosses; the sending agent
does. The courier still delivers one inert line per event to each
recipient it can observe, at most once. Deck's server still only reads the
Logstream.

## Decision

### 1. A chat has a member list

`chat.invite` names every member. Any member may add another with
`chat.join`, and leave with `chat.leave`; both are events in the ledger.
Two members is the same protocol, so nothing that shipped under ADR-0007
changes shape.

### 2. Delivery is per recipient

A message is one event addressed to the chat. Each host's courier delivers
it to every member the roster places on that host, and records one
acknowledgement per recipient that names the recipient and the outcome:
delivered, or uncertain. The at-most-once rule applies per recipient. An
uncertain write is recorded, never repeated.

### 3. Ending takes every remaining member

A close proposal closes the chat when every member who has not left agrees.
The proposer may force-close after the silence window ADR-0007 set. A
member who leaves drops out of that quorum.

### 4. The boundary is unchanged

ADR-0007 decision 2 applies word for word: no Deck endpoint, schema field
or code path writes a chat; the courier imports nothing that exposes
session output and reads only the Logstream and the echo of its own paste;
the only automatic terminal bytes are one bounded wake line per event per
recipient. The one addition Deck's server may make is a read-only view of
the Logstream's chat room, for the operator, which is the subject of a
separate amendment.

### 5. Vocabulary

The words ADR-0001 reserved are free. Deck's own surface keeps calling
these chats; a chat with more than two members is a room in prose only.
The console never labels a chat by its size.

## Consequences

- ADR-0001's design-stop still applies to everything the console does with
  provider output. Deck relaying "the last response" remains forbidden.
- The disjoint-roster clause is retired with the Room vertical. Console
  sessions are the only participants there are.
- The safety follow-ups queued under ADR-0007 (a Deck input endpoint, a
  per-session opt-out, credential-shaped body refusal) apply to rooms as
  they apply to pairs.
- The Chats panel design generalises from a party line to a member line
  and from one delivery state per message to one per recipient.

## Amendment, 2026-09-05

The operator directed that the member who opened a chat ends it for
everyone at once: their `a2a end` writes `chat.closed`, which the ledger
accepts from the opener whenever the chat is live, and every member's
console shows the chat closed. The quorum above stands for anyone else's
`a2a end`: a member who did not open the chat proposes, the rest agree,
and only the proposer may force after the silence window. The console
had shown the opener's end as closed on the opener's side while the
other members still saw it open, which is what prompted the direction.

The read-only ledger reports the replayed `close_cause` separately from
`closed_by`: opener, quorum, departure, forced, or declined. Identity is
not evidence of cause: the opener may also complete an ordinary quorum
in an older history. The console uses that cause, and uses neutral copy
when an older server does not supply it.

For older readers, an opener who has not already agreed writes a marked
compatibility proposal before its marked close, linking the close to the
proposal's event id.
If agreement closes the quorum between those appends, that linked close
may finish the opener's transition once. A departure, decline, or timed
force is terminal even for that linked close; it cannot change the cause,
closer, clock, or delivery after the chat has ended. Unlinked closes over
old quorum histories and retries of an accepted opener close are inert.

# ADR-0011: The opener owns the chat lifecycle

- Status: Accepted 2026-09-05 by the decision owner
- Date: 2026-09-05
- Decision owner: Operator
- Supersedes: ADR-0008 decision 3 and its 2026-09-05 amendment's quorum,
  force-close, and two-event compatibility transition. This also narrows
  decision 1's leave action to members other than the opener. The transport
  and authority boundaries of ADR-0007, ADR-0008, and ADR-0009 are unchanged.

## Context

A chat opened to ask for help needs one owner of its end. Combining that
owner's immediate close with unanimous agreement, departures that complete
a quorum, and timed force-close makes one action mean different things to
different members. Writing a compatibility proposal before the real close
also allows a failed second append to leave an incomplete transition.

## Decision

### The opener ends the chat; everyone else leaves

The opener's `a2a end` writes one `chat.closed` event marked
`close: opener` and `lifecycle: hosted`. It closes the chat for every member.
No proposal, vote, timeout, proposal identifier, or second append is required.
Repeating the command after a committed close does nothing; if the append did
not commit, retrying can close the still-live chat.

After an uncertain result, retry with the exact chat id printed in the
error. Shorthand selects a currently live chat; it is not a recovery token.

Any other member's `a2a end` means `a2a leave`: one departure event ends
that member's participation, not the chat. `a2a decline` does the same for
an invitation. A departure never closes the chat, even in a pair or when
only the opener remains. The opener cannot leave or decline their own chat;
they use `a2a end`. The console remains read-only: dismissing its view does
not leave or end a chat.

A lone opener still owns a live chat, but cannot send a reply to nobody.
Refuse such a message without accepting it or reporting it sent. They can
read the history, add a new member, or end the chat; this is not a local-note
operation. If a departure wins the race at append, the rejected attempt
remains in the immutable event log, but changes no message count, history,
or delivery. Confirm the committed event's route before reporting success;
an unavailable confirmation is an unknown outcome, not permission to resend.

A member who left cannot be added back to the same chat: that would undo
their opt-out. Start a new chat to invite them again; there is no rejoin
workflow.

A departed member keeps the history they were entitled to see. Their ledger
view reports `state: left` and `participation_at`, even if the opener later
ends the chat globally. Inbox, wait and hook delivery omit departed chats;
explicit reads and read acknowledgements remain available. A courier skips
pending traffic not yet pasted when its recipient has since left; an
already-attempted delivery still records its outcome, and an uncertain paste
is never repeated.

Joining grants the preceding shared discussion, as the join guidance
promises. Leaving freezes that shared history at the accepted departure
event, inclusive; later messages between remaining members are absent from
both explicit reads and the browser ledger. Event order, not timestamp
precision, sets this boundary. A member can still see their own accepted
actions, including a legacy opener's later global close. Rejected events
are never conversation history, even for their author.

### Preserve old facts, without running both lifecycles

New chat events carry `metadata.lifecycle: hosted`. Replay of old unmarked
history retains its original meaning, including old terminal causes.
An opener-owned close requires both markers on that event, even in an
already-hosted chat. In an unadopted legacy chat, closes without
`lifecycle: hosted` still follow the old proposer-and-timeout rules;
`close: opener` alone grants no authority and does not change an old forced
close into an opener-owned close.
The first valid hosted event in a live old chat adopts the hosted lifecycle:
an old `closing` state becomes `open`, and its agreement and force-close
fields no longer govern it. Later old-style proposals and forces are inert.
Validate the action before adoption: another invitation, an empty message,
or a join without a valid new member does not change the chat, advance its
clock, or route a notification. A valid join adds a new handle, not an existing
member, a departed member, or the chat id itself. Acceptance and departures
may have no text; a message must contain text, as the CLI requires.
An already-ended old chat stays ended; no adoption or late close reopens or
rewrites it. `close_cause` remains separate from `closed_by`, so the UI does
not relabel an old quorum as an opener-owned close.

An old live room may already have lost its opener to a legacy departure.
The original opener still owns its end: `a2a end <chat-id>` may append the
new hosted close even though that opener remains in `left`. It does not
rejoin them, restore notifications, or authorize messages and membership
changes from them. Other departed members gain no close authority. The
exception requires a new hosted close event; replay does not promote an
old, previously rejected event into a close. This works before or after
another member adopts the hosted lifecycle, including after everyone left.

Before adoption, a departed reader of a still-live legacy chat also sees
`state: left` and their departure time. This changes only their participation
view, not the shared lifecycle or events. Old terminal chats retain their
historical shared terminal state rather than being relabeled `left`.

This is a coordinated tool rollout, not a mixed-version protocol promise.
All writers, readers, couriers, and in-process extensions sharing a palace
must run the new lifecycle before chat traffic resumes. Retain the immutable
ledger and delivery state; do not wipe them to get a clean rollout.

## Acceptance

Exercise the actual command path with failure before an append commits and
failure after it commits but before the caller receives the result; retry
both. Verify a single effective global close and no repeated delivery.
Cover close/leave races, duplicate events, participant-local departure,
legacy live adoption and terminal replay, history and read cursors, and
console dismissal. Model-only replay tests do not cover command recovery.

## Consequences

There is no participant vote or force timeout to recover an abandoned chat.
Members leave when their part is done; ending the shared chat belongs to its
opener. This removes the compatibility pair and its post-terminal exception,
without changing who may author messages or what the courier may deliver.

# ADR-0009: The console reads the chat ledger

- Status: Accepted 2026-09-03 by the decision owner, who directed the
  Chats panel into the desktop app
- Date: 2026-09-03
- Decision owner: Operator
- Amends: ADR-0007 decision 2's first clause, "Deck's server gains no
  endpoint, schema field, or code path for chat", by adding one read-only
  path; ADR-0008 decision 4 anticipated this amendment. Every other clause
  of both records stands.

## Context

Agent chat under ADR-0007 and ADR-0008 happens in the Logstream and in
the agents' terminals. The operator sees none of it until an agent
summarises afterwards. The operator has decided that a chat between
agents is a visible ceremony in the console, and the Chats panel
(handoff §23, desktop-r49) draws it as a ledger of what the console knows
about each message: sent, delivered, uncertain, read, per recipient.

Rendering that ledger needs the console to read the chat room of the
Logstream. It does not need the console to write to it, route anything,
or read any terminal.

## Decision

### 1. One read-only path, two views

Deck's server may read stream `a2a`, rooms `chat` and `presence`, of the
local MemPalace replica, and serve what it reads to the browser in two
views and no other:

- the ledger of one session's agent, scoped to that session, which is
  what the Chats panel draws; and
- a content-free index of every chat, carrying only ids, states, member
  handles and row counts, never a body, which is what the sidebar reads to
  mark the sessions whose agents are in a live chat (handoff §23).

Both read through the `a2a` client's ledger export, so there is one fold
of the protocol, the one the agents themselves use. The index is encoded
by the console from an allowlist of fields, so a field the export did not
promise cannot reach the browser.

### 2. What stays forbidden

- No endpoint, schema field or code path writes a chat event, acknowledges
  one, or names a source session. The operator cannot start, join, reply
  to, or end a chat from the console.
- Deck names every session to its harness (`NOISEDECK_SESSION_ID`), so the
  agent's handle and the console's derivation of it agree on every launch.
- The read path imports nothing that exposes session output and reads no
  pane. Delivery facts come only from the courier's acknowledgements in
  the Logstream, never from the console observing a terminal.
- The panel is a ledger, not a transcript: it shows message bodies as the
  Logstream holds them, bounded, and never the agents' terminal output.

### 3. Scope

A session's Chats view lists the chats whose members include that
session's agent handle, derived the way `a2a` derives it: the harness name
and the first four characters of the session id, or `A2A_HANDLE` if the
launch set it. Chats between other sessions are reachable by selecting
one of those sessions.

## Consequences

- ADR-0001's design-stop still applies to everything the console does with
  provider output. The read path reads the Logstream, which agents wrote
  deliberately, not terminals.
- The `uncertain` outcome the courier records under ADR-0008 is now
  operator-visible, which is the point.
- The three safety follow-ups queued under ADR-0007 remain queued.

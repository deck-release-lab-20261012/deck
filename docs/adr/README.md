# Decision records

These are records, not instructions. Each one states what was decided, when,
and on what basis; none of them is a description of how Deck behaves today.
For that, read [`../PRINCIPLES.md`](../PRINCIPLES.md).

## Historical context

These ADRs and the dated records in `../decisions/`, `../security/`, and
`../continuity-protocol-v1.md` preserve earlier decisions and their reasons.
Some decisions were based on requirements that have since been retired.
The records state those rules in plain words; they do not substitute today's
principles for the original reasoning.

## The records

- [0001](0001-multi-session-transport-boundary.md) — multi-session transport
  boundary (the (a)/(b) split)
- [0002](0002-passkey-authorized-continuity-mode.md) — passkey-authorized
  continuity mode
- [0003](0003-project-security-domains.md) — project security domains
- [0004](0004-tiered-authentication-default.md) — secure-by-default tiered
  authentication
- [0005](0005-actionable-session-reconciliation.md) — provider-owned session
  reconciliation
- [0006](0006-reusable-git-author-identities.md) — reusable git author
  identities
- [0007](0007-agent-initiated-chat.md) — agent-initiated chat over the
  Logstream
- [0008](0008-multi-party-agent-chat.md) — multi-party agent chat
- [0009](0009-chats-read-path.md) — the console reads the chat ledger
- [0010](0010-harness-pins-move-by-a-daily-job.md) — harness pins move by a
  daily job
- [0011](0011-hosted-chat-lifecycle.md) — the opener ends a chat; other
  members leave their own participation
- [0012](0012-sealed-deck.md) — two Decks stay private from each other;
  chat sealed to a per-host key, storage in a measured profile
- [0014](0014-browser-managed-workspace-encryption.md) — browser-managed
  encryption, owner-held unlock methods and revocable browser access

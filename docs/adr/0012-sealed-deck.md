# ADR-0012: Sealed Deck

- Status: Accepted 2026-09-06 by the decision owner, who chose the
  shared-host profile and the bounded adversary
- Date: 2026-09-06
- Decision owner: Operator
- Further amended by: [ADR-0014](0014-browser-managed-workspace-encryption.md),
  which specifies browser-managed enrollment and unlock without widening
  this record's host threat boundary
- Amends: nothing. ADR-0007 decision 2 as amended by ADR-0009, ADR-0008,
  and ADR-0011 stand unchanged; this record adds how bodies are stored and
  which host may open them, not who may write or deliver them.

## Context

The operator wants a second person on Deck: a partner running their own
single-operator instance on the operator's machine, whose agents can talk
to the operator's agents. The partner will adopt Deck only if the operator
cannot read the partner's private chats.

`PRINCIPLES.md` makes Deck single-tenant and unconfined, with real
boundaries only for credentials and for anything that crosses a real
boundary. A second person is such a boundary, so two people means two
Decks. Deck runs unmodified agent CLIs that read prompts and write replies
in the clear, so the host that runs the partner's agents necessarily sees
their plaintext. No design changes that, and a record claiming otherwise
would be false.

The survey behind `docs/sealed-deck-prd.md` found one cross-host channel,
MemPalace palace replication, which copies the whole palace including the
hook forwarder's transcript checkpoints, and no telemetry. On disk, the
sensitive state is six mounts, two of them Docker named volumes under
`/var/lib/docker` and one of them the production overlay's disk-backed
`/tmp`. The current container cannot classify its own backing: its data
mounts are btrfs on a device with no sysfs entry, and it has no
`/dev/fuse`. The current backup command stages a plaintext copy beside its
destination.

## Decision

### 1. The adversary is the other operator running ordinary reads as root

The requirement is bounded and stated before anything is called sealed:
the other operator using `sudo cat`, directory listing, `docker inspect`,
and ordinary reads of workspace files, stored logs, backups and relay replicas must see
ciphertext or be denied. Process memory inspection, identity switching,
`docker exec` or namespace entry into the partner runtime, altered FUSE
settings, hostile code updates and credential interception are excluded
capabilities. Swap and other persisted memory images are outside this live-file
denial claim: personal swap may contain plaintext, and host root can read an
active encrypted swap mapping. Some excluded capabilities are simple to run. They are excluded because
the operator chose this bound on 2026-09-06, not because they are hard,
and the onboarding document says so. If the partner later needs more, this
record is reopened rather than stretched.

### 2. Palaces never merge; a relay palace carries stream `a2a`

Each host keeps its private palace on loopback port 8765 with no
`peers.json` and no route from the network. A second MemPalace server on
port 8766 serves a relay palace whose only content is stream `a2a`, and it
is the only thing that syncs between hosts. If MemPalace cannot restrict a
server to one stream, a filtering proxy in front of the relay is the
enforcement owner. Memory, transcript checkpoints, the control database
and projects stay on their owner's host.

### 3. Chat is sealed to a per-host key, pinned by a person

Each host holds one X25519 key. Every chat body in the relay stream is
sealed with NaCl box from the sender host's key to the recipient host's
key, with a versioned envelope in metadata that binds sender, recipient,
chat id, event type and nonce. Fingerprints are pinned out of band, by the
two operators reading them to each other. Sending to an unpinned or changed
key is refused with the reason. There is no flag, environment value or
prompt that sends plaintext instead. Local chats seal to the host's own
key so there is one code path. The other operator's host holds the
partner's private chat only as ciphertext it cannot open; chat deliberately
addressed to the other operator's agents is readable there, as intended.

### 4. At rest is a volume, in one of two measured profiles

Deck does not rewrite a harness's files, so encryption at rest happens
below the application. A profile is a layout a preflight can check and a
person can follow.

- **Shared host**, the chosen profile: the partner's state root is a
  gocryptfs directory mounted by a dedicated partner uid without
  `allow_other` or `allow_root`, on a kernel whose `allow_sys_admin_access`
  is off, unlocked by a passphrase only the partner holds. Swap remains
  available under the independent policy below.
  The operator's whole-disk LUKS does not count, because the operator
  unlocks it.
- **Own host**, the stronger alternative: whole-disk LUKS on hardware where
  the operator holds no administrative, recovery or update credential.
  Swap uses the independent policy below.

Swap policy is independent of filesystem layout: `personal` is the default and
permits ordinary swap; opt-in `paranoid` requires active, verified dm-crypt swap
and refuses plaintext or unverifiable backing. This replaces the original
shared-host no-swap rule. Encryption of swap protects offline backing, not a
running host's decrypted mapping. Neither mode promises erasure of pages left
by earlier runs. Hibernation remains refused; crash dumps and VM memory snapshots
need separate deployment controls. See the [swap deployment guide](../security/workspace-swap.md).

A host-side preflight resolves every store in the state root to its
backing and refuses to start Deck otherwise, before provisioning, MemPalace,
the courier or any CLI writes. It hands the container a boot-scoped report
that the container cross-checks by boot id and mount id; the report alone
authorizes nothing, and neither does an environment value or a marker
file. Backups are encrypted to an age recipient with plaintext staged only
under the state root. Fscrypt is not an accepted backing until a host
qualifies it.

### 5. What is not claimed

No forward secrecy: a leaked host key opens every past body that host sent
or received, and rotation is a new announce plus a new pin by hand. No key
escrow. No hiding of the presence roster or of the fact that a chat
happened. No chat across more than two hosts. No protection of live memory,
tmux scrollback or an unlocked machine. No confinement: this record does
not satisfy ADR-0003's gate, enable Continuity, or turn a pinned host into a
project capability.

## Consequences

The requirements, the acceptance rows a real deployment must satisfy, and
the phases are in `docs/sealed-deck-prd.md`. Phase 1 is the storage
profiles and encrypted backups and needs no cryptography inside Deck
beyond the age library. The shared-host profile cannot be qualified in the
current container, which has no `/dev/fuse`; its qualification waits on a
host where the mount can be composed and root-read for real, and until
then the profile is documented, not proven.

The a2a client takes one dependency, PyNaCl, pinned on the interpreter that
actually runs the client, the courier and the ledger subprocess. Missing
crypto refuses sealed chat and never falls back to plaintext.

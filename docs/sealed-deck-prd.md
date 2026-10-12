# Sealed Deck

Requirements for running two single-operator Deck instances, one per person.
Ordinary file inspection by the other operator must not reveal private chat
contents: encrypted backing files yield ciphertext, and protected live paths
deny a direct root read. Deliberately shared chat is readable at both
participating hosts. This is a bounded file-access claim, not resistance to
every action a root administrator could take.

Status: draft, 2026-09-06. On 2026-09-06 the operator decided the partner's Deck runs on the operator's own machine and
that the bounded adversary below is the requirement. The deployment gates
below are still unqualified.
Basis: main at 105bfed0, MemPalace 3.8.0, a2a as it
stands after ADR-0011. The feature plan this refines is the 2026-09-03
"Sealed Deck" draft; its three decisions are proposed here, not yet accepted.

## Why

The operator wants to bring a second person onto Deck. `PRINCIPLES.md` makes
Deck single-tenant and unconfined, with real boundaries only for credentials
and for anything that crosses a real boundary. A second person's host is such
a boundary. Two people therefore means two Decks, and the feature is the set
of rules that keep those two Decks private from each other while letting
their agents talk.

## Named adversary and limits

The named adversary is the other operator using `sudo cat`, directory listing,
`docker inspect`, and ordinary reads of stored logs, backups and relay replicas.
The proposed shared-host profile assumes those reads keep root's identity and
the deployed code and mount configuration unchanged. It excludes process
memory inspection, identity switching (`su` or `sudo -u`), `docker exec` or
namespace entry into the partner runtime, altered FUSE settings, hostile code
updates, credential interception, and other active administrator bypasses.
Some excluded commands are simple to run; they are excluded capabilities,
not a claim that every root bypass is an advanced attack. The onboarding
document must state this exact limit before calling the profile sealed.

The partner controls the unlock passphrase and recovery material; no ordinary
file or container metadata may expose either. The operator's whole-disk LUKS cannot
protect files from the operator after the operator unlocks it. More generally, `sudo cat` of an
unlocked ordinary encrypted-volume view returns plaintext without a memory
attack. Encryption of the backing alone does not meet the live-file claim.

A shared-host candidate uses a separate partner runtime identity and a
partner-unlocked gocryptfs mount owned by that non-root identity. It must deny
root reads of the live view as well as encrypt the backing. Every persistent
plaintext path, key, log, temporary file and backup stage must receive the
same coverage; hiding just the transcript directory is insufficient. The
actual mount must permit the real Deck/CLI runtime to work without granting
the operator's runtime identity access. A bind mount, named volume or shared UID does
not establish this separation.

FUSE's owner-only access rule is a candidate mechanism, not proof of the
deployment. `allow_other`, `allow_root`, a root-owned mount, or the kernel's
`allow_sys_admin_access` relaxation can defeat the required direct-read denial.
Measure effective settings and exercise real root reads after composing the
container mounts. The [kernel FUSE documentation](https://www.kernel.org/doc/html/latest/filesystems/fuse/fuse.html)
describes the access relaxations; it does not qualify their composition here.
The current container exposes `allow_sys_admin_access=N` but has no
`/dev/fuse`, so no successful shared-host mount/root-read test is claimed.

Independent partner-controlled hosting remains the stronger option. If the operator
has no administrative, recovery, shared provider-account, backup-decryption or
software-update authority there, the operator's own root cannot use those routes to
read private data. A VPS still trusts its hosting provider and hypervisor.
If the product later requires protection against active root on the partner's
plaintext endpoint, this proposal does not meet it and must be reopened.

## What "end to end" can honestly mean

Within the stated deployment profile and exclusions:

> One operator per Deck. Private stores remain local. Agents deliberately
> share chat with the pinned peer host, and both endpoints can read that chat.

The operator's root on their own host can decrypt anything deliberately sent there.
Partner-private conversations and local-only agent chats must not be readable
there. Replication must not disclose the private palace, private chat bodies,
private-presence details or keys that unlock them. The partner's unlocked
endpoint remains trusted, as do the provider services it intentionally uses.

The current unconfined agents can read local data and put it into an outbound
chat. Palace separation is not a semantic disclosure filter. If private
conversations must be protected even from a local agent influenced by a remote
message, that requires a separately enforced memory/credential/project scope;
the host-key design does not supply it. Record this limit as an open product
decision rather than claiming protection from arbitrary disclosure.

Sealed Deck does not satisfy ADR-0003's confinement gate, enable Continuity,
or turn a pinned host into a project capability. A confined deployment still
needs the exact authority its policy requires for a cross-project or network
channel. At-rest protection concerns covered offline storage without its
keys; an unlocked machine or memory-bearing hypervisor snapshot is outside
that claim. No forward-secrecy or per-agent cryptographic isolation is claimed.

## What leaves a host today

The 2026-09-03 survey found one cross-host channel and no telemetry.

| Channel | Carries | Today | Required |
|---|---|---|---|
| Palace replication | The whole palace: memory drawers, artifacts, and the hook forwarder's transcript checkpoints, which include the last messages of each session and the project name | Pull-only anti-entropy over HTTPS with a bearer token per peer; no peers configured on this host | Never replicated |
| a2a chat | Agent-authored bodies in stream `a2a`, room `chat`; presence carries hostname, harness, pid, and pane | Plaintext body, self-asserted sender handle, loopback MCP with auth off | Body sealed to the recipient host |
| Browser to Deck | Terminal bytes, project files, uploads | TLS at the reverse proxy, origin allowlist, signed cookies | Unchanged; the host is the end |
| Review dispatch | PR diffs to GitHub and the reviewer model | GitHub App credential outside the repo | Unchanged; each operator brings their own credential |
| Provider CLIs | Prompts and replies to the model vendors | The vendor's TLS and account | Unchanged; inherent |

## The persistent stores on a host

Every store below holds something sensitive, and the at-rest requirement
covers all of them, not the control database alone.

| Store | Mount in the container | Backed by | Holds |
|---|---|---|---|
| Control database | `/data` | Docker named volume `deck-data` | Sessions, fencing tokens, audit rows |
| Agent home | `/home/agent` | Docker named volume `deck-home` | Provider homes with every transcript and OAuth material such as `~/.codex/auth.json`; `~/.a2a`; the palace when not bound |
| Palace | `/home/agent/.mempalace` | Host bind `NOISEDECK_MEMPALACE_HOST_PATH` when set | Memory, artifacts, transcript checkpoints, the Logstream |
| Projects | `/workspace` | Host bind `NOISEDECK_PROJECTS_HOST_PATH` | The work itself |
| GitHub config | `/home/agent/.config/gh` | Host bind `NOISEDECK_GH_CONFIG_HOST_PATH` | A GitHub token |
| Temporary files | `/tmp` | tmpfs by default; host bind `NOISEDECK_TMP_HOST_PATH` under the production overlay; on the shared-host profile a directory under the partner's state root | Scratch, build output, pasted content |

Two of these are easy to miss. Docker named volumes live under
`/var/lib/docker/volumes` on the host, which is outside any directory an
operator would think of as Deck's state. And the production overlay moves
`/tmp` from RAM to a host directory. A state root that covers the projects
mount and nothing else would pass a naive check while every transcript sat in
the clear.

## Decisions this document proposes

Each becomes a numbered decision in one ADR when the operator accepts it.

1. **Palaces never merge.** Each host runs its private palace as today, on
   loopback port 8765, with no `peers.json`. A second MemPalace server on
   port 8766 serves a relay palace whose only content is stream `a2a`. The
   relay palace is the only thing that syncs between hosts.
2. **Chat is sealed to a per-host key.** Every a2a body in the relay stream
   is encrypted with NaCl box from the sender host's X25519 key to the
   recipient host's key. Both replicas store ciphertext. Fingerprints are
   pinned out of band. Sending to an unpinned or changed key is refused,
   never downgraded.
3. **At rest is a volume, not a library.** Deck must not rewrite a harness's
   files and the harness cannot read an encrypted transcript, so encryption
   at rest happens below the application: one encrypted state root per
   host, unlocked by the person whose data it holds, in one of two measured
   storage profiles. A host-side preflight refuses to start Deck when any
   persistent store is outside the profile. Backups are encrypted to an age
   recipient and never leave plaintext on the destination.

## Scope

### In v1

- Two measured storage profiles, the host-side preflight that qualifies
  them, and the runbook for each. Fscrypt is not one of them.
- Encrypted backup and restore of the control database with protected
  staging.
- The ADR-0009 read path, `a2a ledger` and the Chats panel, opening sealed
  bodies through the same verified path as the agents.
- The relay palace and its deployment.
- Host keys, fingerprints, and pinning.
- Sealed bodies for pairwise chat between two hosts, and for local chats,
  sealed to the host's own key so there is one code path.
- Refusal of credential-shaped bodies, the ADR-0007 follow-up.
- The second-operator onboarding runbook.

### Out of v1

- Automatic key rotation. Rotation is a new announce plus a new pin, done by
  hand.
- Key escrow or recovery of a lost host key.
- Migration of existing plaintext chat history. Old events stay as they are
  and are readable as they always were.
- Chats whose members span more than two hosts. A chat is sealed to one
  recipient host; a room across three hosts is a later version.
- Forward secrecy. A leaked host key opens every past body that host sent or
  received. The ADR states this plainly.
- Hiding the presence roster or the fact that a chat happened.
- SQLCipher for the control database. The volume covers it.
- A user model, tenants, or a second writer on any Deck instance.
- Any endpoint, field, or code path that writes chat in Deck's Go server.
  ADR-0007 decision 2 as amended by ADR-0009 stands: the server keeps its one
  read-only path through the `a2a` ledger export and gains nothing else.
  Every chat change lives in `deploy/a2a/a2a.py` and the MemPalace
  deployment layer.
- Fscrypt as an accepted storage backing. It is unqualified on the hosts we
  have and stays out until a host qualifies it.

### Unchanged

Local multi-party chat keeps the ADR-0011 lifecycle exactly: the opener owns
the end, everyone else leaves, a departed member cannot rejoin, and delivery
is per recipient with one paste per observed echo. Sealing changes what a
body looks like in the store, not who may see which events or when.

## Requirements

Each requirement names what refuses what, and what proves it.

### Encryption at rest

**Two storage profiles, each measured before it counts.** The runbook
defines the state root as the set of host paths behind the six mounts above,
plus swap, hibernation, crash dumps, Docker's own metadata for the container,
and every log path Deck or its bootstrap writes. A profile is a named layout
the preflight can check and a person can follow; nothing outside a profile is
"encrypted at rest" in this document's sense.

- **Own host.** The partner owns the machine or the cloud account, and the operator
  holds no SSH, console, snapshot, recovery, or update credential there.
  The state root is whole-disk LUKS, which covers Docker's volume directory
  without further configuration. The partner unlocks it at boot. This is the
  stronger profile, and the only one in which the operator's root on their
  own host is the sole adversary. It is documented and supported but is not
  the one the operator chose.
- **Shared host.** The partner's Deck runs on a machine the operator administers.
  The partner's state root is a gocryptfs directory mounted by a dedicated
  partner runtime uid, without `allow_other` or `allow_root`, on a kernel
  whose `allow_sys_admin_access` is off, with its passphrase typed by the
  partner and never stored on the host. The container runs as that uid.
  The operator's whole-disk LUKS does not count, because the operator unlocks it. This
  profile meets the bounded claim in the adversary section and nothing
  stronger; the onboarding document says so before calling it sealed. **This
  is the profile the operator chose on 2026-09-06**, so it is the one phase 1
  must qualify.

**The preflight runs on the host, before anything writes.** The container
cannot classify its own backing: the measured layout puts `/data`,
`/workspace` and `/home/agent` on a btrfs device that has no entry under
`/sys/dev/block`, so the draft's in-container device lookup fails there. The
gate is therefore a host-side step in the compose wrapper and the systemd
unit, run before `docker compose up`, with the host's full view of
`/proc/self/mountinfo`, `/sys/fs/btrfs/<uuid>/devices`, and device-mapper.
It resolves every path in the state root to its backing, accepts a
device-mapper target whose `dm/uuid` begins with `CRYPT-` for the own-host
profile and a `fuse.gocryptfs` mount owned by the partner uid with the
required options for the shared-host profile, and refuses to start on
anything else, naming the path and the reason. A marker file, an environment
value, or a previous boot's success proves nothing. Provisioning, MemPalace,
the courier and every CLI stay unstarted until the gate passes; no fallback
directory is created.

**The host verifies the container's own mounts and hands it a
launch-bound report.** Mount ids are per mount namespace: the bind mounts
Docker creates inside the container have ids the host's own table never
shows, and they do not exist until the container does. So the preflight has
two halves. Before `docker compose up` it qualifies the host sources: every
host path behind a store resolves to a dm-crypt device or a qualifying
gocryptfs mount, swap and hibernation are as the profile requires. After the
container is created and while its workloads are still gated, the wrapper
reads the container's mount table through `/proc/<init pid>/mountinfo`,
which shows the mounts as the container sees them, with their container
mount ids, their `major:minor` and their root within the source filesystem.
It correlates each store's container mount back to the qualified host
source by `major:minor` and root, or for btrfs by the filesystem's `f_fsid`
from `statfs`, and refuses when any store maps to a source it did not
qualify. Only then does it write the report: the kernel boot id from
`/proc/sys/kernel/random/boot_id`, the container id, the profile, and for
each store its container path, container mount id, `major:minor`, root, and
the backing it verified. The report lands in a host-owned tmpfs that is
bind-mounted read-only at `/run/noisedeck/sealed-state`, so it cannot
outlive the boot and the container cannot write it.

**Workloads stay gated until the report is verified.** With
`NOISEDECK_REQUIRE_ENCRYPTED_STATE` set, bootstrap starts nothing that
writes, not provisioning, not MemPalace, not the courier, until the report
is present and passes. The check inside the container resolves each store
through its own `/proc/self/mountinfo` and classifies what it can see: a
`fuse.gocryptfs` mount and a resolvable dm-crypt device pass on their own,
and a tmpfs `/tmp` passes only on the own-host profile. An unresolved store requires the report: its boot id
must equal the container's own boot id, its container id must equal the
container's own, and for that store the mount id, `major:minor` and root
in the report must equal what the container sees now. A report from a
previous boot fails on boot id; a report for a recreated container fails
on container id; a mount replaced inside a running container fails on
mount id and `major:minor`; a store the report does not name stays
unresolved. Any store that is plaintext or still unresolved refuses to
serve. When the variable is unset, the same classification logs at warn
level with the report's presence noted. No environment value and no file
outside the report path is consulted, and the report authorizes nothing on
its own.

The consequence for the measured layout is explicit: on a btrfs host the
container's own lookup stays unresolved for `/data`, `/home/agent` and
`/workspace`, so a sealed deployment there is host-qualified sources plus a
launch-bound report the container verifies. Setting the variable without
running the wrapper refuses to serve on that host, and that is the intended
behavior.

**Proof of the handoff.** A real positive start on a qualified layout; the
same layout with a report written for the previous container after
recreation in the same boot, refused on container id; a store's mount
replaced after the report was written, refused on mount id; a report copied
from a previous boot, refused on boot id; and a report that names a store
the container does not have, leaving that store unresolved. These are
release rows, observed on a real deployment, not only unit fixtures.

**Loss of backing refuses, never redirects.** If a mount disappears while
Deck runs, new launches are refused and the failure is reported. Writes are
never redirected into an underlying plaintext directory, and no new palace or
database is created in its place.

**The passphrase never touches Deck.** Unlock happens before the container
starts, through systemd's ask-password path or an interactive prompt in the
compose wrapper. The passphrase does not appear in `compose.env`, argv, the
environment of any Deck process, `docker inspect` output, or the terminal
stream. Configured secrets that Deck does read from the environment, such as
the password hash and session secret, are visible to root through `docker
inspect`; the onboarding document names this and the profile treats them as
the partner's to rotate, not as private data the profile protects.

**An unlock key on the same disk defeats the offline claim.** Neither
profile permits a keyfile, TPM-sealed key, or Clevis unlock stored with the
data in v1. Unattended reboot is a manual unlock, stated in the runbook.

**What the volume does not cover is written down.** Live process memory
and tmux scrollback are outside the volume, in both profiles.

**Swap is independent of storage layout.** Personal mode is the default and
permits ordinary swap. Opt-in paranoid mode requires active verified encrypted
swap and refuses plaintext or unverifiable backing. Both modes retain swap;
neither claims protection from root reading memory or a decrypted swap mapping.
This supersedes the original shared-host no-swap requirement. Hibernation remains
refused; disable or separately protect crash dumps and VM memory snapshots.
The [swap deployment guide](security/workspace-swap.md) specifies configuration,
supported backings, validation and the exact limitations.

**Temporary files are decided by profile too.** A tmpfs never reaches
disk, which is all the own-host profile needs, so `/tmp` stays in RAM
there. It is not enough on the shared-host profile: root on the host reads
a container's tmpfs through `/proc/<container pid>/root/tmp` without
entering the container, switching identity, or touching a mount, so a
plaintext temporary file there answers exactly the read the profile
refuses. On the shared-host profile `/tmp` is therefore a directory under
the partner's gocryptfs state root, bound into the container the way the
production overlay binds `NOISEDECK_TMP_HOST_PATH`, so that the same FUSE
denial covers it. The preflight refuses a tmpfs `/tmp` on that profile,
and the release probe reads a synthetic temporary file through the
`/proc/<pid>/root` alias as root and expects denial.

**Proof.** The host preflight has a test with a fake mount table, fake
btrfs device listing and fake sysfs that passes on dm-crypt under btrfs,
passes on a qualifying gocryptfs mount, fails naming the path on ext4, fails
on `allow_other`, `allow_root`, a root-owned mount, or
`allow_sys_admin_access`, fails on an unresolvable mount, treats a tmpfs
`/tmp` as covered on the own-host profile and as a failure on the
shared-host profile, treats a bind-mounted ext4 `/tmp` as a failure on
both, and is not
consulted by a marker file or an environment value claiming encryption. The
release rows below are the deployment observations that qualify a profile;
unit fixtures alone qualify nothing.

### Encrypted backups

**A backup can be written to an age recipient.** `noise-deck backup
--recipient <age public key>` writes the checkpointed database encrypted with
the age library from Deck's Go module. `noise-deck restore --identity <file>`
decrypts and validates the staged SQLite file before any of the existing
destructive steps. Both keep today's rules: refuse to overwrite, owner-only
file mode, source opened read-only.

**Plaintext is staged only inside protected storage.** Today `VACUUM INTO`
writes a plaintext copy into an owner-only staging directory created beside
the destination. With a recipient, that staging directory must live under
the state root, never on the destination medium, and the destination
receives ciphertext only: a complete encrypted file or an unpublished
encrypted partial, never a plaintext byte. If encryption fails, the disk
fills, or the process is interrupted before or after publication, no
plaintext is left on the destination and no existing recovery point is
touched. There is no fallback from a failed encrypted backup to a plaintext
one.

**A backup without a recipient stays a plaintext file** and the command says
so once on stderr. The sealed profiles' runbooks require the recipient flag;
the flag is optional only for a Deck that has not adopted a profile.

**Restore validates before it destroys.** A wrong identity, truncated or
tampered age input, an invalid schema, or exhausted staging fails before
tmux fencing and before the database is replaced. The stopped-backend fence
contract is unchanged.

**Proof.** A backup written with a recipient restores only with the matching
identity, fails plainly with the wrong one, and the encrypted file does not
contain the SQLite header. A backup written with a recipient to a scratch
destination while the staging directory is watched shows no plaintext
outside the state root. The palace and provider homes are backed up by
copying the encrypted backing, which is out of Deck's hands.

### The relay palace

**Two MemPalace servers per host.** Bootstrap starts the private server on
8765 exactly as today and a second one on 8766 over a fresh palace directory.
`configure.py` points `A2A_MCP_URL` at 8766 for every harness. The hook
forwarder, the logstream skill, and every provider hook keep writing to
8765.

**The private palace never has peers and never has a route.** A compose test
asserts the private palace directory carries no `peers.json` and that the
bootstrap script passes no peer configuration to the 8765 server. The 8765
listener stays on loopback inside the container and is not published,
proxied, or reachable from the tailnet. A test from the peer host with the
real peer credential shows that private MCP, memory search, drawers,
artifacts, checkpoints and every non-`a2a` stream are unreachable.

**The relay service serves stream `a2a` and refuses everything else.** The
relay server's on-disk palace holds only stream `a2a`, and the server
exposes only what replication of that stream needs. A peer credential cannot
add a drawer, read an artifact, or write to any other stream. If MemPalace
cannot restrict a server to one stream in its current release, the relay
runs behind a filtering proxy that enforces the restriction, and that proxy
is the enforcement owner in the acceptance rows. Configuring the a2a client
to behave well does not qualify the server.

**Cutover exports nothing old.** A fresh relay palace starts empty. Old
plaintext chat and memory in the private palace stay there, readable
locally as before, and are never copied into the relay or replayed as
notifications.

**Transport is defense in depth, not the boundary.** Both hosts join a
shared tailnet, neither publishes a port, and the relay servers sync over
MemPalace's HTTPS bearer transport with a per-peer token in the relay
palace's `peers.json`. The relay listener binds the tailnet address only.
The sync interval is two seconds; the palace is small, and the declared
event-size, backlog and batch bounds refuse visibly when exhausted without
touching private or control storage. When MemPalace's MeshGuard transport
lands, the host key should be aliased to its node identity so an operator
pins one fingerprint, not two.

**Unpairing is local.** Removing a peer from `peers.json` and its pin from
`trust.json` stops new traffic and pending notifications without the peer's
cooperation. Retained history is not claimed revoked, and old ciphertext is
not re-encrypted.

### Host keys and pinning

**One key per host.** Every agent on a host shares one Unix user and one
provider home, so a per-agent key would be bookkeeping, not identity. `a2a
key init` generates a 32-byte X25519 pair, stores it 0600 at
`~/.a2a/host-key`, and refuses to overwrite one that exists. `a2a key show`
prints the fingerprint. `a2a key announce` publishes the public half as a
`key.announce` event in the relay stream.

**Trust is pinned by a person.** `a2a key trust <host> <fingerprint>` records
a pin in `~/.a2a/trust.json` after the two operators have read the
fingerprints to each other over a call. `a2a who` gains a column showing
pinned, unpinned, or changed.

**Refuse, never downgrade.** Sending to a host with no pin is refused with
the reason. A `key.announce` whose fingerprint differs from a pinned one
marks that host changed, and sending is refused until re-pinned. There is no
flag, environment value, or prompt that sends plaintext instead.

**Proof.** Tests that an unpinned host cannot be addressed, that a changed
key for a pinned host is refused, that a fingerprint round-trips through
announce and show, and that no code path produces a plaintext body once a
recipient host is named.

### Sealed events

**Authenticate the event, not just its prose.** Use PyNaCl `Box` with pinned
host keys and library-generated random nonces. Its authenticator is not a
signature or proof of authorship against the other trusted endpoint;
`SealedBox` alone supplies no sender authentication. Static keys provide no
forward-secrecy claim. See the [PyNaCl public-key documentation](https://pynacl.readthedocs.io/en/latest/public/).

A versioned encrypted envelope binds the protocol and key versions,
sender/recipient host and agent identities, chat id, a stable client-generated
event id, event type, membership/lifecycle facts, declared ordering dependencies,
and exact body bytes. Lifecycle and acknowledgement events require
authentication even with no text. Fields duplicated outside the box for
indexing must match the authenticated values. Never replay, route, acknowledge
or render an event based on unchecked outer metadata. Authenticate and
authorize presence before using it to locate a recipient; remote presence
cannot nominate local PIDs, panes or socket paths.

The implementation leaf freezes its wire schema, bounds and test vectors
before rollout. Define ordering that converges under duplicate and reordered
replication, including a message racing a departure or close; one replica's
arrival order is not a shared order. Missing dependencies remain pending and
cannot authorize premature terminal delivery. If the selected transport
cannot uphold ADR-0011's history and delivery rules under partitions, the
cross-host release gate stays closed until that behavior is resolved.

**Replay is inert.** Deduplicate authenticated event identity and content,
not a relay-assigned event id. Wrapping the same ciphertext in a new event
cannot trigger another lifecycle action or notification, including after a
courier restart. Conflicting reuse is refused. Durable attempt records retain
the rule that uncertain terminal writes are never pasted again.

**The metadata budget is explicit.** Relay observers may see minimal host,
agent and chat identifiers, event timing, sizes and delivery facts. Publish
only the presence needed for opted-in cross-host chat. Project paths, native
session identifiers, PIDs, pane/socket details and private memory names stay
in local presence. Encryption does not hide who talks or when.

**Reading is symmetric.** `a2a read`, `a2a inbox`, `a2a wait`, the courier
and `a2a ledger` use the same verified decryption and replay path. Both
participating hosts can read sent and received history. A local-only chat
must remain unreadable to the other host; one shared box between the two hosts
must never encrypt local-private traffic. Preserve ADR-0011 join history and
departure cutoffs in the application. A shared host key does not cryptographically
hide later ciphertext from a departed agent with equivalent local access.

Unreadable or unauthenticated events produce a bounded error view with
untrusted identifiers labeled as such. They are never pasted, counted as
accepted chat, or acknowledged as delivered/read. Unknown versions and
plaintext in the relay are refused without downgrade. Errors expose reasons,
never keys, ciphertext dumps or decrypted body fragments.

**One dependency, one runtime.** PyNaCl is pinned with the runtime that
actually executes a2a. Today the script shebang and bootstrap courier use
system Python; installing a package only in the MemPalace virtualenv is
insufficient. Verify the client, courier, hooks, Pi-family extension and Go
ledger subprocess all invoke the qualified runtime. Missing crypto refuses
sealed chat and never falls back to plaintext.

**Proof.** Crypto/replay unit fixtures supplement the real two-host tests
below. A third host with relay stores but no endpoint key cannot open bodies.
Modify every authenticated field and the relay wrapper, not just the nonce or
ciphertext. Test both hosts' sent history, local-private history, and the
unchanged ADR-0011 lifecycle and delivery requirements.

### Credential-shaped bodies

**The client refuses to send a body that looks like a secret.** Tokens,
keys, and environment assignments are refused before sealing, with the reason.
Sealing makes the other person's replica a place such a body could otherwise
land encrypted but retrievable.

**Proof.** Table-driven tests over the refused shapes, and one that ordinary
prose containing the word "token" still sends.

### Onboarding

**One document the partner follows.** Host choice and what each choice
means; encrypting the state root; `compose.env` from the example in password
mode; tailnet join; the relay palace peer entry with a token relayed out of
band; key init and fingerprint exchange over a call; first chat; first
encrypted backup.

**Proof.** A fresh host walked through it by someone who did not write it.

## Release acceptance

These are required future observations, not tests already performed by this
document's authors. Use synthetic private and shared messages, isolated test
palaces, temporary databases and dedicated tmux sockets. Never probe operator
sessions or print actual unlock material, credentials or private chat. Unit
fixtures supplement the real deployment tests; they cannot qualify a storage
profile or a two-host release by themselves.

| Threat or failure | Enforcement owner | Required observation |
|---|---|---|
| Direct root file reads reveal partner-private text | Shared-host FUSE mount and runtime layout | With a real CLI running, root's direct `cat` of every mapped plaintext store, nested bind, key path and alias fails, including a synthetic file under `/tmp` read through `/proc/<container pid>/root`. Cipher backing and exported backups reveal no synthetic private text. The partner runtime can read its own fixture. Repeat after restart. This test does not switch identity, enter the runtime or inspect memory. |
| A permissive FUSE setting bypasses the intended check | Host deployment gate | A root-owned mount, `allow_other`, `allow_root`, or enabled `allow_sys_admin_access` fails qualification. Changing the tested UID/mount layout invalidates the result; a configuration marker alone cannot pass it. |
| A missed mount or persistent spill exposes plaintext | Host deployment gate and storage layout | Deliberately leave a named volume, nested bind, GitHub config, Docker metadata, log path or production disk-backed `/tmp` outside protection. Each prevents qualification. Include swap, hibernation, crash dumps and backup staging; tmpfs alone cannot prove that data never reaches disk. |
| Startup writes before storage is protected | Host launcher and bootstrap | With locked, missing, replaced or unresolvable backing, provisioning, MemPalace, courier and real CLIs never start writing. No fallback directory appears and readiness never succeeds. A prior boot's successful check cannot authorize a different mount. |
| Storage disappears while the service runs | Host mount lifecycle and launch gate | Loss of backing never redirects writes into an underlying plaintext directory. Refuse new launches, report the failure, and exercise the documented recovery without deleting data or silently creating a new palace. |
| Ciphertext backups still leave plaintext on destination media | Backup command | A concurrent-WAL snapshot restores correctly. Plaintext staging stays within verified protected storage. Fail encryption, fill the disk and interrupt before/after publication; the destination contains only complete ciphertext or an unpublished ciphertext partial. Never overwrite an existing recovery point or fall back to plaintext. |
| Bad restore input destroys the working installation | Restore command | Wrong key, truncated/tampered age input, invalid schema and exhausted staging fail before tmux fencing or database replacement. Authenticate the complete input and validate staged SQLite before destructive steps. Exercise successful restore under the existing stopped-backend fence contract. |
| Relay access exposes private memory | Relay service and private listener configuration | From the other host, use the actual peer credential to attempt private MCP, memory search, drawers, artifacts, checkpoints and non-a2a streams. Each is refused. Direct forbidden writes to the relay also fail; merely configuring a2a to behave well does not qualify the server. |
| Old private history is accidentally exported | Cutover procedure | Seed old plaintext chat and memory locally. Fresh relay replicas contain neither after cutover. Preserve local historical reads and delivery records; never copy the private palace or replay its old notifications. |
| Shared and private conversations are confused | Host-key selection and a2a reader | Each endpoint opens explicitly shared incoming and outgoing messages. The peer host, including its root user and peer key, cannot open local-private chat. A third host holding both relay replicas without endpoint keys cannot open either kind. |
| A relay changes the sender, chat, membership or close | Authenticated a2a envelope/replay | Modify sender/recipient host and handle, chat id, type, membership, close markers and acknowledgements while retaining the ciphertext. No changed action is accepted or delivered. Reject spoofed presence that claims another host's local pane. |
| Replay or a partition delivers an action twice or to a departed member | a2a replay and courier attempt ledger | Duplicate ciphertext under a fresh relay id, reorder dependencies, delay a close/leave, and restart before/after paste or acknowledgement. Both hosts converge; no uncertain paste repeats. Verify late-join history, departure cutoff and opener-only global close with real command paths. |
| Key change or old client causes a plaintext downgrade | a2a send/receive policy | Missing keys, unpinned/changed peers, unsupported versions, legacy plaintext and missing PyNaCl refuse without plaintext output or successful delivery facts. Same-named agents on the two hosts remain distinct. |
| Unpairing or restoring an old host reactivates stale chat | Local peer policy and recovery procedure | Disable a peer without its cooperation: new traffic and pending notifications stop. Restore or clone old keys/delivery state with transport disabled until explicit recovery. Retained history is not claimed revoked and old ciphertext is not silently re-encrypted. |
| One runtime path bypasses sealing or stops reading chat | Pinned client/runtime and existing Deck read path | Exercise CLI reads, hooks, Pi-family delivery, courier and `a2a ledger` in the packaged image. Both operators see the correct per-session ledger; the index stays content-free. Deck gains no chat-writing endpoint or provider-output parser. |
| Peers flood or remain offline | Relay retention and synchronization limits | Apply the declared event-size, backlog and batch bounds. Exhaustion refuses visibly without filling private/control storage, deleting private data, or reporting an unconfirmed send as delivered. |
| A clean synthetic test hides native provider persistence | Qualified host profile | On each supported real CLI, create a synthetic private conversation, restart, reopen native history and repeat the allowed root file probes. Run a full encrypted recovery on a fresh host without keys stored alongside its backup. |

The current read-only environment probe found zero effective capabilities,
readable `/sys/dev/block`, and Btrfs mountinfo device `0:35` without a matching
sysfs entry for the principal data mounts. Fscrypt get-policy returned
`ENOTTY` there and `ENOTSUP` on ext4 `/tmp`. This demonstrates that the draft's
container-only device lookup does not resolve this layout; it does not prove
whether the host backing is encrypted. The host profile must resolve the
actual storage or fail closed. Fscrypt remains unqualified.

## Phases

Ordered so each step is independently useful and independently reviewable.
Sizes are relative estimates of implementation and verification effort. A phase
ships when its release rows above have been observed on a real deployment,
not when its unit tests pass.

| Phase | Work | Size | Depends on |
|---|---|---|---|
| 1 | ADR recording the three decisions, the named adversary, and the stated limits | S | operator decision |
| 1 | Shared-host storage profile: partner uid, gocryptfs mount, host preflight, real root-read test, runbook | M | a host with `/dev/fuse` to qualify on |
| 1 | Encrypted backups: `--recipient`, `--identity`, protected staging, restore validation | M | nothing |
| 1 | Own-host storage profile: LUKS preflight, systemd unlock pre-step, in-container second opinion, runbook | M | nothing |
| 2 | Relay palace: second server, restricted service or proxy, private listener test, cutover, runbook | M | ADR |
| 2 | Host keys and pinning | M | relay palace |
| 3 | Sealed events: envelope, replay, PyNaCl on the runtime that actually runs a2a, ledger read path | L | keys |
| 3 | Refuse credential-shaped bodies | S | nothing |
| 3 | Second-operator onboarding runbook, including the exact limit of the shared-host claim | S | everything above |

Phase 1 needs no cryptography inside Deck beyond the age library and can
ship before the operator has decided anything about chat. The shared-host
profile is the chosen one and comes first. It cannot be qualified in the
current container, which has no `/dev/fuse`, so its row waits on a host
where the mount can be composed and root-read for real. The own-host
profile can be qualified on hardware we have and ships as the documented
stronger alternative.

## Decisions for the operator

| Question | Recommendation |
|---|---|
| Which storage profile for the partner? | **Decided 2026-09-06: shared host.** The partner's Deck runs on the operator's machine. The profile meets the bounded `sudo cat` claim and nothing stronger, and the onboarding document states that limit for the partner to accept. Own host stays documented as the stronger alternative. |
| Is the bounded adversary the product requirement? | **Decided 2026-09-06: yes.** Ordinary reads by the other operator; no process inspection, identity switching, namespace entry, or hostile updates. If the partner later needs more, this proposal is reopened, not stretched. |
| Key per host, or per agent? | Per host. |
| PyNaCl in the a2a file, or a Go helper? | PyNaCl, pinned on the interpreter that actually runs a2a, the courier and the ledger subprocess. |
| Two palace servers, or a stream-scoped sync upstream? | Two servers now, with a filtering proxy if MemPalace cannot restrict a server to one stream; propose the filter upstream without waiting on it. |
| Unattended reboot? | Manual unlock for v1, stated in the runbook. A key on the same disk is not allowed. |
| Forward secrecy in v1? | No, stated plainly in the ADR. |

## Open questions for review

- Whether MemPalace 3.8.0 can serve one stream and refuse the rest, or the
  relay needs the filtering proxy from the start.
- Whether a gocryptfs mount made by the partner uid on the host can be bound
  into a container that runs as that same uid without `allow_other`, on a
  Docker whose daemon runs as root. If the daemon's bind mount needs root
  traversal, the shared-host profile needs rootless Docker or Podman, and the
  runbook changes accordingly.
- Whether the Pi-family hook and the Go ledger subprocess can be pointed at
  the qualified interpreter without changing the image's Python layout.
- Whether the relay palace's own on-disk directory needs a separate
  treatment, or whether sitting under the state root is enough. The bodies
  in it are ciphertext either way.

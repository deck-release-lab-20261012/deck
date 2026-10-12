# ADR-0014: Browser-managed workspace encryption

- Status: Accepted implementation contract; not a deployment qualification
- Date: 2026-09-21
- Decision owner: Operator
- Amends: ADR-0012 decision 4's manual unlock lifecycle, and ADR-0004's
  authentication default only for the browser-managed deployment below
- Preserves: ADR-0012's host threat boundary and chat protocol; ADR-0001,
  ADR-0002 and ADR-0003's authority boundaries

## Context

A workspace owner must be able to accept an invitation, choose an unlock method, save
recovery material, and later unlock, lock or replace a method from a browser. The
machine's operator provisions the instance but does not choose its encryption password or
receive a recovery key.

The existing sealed-storage wrapper starts an already unlocked filesystem. The application
opens its database before serving HTTP, and ordinary backend shutdown deliberately leaves
agent processes running. Neither an application login screen nor a call to that shutdown
path can implement this lifecycle.

## Decision

### 1. Security profiles describe different threats

Every profile requires correct enrollment, encryption, recovery, revocation and truthful status.

| Profile | Promised boundary | Enforcement and limits |
| --- | --- | --- |
| Standard, on an owner-controlled host | An unauthenticated browser, another browser without an unlock grant, or a reader of locked storage/backups cannot read workspace data. | The gateway controls browser access; the native encrypted filesystem protects stored bytes. Running workloads and the machine administrator can access plaintext. |
| Shared host, ADR-0012 | Also deny the other operator's ordinary root reads of live workspace files, logs, container metadata and stored backups, excluding persisted memory. | Dedicated owner UID, owner-only gocryptfs, rootless Podman with the matching UID and the measured FUSE restrictions. The separate personal/paranoid swap policy permits swap; host root can read plaintext swap or an active encrypted swap mapping. Identity switching, namespace entry, process-memory inspection, altered software/mounts and credential interception remain excluded. |
| Protection from a hostile compute operator | Research only. | A browser passkey cannot hide plaintext from the machine running an unmodified CLI. Owner-controlled compute or an independently qualified stronger execution boundary would need its own decision and hostile tests. No selectable protection claim exists yet. |

The shared-host profile fails closed when its actual host does not qualify. A container, a
Linux guest on a Mac, and the host's disk encryption do not establish that qualification.
The [swap policy](../security/workspace-swap.md) defaults to personal, with verified
encrypted swap required only in opt-in paranoid mode. Host swap, sleep images,
crash dumps and memory-bearing VM snapshots must be included in
the deployment assessment. Ordinary administration receives no decryption override. This
is not a claim that a deliberately hostile host administrator cannot obtain running data.

### 2. A gateway survives while the workspace is locked

An always-on security gateway serves the static security UI, Google sign-in, enrollment,
method management and lifecycle status. Its control store lives outside the encrypted
runtime so that these functions work while locked. It holds only the necessary owner
identity, invitation hashes, public keys, encrypted envelopes, method revisions, operation
records and hashes of bearer tokens. It holds no plaintext volume secret, proof private
key, password, PRF output or recovery key.

A native controller owns one configured instance's gocryptfs mount and runtime. Its
instance identity, UID, paths, origin, RP ID and permitted runtime command are deployment
configuration, never authority supplied in a browser request. Its interface consists of
fixed operations on that instance; there is no arbitrary command, path, user or Compose-project parameter. Its control channel and the container engine socket are not exposed to
workloads or to the public network.

After unlock, the gateway forwards authorized application traffic to the existing Deck
backend. Every data route, terminal WebSocket, project preview and alternate listener has
the same gate. The backend cannot remain directly reachable through an old published port,
console password, trusted-proxy header or preview credential. A loopback address alone is
not authentication between the gateway and backend. The deployment must prove this routing
and credential boundary without exposing a reusable bypass in inspectable container
environment or plaintext host files.

### 3. Google identifies the owner; an unlock method authorizes access

Google remains the first gate. Validated OIDC admission checks the intended verified
email, then invitation redemption pins the stable `(issuer, subject)` pair. Later logins
match that pair, not just email or the constant `operator` principal. Owner-authorized
identity changes cannot reset encryption. Invitations are expiring, single-use, hashed
bearers; link previews cannot consume them. Redemption cannot replace an owner or
reinitialize storage.

Redemption also issues an independent random enrollment bearer; only its bound hash is
stored. Every bootstrap mutation requires it. Google cookies and session IDs alone are
insufficient because their signing secret may be readable in the shared-host profile.
Lost receipts resume through proof of a persisted enrollment method. First method
activation permanently ends receipt-only authority, including adding recovery while setup
is incomplete. Subsequent key changes require fresh active-method proof.

Pin the exact HTTPS origin and RP ID in installation configuration, never incoming
headers. Validate WebAuthn ceremonies with user verification. Synced passkeys are
supported with appropriate backup/counter handling; hardware-only policy is separate and
cannot follow from a nickname.

### 4. Each method wraps the volume secret and its own proof key

The browser generates a random 32-byte volume unlock secret. The native controller uses
its canonical unpadded base64url encoding as the gocryptfs mount credential. gocryptfs
continues to own filesystem encryption and its own random filesystem master key; Deck does
not implement its file format.

Every method has a distinct random ECDSA P-256 proof key pair. Its encrypted envelope
contains the volume unlock secret and that method's proof private key. The gateway stores
the public proof key and envelope. A method signature therefore proves possession of that
method's private key; it cannot be replaced by proof of a shared volume secret. Removing a
method can refuse its future requests even though another method opens the same
filesystem.

Passkeys use WebAuthn PRF plus HKDF; passwords use versioned PBKDF2; recovery uses an
independent random secret plus HKDF. A passkey without PRF cannot unlock storage. An
ordinary WebAuthn signature is not an encryption key. The password is independent of
Google sign-in. The exact envelope, KDF, proof and recovery formats live in the [version-1
protocol](../security/workspace-crypto-v1.md).

Do not persist decrypted material in browser storage. Key cleanup is best effort;
JavaScript does not guarantee physical memory erasure.

### 5. Enrollment tests the saved envelope before enabling a method

Method state is `pending`, `active` or `removed`. A pending method grants neither browser
access nor general management authority. Registration may have saved a passkey in the
browser even when Deck refuses to activate it; the UI says "Not enabled for unlocking",
not "Nothing was saved".

The browser uploads the candidate encrypted envelope and public proof key, then rereads
the persisted candidate, drops the initial decrypted material, and opens that envelope
through a fresh method ceremony. The decrypted volume secret must match the instance's
persisted public commitment. It signs a fresh challenge with the recovered proof key.
Passkeys also produce a fresh user-verified WebAuthn assertion. The gateway verifies both
signatures and the exact pending revision. A signature proves possession; the server
cannot prove that JavaScript forgot an earlier key or reran a password KDF. Tests of the
browser implementation must exercise that fresh reread/decrypt path.

Initial setup additionally proves that the recovered volume secret opens the native
encrypted store. A pending synthetic check is not a running workspace. Setup finishes only
after an everyday method and a separately saved/reentered recovery key pass their tests.
Interrupted setup resumes for the same owner and stored instance; it never silently
creates replacement storage or marks an unverified recovery key saved.

Adding or replacing a method requires fresh proof from an active method, bound to the
exact candidate. The candidate receives a new proof key, even for a password change. Only
after its saved-envelope test succeeds may a transaction activate it and remove its
predecessor. Cancel or interruption leaves the old method usable. The last active everyday
method cannot be removed until another has passed its test; a recovery key alone does not
satisfy that guard. A forgotten password can be replaced using another active method or
recovery, without pretending to recover the old password.

### 6. Challenges bind one operation; browser grants are revocable

Every privileged proof binds a single expiring server challenge to its owner, login
session, instance, operation, method revision, exact payload and runtime epoch. Passkeys
additionally require a fresh user-verified WebAuthn assertion. Consume challenges
atomically; observe uncertain native operations through their durable IDs rather than
replaying effects.

Browser grants are random bearer cookies; the control store holds only their hashes and
binding metadata, never a reusable signing secret. Grants have an absolute expiry. Sign
out revokes that browser and its streams while work continues. Method removal revokes
grants issued through it; lock or an epoch change revokes all affected grants. Gateway
restart discards grants and challenges and reconciles the runtime without assuming that it
stopped. Google session renewal does not mint an unlock grant. Mutations require origin
validation and session-bound CSRF protection.

An owner signed in through a new browser learns only that the workspace is locked, running
or unavailable until proving an unlock method. Session names, process details, projects,
files, tasks and terminals remain hidden. If the runtime is already open, successful proof
grants access to that browser; it does not remount storage or restart sessions.

### 7. Status follows the controller's observed state

The [version-1 API](../security/workspace-crypto-v1.md#api-and-state) separates method
authorization, browser grants and native operations. Its control store owns method/grant
state; mount and process observations own runtime truth. Storage is `closed/open/unknown`;
runtime is `stopped/starting/running/stopping/unknown`. An open store with a failed launch
is not locked. Connection loss is "Could not confirm", not an invented server state. Old
operation results cannot certify a later runtime epoch.

### 8. Locking stops the actual workload and closes its store

The authenticated browser hands the volume secret to the native controller and gocryptfs
through a protected connection/private pipe. Exclude it from argv, environment, ordinary
files, logs, telemetry and diagnostics; suppress gocryptfs initialization disclosure.
Discard the handoff after use. Running mounts necessarily retain decryption capability in
memory.

Unlock mounts first, qualifies every store, starts the runtime through the sealed wrapper,
cross-checks the report and observes readiness. Failure must not redirect writes into the
underlying plaintext mount point. Startup provisioning, host-identity receipts, provider
homes and temporary files all wait for the storage gate. No operator-readable bootstrap
console password provides an alternate route around the gateway.

Lock is an explicit owner action with its interruption consequence shown before
confirmation. Fence new launches, recovery and other writers; revoke browser data grants;
record intentional stops; signal the exact observed sessions using existing stop
machinery; then stop remaining runtime services and close the filesystem. Verify that the
relevant runtime processes, mount aliases and gocryptfs process are gone before saying
"locked". Do not use a lazy unmount as evidence. A failed stop or unmount remains visibly
open or unknown and retains an operation that the owner can inspect and retry.

Normal backend restart continues to preserve running CLIs. A complete workspace stop or
host reboot requires unlock again. Explicitly stopped sessions do not automatically resume
at the next unlock; retain their state so the owner can choose what to reopen. Closing a
browser or removing a hardware key does not lock the running instance. Do not infer agent
idleness from terminal output to choose a lock time.

### 9. Recovery is reusable; replacing a wrapper is not rotating data keys

The recovery secret is reusable until its replacement is checked and activated. Adding an
everyday method does not consume it. A recovery flow ends with a tested everyday method,
offers review of existing methods, and allows a new recovery key to be saved and tested
before removing the old one. If all methods and recovery material are lost, the operator
can recover availability or delete ciphertext, but cannot recover decryption.

The [recovery format](../security/workspace-crypto-v1.md#recovery-key-and-kit) encodes 256
random bits with a transcription check. The browser-generated kit is not a data backup.
Restore also needs encrypted workspace data, native filesystem metadata and consistent
method-envelope control records; never restore bearer grants or challenges. Age database
exports remain separate.

Changing a password, replacing a passkey, or replacing a recovery envelope changes the
accepted method and its wrapping key. It does not re-encrypt workspace files. A copied
older envelope and its old unlock factor may still recover the same volume secret.
Changing the gocryptfs mount credential also rewraps its existing filesystem master key.
Revoking a browser or method blocks future service requests; it cannot retract a copied
key or plaintext.

A copied filesystem key requires a new master key, verified data re-encryption and a
separate cutover/backup plan. Old backups do not become unreadable. a2a identity keys and
age recipients rotate independently. This decision does not add a re-encryption tool.

## Acceptance evidence

Each row names the failure, its enforcement owner and the required hostile test. Use
synthetic secrets and conversations, isolated databases/tmux namespaces and disposable
native encrypted roots. No probe targets an operator session or prints real keys.

| Failure to prevent | Owner and required observation |
| --- | --- |
| Google login bypasses encryption | Gateway: a valid owner login without method proof cannot read any API data, attach a terminal, open a preview or use an old alternate port. Run the probes while another browser has left the workspace running. |
| Ordinary root reads mint browser access | Gateway: copying all unencrypted control records, token hashes and public keys is insufficient to authenticate a fresh browser grant; no raw bearer or reusable grant-signing secret appears there, in logs or container metadata. |
| Wrong person redeems an invitation | Enrollment store/OIDC verifier: reject wrong subject after binding, unverified email, issuer/audience/nonce mismatch, spent/expired token and concurrent second redemption. A GET does not consume the invitation. |
| Forged Google state takes over enrollment | Enrollment store: copy unsealed records and the Google-cookie signing secret, forge the owner/session, and attempt preparation, envelope mutation, testing, initialization and receipt renewal without the independent bearer or method proof. Reject them without effects. Race receipt rotation/activation; an expired or superseded receipt fails, and first activation permanently prevents receipt-only recovery/key changes even if setup remains incomplete. |
| Passkey authentication masquerades as encryption | Browser/WebAuthn verifier: registration or login without PRF cannot activate an unlock method. Fresh persisted-envelope tests pass for supported combinations and fail for unsupported ones; fallback stays explicit. Reject wrong RP/origin/credential/UV and tampered envelopes. |
| A removed method or replay authorizes an operation | Method registry: replay captured proofs, swap instance/method/revision/payload/login session/epoch, alter signatures, and race consumption. Reject them without effects; a different method's proof cannot substitute. |
| Replacement loses the last key | Method transaction: interrupt candidate upload, test and activation; the old method remains usable until the tested successor commits. Reject last-everyday-method removal. Recovery remains reusable until a new recovery key is verified. |
| Browser revocation leaves a live terminal | Grant/stream owner: logout, expiry, method removal, lock and epoch change close the affected existing sockets as well as rejecting new reads. One browser's logout leaves other valid browsers and workloads running. |
| A browser authorization restarts the workspace | Gateway/controller: authorize by passkey, password and recovery while agents run; process identity and mount identity remain unchanged. Google alone sees no session names or task details. |
| Lock lies or restarts work unexpectedly | Lifecycle controller: hold a file open, refuse a stop, lose the response, crash between stages and retry. Status follows observed backing/processes; no false locked receipt or replayed uncertain signal. After a completed lock/unlock cycle, intentionally stopped CLIs remain stopped. |
| Plaintext escapes the native storage gate | Host/controller: locked/missing/replaced backing never creates a plaintext fallback or runs provisioning. On shared hosts, synthetic live-file reads through both host paths and `/proc` aliases are denied, while ciphertext copies remain unreadable. Include actual swap/VM-host persistence. |
| A successful UI hides unrecoverable data | Native runtime/backup path: use real supported CLIs with synthetic private work, stop/unlock/reopen their native history, then restore an encrypted backup plus an off-host kit into an isolated instance. Corrupt/wrong kits and incomplete backups fail visibly without overwriting the original. |

Browser probes cover accepted desktop/mobile flows, accessible copy, fictional-key
copy/download/import, password agreement, sign-out state and unknown-lock outcomes. The
serialized pixel gate supplements native hostile tests; screenshots and mocked controllers
cannot replace them.

## Consequences and sources

Browser-managed encryption needs a host service, browser cryptography and a new grant
boundary; it cannot ship as a UI over the existing console password. Until that service
and its profile pass the acceptance rows, the existing manual runbooks remain the
supported procedure. This decision neither enables Continuity nor qualifies project
confinement.

Primary references: [WebAuthn PRF](https://www.w3.org/TR/webauthn-3/#prf-extension) and
[gocryptfs cryptography](https://nuetzlich.net/gocryptfs/forward_mode_crypto/). Byte
formats, API transitions and public fixtures are in the [version-1
contract](../security/workspace-crypto-v1.md).

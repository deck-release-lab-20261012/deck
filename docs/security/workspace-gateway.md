# Workspace gateway deployment

The optional `noise deck workspace serve` command keeps Google sign-in,
enrollment, unlock, recovery, and operation observation available while the
workload is stopped. It runs as the dedicated non-root owner in the
Linux host mount namespace. The encrypted native integration targets the
shared-host rootless Podman profile in ADR-0012. A successful build or these
settings do not qualify a host; effective-state and real-CLI interruption
checks are required before a deployment can claim this boundary.

## Fixed installation

Build the normal binary with production frontend assets. Keep that binary,
the gateway installation JSON, and its control directory outside all workload
roots. Choose the installation example before first opening the control store:

| Policy | Example |
| --- | --- |
| Encryption required (default) | [Required installation](../../configs/workspace-gateway.example.json) |
| Owner chooses whether to encrypt | [Optional installation](../../configs/workspace-gateway.optional.example.json) |
| Setup without Deck encryption only | [Unavailable encryption](../../configs/workspace-gateway.unavailable.example.json) |

Copy it into a mode-0600 file owned by the dedicated host user and replace every
example installation value. These are alternatives for fresh installations;
copying another example over an existing configuration cannot change its pinned
policy. The instance ID, paths, origin, owner UID, Compose project, and exact app
container name are fixed installation
facts. The native journal pins them and refuses a different configuration.
Do not change them to work around a failed observation.

The gateway acquires the existing backend lifetime lock in its control
directory before opening the native journal or resetting browser grants.
A duplicate start, even on a different loopback port, refuses without changing
the running gateway's streams or operations. The kernel releases ownership
when the process exits; never delete its lock file to bypass the refusal.

Provision the control directory with mode 0700 under the dedicated owner.
Required and optional installations also need fresh cipher and empty mountpoint
directories, gocryptfs, fusermount3, and the existing sealed host prerequisites.
All policies require Linux, rootless Podman, Python 3, and `WorkspaceGateway: true`.
Use the owner's RAM-backed `XDG_RUNTIME_DIR` for `RuntimeDir`. Resolve
executable paths to their absolute, canonical locations. The gateway neither
loads workload provider homes nor reads the encrypted Deck database while locked.

Supply `NOISEDECK_AUTH_GOOGLE_CLIENT_SECRET` and
`NOISEDECK_AUTH_SESSION_SECRET` through the gateway service's private
environment. They are not JSON fields. Use the same Google client, allowed
email, and session-signing secret for the gateway and backend. In the Compose
environment these correspond to `GOOGLE_OIDC_CLIENT_ID`,
`GOOGLE_OIDC_CLIENT_SECRET`, `GOOGLE_OIDC_ALLOWED_EMAIL`, and
`NOISEDECK_AUTH_SESSION_SECRET`. Set `NOISEDECK_PUBLIC_ORIGIN` to the exact
gateway HTTPS origin and register its `/auth/callback` with Google.

Keep the existing sealed Compose environment requirements, including a unique
project, stable host name, state root, and tmpfs report directory. The native
controller supplies `NOISEDECK_WORKSPACE_GATEWAY=true` and the fixed mount and
project when invoking `deploy/sealed-compose.sh`; ambient values cannot turn
it off. The wrapper adds `compose.workspace-gateway.yaml` after the sealed
overlays. This removes all app/relay published ports and selects only
`/data/gateway/backend.sock`. The socket directory is created inside the
verified encrypted mount, mode 0700. The listener creates its socket mode 0600.

`OwnerUID` is the dedicated host UID. Podman's `keep-id:uid=...` maps it to
`NOISEDECK_RUNTIME_UID` inside the container; the backend's `gateway_uid` uses
that container UID. The host proxy verifies the peer's host UID. Do not chown
host directories to the container's numeric UID to imitate this mapping.

Point the HTTPS reverse proxy exclusively at the configured gateway loopback
address. Preserve the fixed public Host and support WebSocket upgrades.
Disable request-body and Cookie/Authorization logging on the reverse proxy.
Do not publish the backend, relay, project-preview listener, or another
container ingress. The gateway admits only fixed `/api/` application routes,
blocks its internal preparation endpoint from public forwarding, strips
forwarded identity headers and encryption cookies, and uses the Unix socket
without TCP or redirect fallback. Before reporting a running workspace the
controller inspects actual app/project port publication, network mode,
private-listener settings, and the sealed mount report. Unknown facts refuse
admission. Host qualification must also attempt direct bypasses.

## Swap policy

Keep host swap available. The installation's `native.SwapPolicy` is `personal`
when omitted and permits ordinary swap independently of workspace encryption.
Set `"SwapPolicy": "paranoid"` before first initialization to require verified
encrypted swap. The native controller pins the selection and overrides the
Compose environment with `NOISEDECK_SWAP_POLICY`; an ambient variable cannot
change it. Both host preflight and container admission check the same policy.
Follow [swap deployment](workspace-swap.md) for supported mappings, verification,
existing-installation compatibility and privacy limits. This is an operator
installation choice, not a browser-controlled host reconfiguration.

## First setup

Run the gateway as its dedicated owner, normally under the host supervisor:

```sh
noise deck workspace serve --config /srv/workspace01/gateway.json
```

The public shell and Google sign-in work independently of the encrypted
workload. In another operator session, issue a setup link:

```sh
noise deck workspace setup-link --config /srv/workspace01/gateway.json
```

The existing `invite` command remains an alias. The command prints a path and
expiry, never the setup bearer. It writes
the one-use link into a mode-0600 file in the owner's tmpfs runtime directory.
Transfer that file/link through the intended private handoff, then remove the
export. Keep it out of transcripts, backups, command arguments, and logs. The
link uses a URL fragment; the browser removes it before navigation and places
it in a short-lived HttpOnly handoff cookie for the Google round trip. The
control store keeps only the invitation hash. A replacement invitation
supersedes an unused one; no invitation can reset an already bound owner.
The issuer necessarily possesses this enrollment capability before handoff.

For an encrypted workspace, the owner signs in with the allowed Google account
and chooses a compatible encryption passkey or a separate encryption password.
Google establishes identity; the method unwraps the workspace secret and proves
encryption authority. The browser must read back and test the saved method,
save and verify its independently generated recovery kit, then submit a fresh
proof before native initialization. Unsupported passkey PRF capability gives
an explicit fallback, not a fake success. A software passkey provider still
needs validation with the chosen browser and operating system.

The random volume secret reaches the trusted native controller transiently,
through a private stdin pipe to gocryptfs. Passwords, PRF output, recovery keys,
and decrypted envelopes never enter the control database. The host still
processes plaintext while unlocked. This deployment does not protect live
memory or defend against a host owner actively replacing the served client or
inspecting native processes.

## Optional workspace encryption

The default installation still requires encryption. For a fresh gateway,
`encryption_policy: "optional"` offers an explicit choice; `"unavailable"`
permits only setup without Deck encryption. Policy is pinned in the control
store. Changing the JSON cannot downgrade an existing encrypted installation.
A failed controller, unsupported passkey, or disconnected browser never changes
that policy. An ordinary existing Deck app without the gateway protocol does
not become a new workspace merely because it lacks onboarding records.

Both policies require a `plain` configuration using the fields in
`workspaceplain.Config`: `InstanceID`, `OwnerUID`, `StateRoot`, `ControlDir`,
`HomeDir`, `RuntimeDir`, `PodmanPath`, `ComposePath`, `ComposeEnvFile`,
`ComposeProject`, `AppContainer`, and `PublicOrigin`. The instance, owner,
control and runtime directories must match `native`; the public origin must
match `origin`. `StateRoot` is a separate, initially empty mode-0700 directory.
For an optional installation, its Compose project and app container must also
be distinct from the encrypted branch. Point `ComposePath` at the installed
`deploy/plain-compose.sh` wrapper. Provision `StateRoot` and the separate host
engine home with mode 0700 before opening the gateway; leave `StateRoot` empty,
including its future workload subdirectories. All configured paths must exist
without symlink components. Keep the wrapper beside its checked-in deployment
files and Compose overlays. The [plain controller documentation](workspace-plain-controller.md)
defines the layout and native qualification probe.

Copy [the plain Compose environment example](../../deploy/workspace-plain.env.example)
to `plain.ComposeEnvFile`, mode 0600 under the dedicated owner. For optional
installations, prepare the separate `native.ComposeEnvFile` using the existing
sealed instructions and [Compose environment example](../../deploy/compose.env.example).
Do not share these two files: the encrypted branch also needs its sealed profile,
state root and RAM-backed report path. Both branches must use the same Google
client, allowed account and session secret as the gateway. Supply the gateway's
secrets separately through its supervisor; a Compose environment file does not
configure the gateway process. Keep every real secret outside version control.

The plain controller supplies its fixed project, container, state root and origin
from JSON; its wrapper supplies the MemPalace interpolation path. Both wrappers
include the MemPalace overlay, so load an app image with that capability into the
dedicated owner's Podman store before setup. The image and environment must agree
on the container UID/GID; `HomeDir` is the host engine home, not the workload's
provider home under `StateRoot/home`.

An `unavailable` installation retains `native.InstanceID`, `OwnerUID`,
`ControlDir`, `RuntimeDir`, and `WorkspaceGateway: true` as common gateway
configuration. It needs no gocryptfs or encrypted mount paths. Optional
installations must qualify both configured controllers before first setup;
they cannot advertise a broken encrypted controller as a plaintext fallback.

The owner must redeem the private setup link before selecting either branch.
Selecting no Deck encryption permanently closes encrypted enrollment for that
installation. The service provisions and starts the separate plain runtime,
then records setup complete only after observing the intended running process
and private ingress. It never sets encrypted initialization or issues a
method-backed unlock cookie. Lost responses retain a public operation ID for
observation; ambiguous Compose effects are not automatically replayed.

A completed plain workspace admits the pinned owner's Google sessions and
still requires the observed private runtime for every request. Sign-out closes
only that login's streams; cookie expiry closes existing streams without
waiting for another request. Gateway restart leaves real CLIs running.
Plain workspaces have no encryption lock or method-management controls, and
make no claim against readers of their stored data or the host's Google
cookie-signing secret. Host disk encryption is independent. Enabling Deck
encryption later requires the [operator-assisted migration](workspace-migration.md)
into a separately enrolled installation. There is no in-place conversion toggle.

## Encrypted workspace lifecycle and recovery

After a positive mount/start observation, the gateway atomically records the
runtime epoch and issues a separate browser cookie. Google alone never admits
application requests or reveals method labels. Every HTTP request and stream
requires that cookie, its current method revision, and an observed running
native epoch. Revocation closes both sides of attached streams, including idle
WebSockets. A gateway restart revokes browser access but preserves the mount
and real CLIs. A returning browser proves its method again without remounting
an already-running workspace.

Sign-out revokes only that Google login's browser access and leaves native
work running. Explicit workspace lock consumes a fresh method proof, revokes
workspace browser access, asks the private backend to fence input and record
the full stop cohort, stops the whole Compose project, then requests an
ordinary unmount. `locked` requires observed process, container, daemon, and
mount closure. An uncertain stop, busy mount, inaccessible observation, or
failed database write never becomes a successful lock message.

The browser records a public operation ID before submitting an effect. After
a lost response it observes that ID; neither a reload nor a status request
replays initialization, unlock, or lock. Interrupted initial setup resumes
only with a fresh proof of its original saved method. After a reboot, the
native controller verifies the original encrypted backing before recording a
separate reopen and its corresponding start. Changed backing or an uncertain
earlier effect remains unconfirmed for operator investigation.

Adding or changing a password, passkey, or recovery key creates and tests a
new encrypted envelope before replacement. The filesystem key stays the same.
Removing a method revokes browser grants issued through it. Retired methods
can still unlock old copied envelopes or backups; deleting a current method
does not revoke copies already held elsewhere. Losing every usable method and
the recovery kit has no host reset that recovers the data.

Control-store failures after a native transition close current streams and
refuse subsequent grants until gateway restart. Investigate the storage
failure before restarting. Preserve the control and native journals alongside
encrypted-data backups; do not restore an old control store over a running
workspace or initialize over an existing cipher directory.

## Verification boundary

Package tests cover real SQLite, signed Google-session fixtures, fresh method
proofs, real HTTP/WebSocket and Unix connections, kernel peer credentials,
stream revocation, storage failures, and observed-state refusal. Synthetic
native runners test interruption decisions without qualifying FUSE or Podman.
Qualification additionally requires the selected password manager/browser
PRF ceremony, a real Google round trip, real providers under interruption,
effective mount/UID/ingress checks, and host restart and lock/reopen exercises.
No configuration flag substitutes for those results.

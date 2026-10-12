# Native workspace controller

`internal/workspaceruntime` implements the host portion of browser-managed
workspace encryption. It is a library for the trusted gateway/host service;
it does not install a listener, authorize requests, or qualify a deployment.
The only implemented storage profile is ADR-0012's gocryptfs/shared-host
profile with the existing rootless Podman wrapper. Own-host/LUKS is not a
fallback for an unavailable shared-host gate. Filesystem layout is separate from
`Config.SwapPolicy`: omitted/`personal` allows ordinary swap; `paranoid` requires
active verified encrypted swap. The native observer, host preflight and container
admission all enforce the selected policy. See [swap deployment](workspace-swap.md).

## Installation and interface

Run as the dedicated non-root owner in the Linux host's mount namespace.
The native controller requires Linux 6.8 or newer with
[`STATX_MNT_ID_UNIQUE`](https://man7.org/linux/man-pages/man2/statx.2.html)
available. It checks the returned mask and fails closed if the kernel cannot
provide this identity; recycled `/proc` mount IDs are not a fallback.
`Config` fixes the instance, owner UID, ciphertext and mount directories,
control directory, owner home/runtime directory, native binary paths,
installed sealed wrapper/env file, Compose project and app container name.
Ciphertext, mount and control directories must exist, be canonical paths,
be owner-only and be disjoint. Native engine home/runtime directories and
executables/configuration stay outside the encrypted workload roots, so
engine inspection while locked cannot provision underneath a closed mount.
These installation paths must exist; both their configured names and resolved
symlink targets must stay outside the ciphertext and mount directories.
Keep the control directory on durable storage,
outside workload binds; it contains the native SQLite operation journal,
never a decryption credential. Changing configuration does not silently
adopt an existing journal belonging to another installation.

| Call | Effect |
| --- | --- |
| `Open(Config)` / `Close()` | Open/close the native journal. Neither unlocks, launches nor stops anything. One controller service owns this installation. |
| `Observe(ctx)` | Read native mount facts and the configured app's rootless engine state; a healthy app must also pass the existing in-container `sealed-check`. No provider output is parsed. |
| `Initialize(ctx, operationID, secret32)` | Initialize only empty ciphertext/backing directories, then mount and observe the result. Never overwrite existing native metadata. |
| `Unlock(ctx, operationID, secret32)` | Mount existing native metadata and observe it. An already-running workspace needs browser authorization, not this call. |
| `Start(ctx, operationID)` | Create the fixed store directories through an opened, revalidated mount handle; invoke `sealed-compose.sh <fixed-env-file> up`. That wrapper qualifies host stores, writes the launch-bound report and runs the container check. Observe actual app readiness. |
| `Lock(ctx, operationID, prepare)` | Run the trusted backend stop preparation, shut down the fixed Compose project, then run installed `fusermount3 -u` and observe closure. The callback is never supplied by a browser. |
| `Operation(ctx, operationID)` | Observe/reconcile the existing operation without redispatching a native effect. |

The gateway supplies only its authorized, bounded operation ID and, where
needed, raw 32-byte unlock material. It verifies the browser-method proof,
volume commitment and operation binding before calling this interface.
It never maps arbitrary request paths, commands, engine identities or
configuration into `Config`. `FusermountPath` must be an absolute installed
`fusermount3` path for Lock; setting it changes the pinned installation
configuration, so provision it when creating a new installation journal.

`State` separates `Storage` (`closed/open/unknown`) and app `Runtime`
(`stopped/starting/running/unknown`). `Configured` means native metadata
exists, not that its key has been verified. `Epoch` hashes observed kernel
boot, unique mount lifetime and container/start identity; it changes when those identities
change and stays stable across browser authorization/controller restart.
An uncertain observation has no usable epoch. The gateway publishes a new
epoch after durable initialization finalization, not while an earlier
authorization is still being consumed.

`Runtime=stopped` describes the app container only. It is insufficient to
authorize unmount: sidecars, CLIs, process aliases and other holders also
need stopping and observation. `Locked=true` additionally requires both Compose
project label queries and the configured app to be absent, no decrypted mount
aliases in the controller's mount table, no such aliases in readable processes
owned by the dedicated UID, and no matching gocryptfs daemon. An inaccessible
owner process namespace is uncertainty. This is a bounded observation under
the nonmalicious-runtime threat model; it does not prove an adversarial host
cannot hide a process or namespace. Browser logout, controller shutdown and
ambiguous observations never stop live work.

Linux can deny executable-link reads for the systemd user manager and its
forked PAM helper even to their own UID. That does not exempt their mount
namespaces: every readable mount table is still checked for aliases, and an
unreadable or malformed one refuses closure. Only an executable-link `EACCES`
can use independent attestation from the root system supervisor's
`user@<UID>.service` MainPID. Deck binds that manager to its UID, parent PID 1
and kernel start time. Another owner process is eligible only while currently
parented by that manager and carrying the kernel's fork-without-exec flag.
That flag means no exec since the process's own fork; it does not establish
executable origin. The user manager is a subreaper, so adopted orphan
descendants can qualify too. Their mount tables still undergo the same alias
checks. Process names and user-controlled cgroup membership confer no exception.
Manager and eligible process identities are rechecked, including a fresh
MainPID query, before returning success; changes, missing supervisor evidence,
other permission errors and processes that have exec'd remain uncertain.

This residual is accepted only under the nonmalicious-runtime model and the
supported, host-qualified upstream gocryptfs daemon behavior. For Deck's
background mount invocation, [gocryptfs v2.6.1 selects daemonization](https://github.com/rfjakob/gocryptfs/blob/v2.6.1/main.go#L138)
and [re-executes itself with `-fg`](https://github.com/rfjakob/gocryptfs/blob/v2.6.1/daemonize.go#L24).
Exec clears the fork-without-exec flag, so that daemon receives no exemption.
Deck validates the configured binary's path and layout, not its version or
implementation; this is not an ancestry proof or a guarantee for arbitrary
replacement binaries or hostile processes.

## Explicit workspace lock

The gateway verifies fresh method proof and revokes browser grants before
calling `Lock`. Its installed `prepare` callback calls the private backend's
`Manager.PrepareWorkspaceLock(ctx)` through the authenticated transport. The
callback must return failure for an unavailable backend or an uncertain stop;
there is no automatic skip for a stopped/unhealthy app.

Preparation closes the shared admission gate for launches, automatic/manual
recovery and terminal input/resize/scroll. It drains already admitted work,
then records every nonremoved session's stopped generation in one SQLite
transaction before signaling the first CLI. That marker survives ordinary
stop-request expiry and legacy recovery-counter cleanup. A new backend after
unlock has an open admission gate; it does not automatically restart these
generations. An operator's explicit Resume may create a new generation.

An unresolved recovery slot may still own a live provisional CLI even when
its session row has a terminal status. Preparation refuses every remaining
slot after draining admission and recording stop intent. The fence stays
closed and the native operation remains uncertain pending host reconciliation;
preparation never guesses which provisional process it may stop.

Preparation uses the existing exact-controller Stop path. It observes process
identity before each signal, allows five seconds for the graceful stop, then
uses a separately reobserved force stop only if the original operation remains
live. A cancelled or unverifiable stop leaves the fence closed and returns an
error. The fence has no in-process reopen switch. Successful preparation does
not claim to have stopped escaped CLI descendants or other application
writers: the controller then stops the whole Compose project, including
sidecars, before attempting unmount. App shutdown remains distinct from the
ordinary backend `Close`, which preserves CLIs.

The controller journals preparation, runtime shutdown and unmount boundaries.
A preparation error never proceeds to Compose down or unmount. A busy/hanging
unmount, surviving sidecar, retained alias or daemon cannot produce
`Locked=true`; an uncertain observation has no epoch and stays visible. No force or lazy
unmount is used. A repeated lock operation only observes; it never redispatches
an uncertain stop. Host reconciliation is required when the native effect
cannot be resolved by observation. No lock HTTP endpoint is registered by this
library; the gateway owns request authority and alternate-listener exclusion.

A later closed-state observation confirms a lock only when its journal reached
`stopping-runtime` or `unmounting`, proving preparation returned successfully.
An operation left at `preparing-stop` stays uncertain even after a host reboot;
closed storage alone cannot prove the session stop cohort was committed.
Resolving that missing preparation requires explicit host reconciliation.

## Interrupted operations and secret handling

The journal commits an operation and stage before dispatch. A repeated ID
cannot change kind. Other unresolved operations block new effects. The same
initialization ID may continue `prepared` (no native command dispatched) or
`initialized` (successful native initialization recorded with the exact
native-config digest, mounting not dispatched). A changed config digest
refuses continuation. A registry intent whose native journal entry was never
created can enter normally using that same authorized ID.

Interrupted `initializing`, `mounting`, `starting` and lock stages are observe-only;
file existence alone does not prove who initialized it, and a timeout does
not prove that a daemon failed to start. A matching observed effect can
settle the operation. Otherwise return uncertainty and preserve the backing;
do not retry under a new ID or delete/reinitialize it. Recovery of an
unresolvable native effect needs an explicit host reconciliation procedure.

The raw secret is encoded as unpadded base64url only into a private stdin
pipe for gocryptfs `-passfile /dev/stdin`. It never enters argv, environment,
temporary files or the journal. Initialization output is discarded; mount
uses `-nosyslog` and discarded output. Mutation command errors expose fixed
codes, never captured native stderr. Subprocesses receive a small explicit
environment, not ambient gateway/provider credentials. Clearing the local
buffer does not claim physical memory erasure. Host crash dumps, swap,
hibernation, service logging and TLS/request diagnostics remain deployment
responsibilities; a running gocryptfs process necessarily holds key material.

## Verification and required host evidence

The isolated tests use synthetic mount/engine facts and a fake command
runner. They cover durable stage continuation, uncertain-effect refusal,
fixed commands, secret redaction, runtime epochs, unsafe shared-host facts
and mount-loss refusal before store provisioning. Subprocess tests exercise
real stdin/stdout handling with public test material. Lock tests exercise a
cancelled stop against synthetic CLIs in isolated real tmux namespaces,
whole-cohort durability, terminal-write refusal, post-unlock recovery policy,
remaining sidecars, retained aliases/daemon and a hanging fake unmount. None
qualifies FUSE
or Podman on this container.

On a prepared Linux host, run:

```sh
deploy/test-workspace-runtime-host.sh
```

Exit 77 means prerequisites are unavailable. With prerequisites present,
failures remain test failures. The probe creates a disposable encrypted
root, runs real initialization/mount/nonlazy-unmount/unlock, and checks a
synthetic data import, startup guard, source preservation, durable import receipt,
plaintext-staging removal and mount epoch. It does not start Deck or attest
that root reads are denied.

Before enabling the profile, the host qualification still needs the
[sealed storage runbook](../sealed-storage-runbook.md)'s live denial probes
through host paths and `/proc` aliases, rootless UID mapping, all real store
mounts and launch-bound checks, plus interruption/reboot/backup restore with
real supported CLIs. Prove the gateway blocks alternate backend/preview
listeners and that no logged console credential bypasses it. Qualify the
physical host's swap, sleep images, crash dumps and VM snapshots. No
configuration flag or passing fake-runner test supplies this evidence.

Native CLI contracts: [gocryptfs manual](https://github.com/rfjakob/gocryptfs/blob/master/Documentation/MANPAGE.md)
and [Podman container inspection](https://docs.podman.io/en/latest/markdown/podman-container-inspect.1.html).


## Existing workspace import

`Config.Migration` pins a private snapshot path and manifest digest before the
installation journal is created. `Start` refuses without a matching completed
import and does not consume a start operation ID for that refusal. The local
`workspace import` command holds the gateway lifetime lock, checks recorded
initialization and real mount/workload state, and copies using an opened mount
root. Publication receipts live inside the encrypted root; the native journal
records only manifest and volume-configuration digests. Completed imports never
rewrite user data. See the [migration procedure](workspace-migration.md) for the
source shutdown, owner enrollment, import, fresh-proof resume and rollback order.

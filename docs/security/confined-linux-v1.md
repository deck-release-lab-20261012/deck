# Confined Linux v1 profile

- Status: Selected; no host has been qualified to run it
- Authority: ADR-0003 §5
- Threat model: ADR-0003 §1

## Outcome

`confined-linux-v1` is a shared-kernel Linux profile implemented by one narrow
host supervisor. The supervisor launches a pinned Bubblewrap sandbox for one
immutable project-policy revision, places the workload in a dedicated cgroup
v2 subtree, and reports effective-state evidence to Deck. It fails closed: a
missing primitive, mismatched revision, failed probe, or uncertain prior
workload rejects the confined launch. It never warns and continues
unconfined.

The previously measured deployment could not run this profile. Measured on
2026-08-09 from inside that deployment's application container, `uname`
reported its host kernel as Linux 4.4.302+; the effective cgroup mount was
read-only cgroup v1; unprivileged user namespace creation returned `EINVAL`;
and no Bubblewrap, container runtime, or external supervisor was available.
Rebuilding only the application image could not add those missing host
primitives.

The current development environment is a different, newer host and still
cannot run this profile. Measured on 2026-08-11 from inside a Deck agent
container, `uname -r` reports 6.19.12 and `/sys/fs/cgroup` is a read-only
cgroup v2 mount, but unprivileged user namespace creation fails with `EPERM`
under the container's own confinement, and no Bubblewrap, systemd, or
qualified external supervisor is present. The new deployment host has not been
accessed or qualified against this contract, and no host has passed the
hostile conformance gate. Confined testing therefore requires a modern Linux
host or VM and the external supervisor described here.

This record selects the substrate and its contract. It is not evidence that a
project is confined; that label requires the effective-state and hostile tests
described below on the deployment that will run it.

## Base host contract

The first supported host is a dedicated Linux VM or machine with:

- an actively supported Linux 6.6-or-newer kernel;
- the unified cgroup v2 hierarchy with delegated CPU, memory, PID, and I/O
  controllers;
- user, mount, PID, IPC, UTS, and network namespaces enabled;
- seccomp filter mode and no-new-privileges support;
- a dedicated supervisor service identity outside Deck and every provider
  workload;
- systemd 254 or newer as the system manager, with effective transient-service,
  `ExitType=cgroup`, and cgroup-v2 support; and
- Bubblewrap 0.11.2, pinned by the upstream release archive SHA-256
  `69abc30005d2186baf7737feacd8da35633b93cf5af38838ecff17c5f8e924f6`
  and, on linux/amd64, by the executable identity pinned below; host
  admission verifies the installed executable against that pin.

`ExitType=cgroup` predates this floor. The v254 floor instead includes systemd
fix commit `ef4300654e`, which resolves the directly relevant fast-exit startup
race reported as issue #27919: the main process could exit before exec-I/O
startup dispatch. The version floor remains an admission filter, not proof. At
startup the supervisor probes the actual namespaces, cgroup controllers,
seccomp support, mount behavior, and teardown path it will use. A disabled or
ineffective feature makes the profile unavailable.

Landlock may narrow the workload further when its effective ABI supports the
declared rules. It is defense in depth, not the primary boundary: its ABI
varies by kernel, and already-open file descriptors must be excluded before
the sandbox starts.

## Pinned executable identity

The Bubblewrap executable is not taken from a host package. It is produced
by `deploy/bwrap/build-bwrap.sh`, a recipe that builds linux/amd64 only and
fails closed on any other architecture. The first release supports no
second target.

Three digests describe the build, and none can substitute for another:

- the upstream release archive SHA-256 above, which pins the source and
  nothing else;
- the executable identity
  `7710b19d89bedbdd3b1dd8ac46643f188f8fdc92917fe3093abd827eb783cf7f`,
  the only value an attestation may present as the executable digest; and
- the deterministic packaged rootfs tar SHA-256
  `f61874a5bd6e02d89ffd0022f0bbd486a74948325923e7c8cac700b604501344`,
  which pins the staged install payload.

What the recipe pins itself: the four fetched archives — the Bubblewrap
source, libcap 2.71, GNU make 4.4.1, and Zig 0.14.1, which supplies the
cross compiler, linker, musl 1.2.5, and kernel UAPI headers that compile
and link the executable. libcap supplies the `sys/capability.h` header
bwrap includes and the `cap_from_name` call behind its `--cap-add` and
`--cap-drop` parsing, so libcap object code is statically linked into the
executable from the installed `libcap.a`; the recipe installs only that
archive, the header, and libcap's pkg-config file into the sysroot, and
builds libcap's capability name table with its own `_makenames` generator
compiled by the host C compiler instead of requiring gperf. The compile
warning set is fixed, not compiler-probed, and carries upstream meson's
warning flags minus `-Werror=parenthesis` and the conditionally probed
format trio. Optimization is fixed (`-O2 -g0`) and `SOURCE_DATE_EPOCH` is
fixed; the executable links statically (`-static`), the link discards the
symbol table (`-s`), debug info is omitted (`-g0`), and a strings check
rejects any leaked build path. The recipe verifies each output before
accepting it: correct ELF machine, no `PT_INTERP`, no `DT_NEEDED`, `ldd`
reporting not dynamically linked on the native target, the embedded
`bubblewrap 0.11.2` version string, no leaked build path, and both digests
above reproduced exactly.

What the recipe does not pin: the builder container supplies the ambient
tools the recipe runs on — POSIX shell utilities, python3, curl, GNU tar,
binutils — and the host C compiler and binutils that bootstrap GNU make
and build libcap's host-side capability-name generator. Those inputs are
pinned only by the digest-pinned builder image release acceptance uses,
not by the script; the digests above are proven inside that image, not on
an arbitrary toolchain.

The packaged rootfs tar carries the parent directory hierarchy plus
exactly one payload entry, `usr/local/libexec/noise/bwrap`: a regular
file, never a symlink, with mode `0555` and uid/gid 0 — the recipe
asserts the member's path, type, mode, and ownership from the archive
itself. The directory entries only place the payload; they are not
executable entries. The staged file additionally carries link count 1,
a property the ustar header cannot record, so that assertion covers the
staged file before packaging. Whether the file actually installed on a
supervisor host is a regular non-symlink file at that path with that mode
is verified by host admission when the host is qualified, not by
packaging.

Two independent clean builds inside the digest-pinned builder container
reproduced these bytes exactly, and release acceptance reruns that double
build on every release. The trusted supervisor compiles the same digest
into a closed GOARCH map. Attestation validation equality-checks the
observed executable digest against the pin for the attesting target; the
release archive digest proves only source provenance and can never
substitute for an executable pin, and a target outside the closed map
fails closed. Installing a different Bubblewrap, including one rebuilt
from the pinned archive with different inputs, fails the confined launch
rather than widening the pin.

## Trusted computing base

The base profile trusts:

- the host kernel and service manager;
- the pinned Bubblewrap executable and immutable runtime image;
- the narrow sandbox supervisor and Deck-side runner;
- Deck's protected project-policy and run records;
- the immutable exchange broker when artifact projections are enabled; and
- cgroup, firewall, and storage enforcement configured by the supervisor.

The provider executable, its children, project files, Git hooks, build tools,
dependencies, provider project settings, and development-container files are
hostile. None execute in the supervisor or select its mounts, policy, network,
credentials, executable, or fallback behavior.

This shared-kernel profile does not claim resistance to a host-kernel exploit.
A kernel-hostile threat requires a separately named microVM or dedicated-host
profile. The configured model provider, subscription credential, and declared
upstream account capabilities remain the external trust exception in
ADR-0003; this profile does not pretend to isolate data after it is sent to
that service.

## Execution shape

Deck and tmux remain outside the provider sandbox. For a confined session,
tmux starts one version-pinned runner instead of the provider directly. The
runner asks the supervisor to launch exactly one real provider executable and
passes the tmux pane's slave PTY file descriptors out of band. The supervisor
binds them to the provider's standard input, output, and error. Neither
component emulates the provider, inserts a shell, interprets terminal output,
or reports that terminal input arrived.

The supervisor is intentionally not a general container API. Its launch
request names only protected records:

```text
application_session_id
application_session_generation
project_policy_revision
provider_profile_revision
```

The pane PTY descriptors travel out of band over the authenticated local Linux
channel. They are verified as part of the run binding and are never represented
as caller-selectable paths. The request accepts no run ID, host path, mount,
executable, argument vector, environment entry, network destination,
credential, cgroup, UID, socket, or container option.

### Local channel and PTY identity

The v1 local transport has two role-separated Unix `SOCK_SEQPACKET` listeners
rooted in one supervisor-owned runtime directory that is not mounted into any
provider sandbox. They share no connected socket and accept no common message
shape. Cross-role identity or message use rejects the connection.

The runner-admission listener admits packets only from the pinned runner
identity in the expected Deck execution boundary. The runner verifies the
supervisor peer identity, and the supervisor enables per-message kernel
credentials. Each runner launch packet contains exactly one canonical request
and exactly three `SCM_RIGHTS` file descriptors for standard input, output, and
error. The receiver uses
`MSG_CMSG_CLOEXEC`, rejects either `MSG_TRUNC` or `MSG_CTRUNC`, and accepts
exactly one kernel-validated `SCM_CREDENTIALS` record plus one `SCM_RIGHTS`
record in either order. A short or oversized payload, duplicate or unknown
control record, extra descriptor, other descriptor type, missing kernel
credential, or sender/runtime mismatch rejects the launch and closes the
connection. Every descriptor received on a rejected packet is closed before
returning; accepted descriptors remain close-on-exec until deliberately bound
to the launcher. The channel is never passed into the provider workload.

The supervisor measures the received descriptors rather than trusting a TTY
path or caller-supplied identifier. All three must be open character-device
descriptors for the same PTY slave. The binding includes the current kernel
boot ID and descriptor-derived mount, device, inode, and terminal-device
identity. The supervisor rejects a PTY master, a non-terminal, three different
slaves, a pathname-only claim, or identity that cannot be measured on the
selected host. Holding the accepted descriptors open prevents that PTY object
from being recycled during launch. The canonical binding digest, not the
numeric descriptor values, participates in launch idempotency.

Kernel credentials and a hidden socket do not prove who influenced an
otherwise authorized process. The guarantee is narrower: only the fixed
trusted runner can exercise the admission listener, the hostile provider
cannot reach or inherit either listener, and a transferred connected
descriptor is rejected when the per-message sender identity changes. The
hostile conformance suite probes descriptor passing, sibling connection,
cross-role packets, ancillary-data, PTY-master, and PTY-reuse attacks against
the effective deployment.

### Crash-safe launch ownership

The supervisor, not Deck SQLite, owns a small durable run store in protected
host state. Before any workload side effect one transaction uniquely reserves
the pair `(application_session_id, application_session_generation)` and records
a supervisor-generated run ID, exact launch-request and PTY-binding digests,
deterministic systemd unit name and property digest, kernel boot ID, and a
closed launch phase. A concurrent reservation has one winner; the loser may
return the existing record only when every bound fact is identical, otherwise
it is a conflict. Phase changes are monotonic compare-and-swap commits. No
`REPLACE`, mutable upsert, or later Deck write can rewrite the authority row.
Deck cannot insert, update, or restore this store. The store contains authority
metadata only and never terminal or prompt content. An unavailable or corrupt
store disables new launch and replay admission. With a healthy store, startup
enumerates the dedicated confined service slice and reconciles every unit
against its retained authority row. If the store is unavailable or corrupt,
startup instead fences that entire slice; inability to prove the fence makes
the profile unavailable rather than creating a replacement workload.

The first substrate uses one deterministic transient systemd service per run.
The following literals are profile constants, never caller input:

- the dedicated service slice is exactly `noisedeck-confined.slice`;
- the launcher executable is exactly the root-owned, mode `0555`, regular file
  `/usr/local/libexec/noise/noise-deck` from the version-pinned immutable
  runtime image, not a symlink or a `PATH` lookup; and
- the `ExecStart` argument vector is exactly:

  ```text
  ["/usr/local/libexec/noise/noise-deck", "confined-launcher", "--run-id", "<supervisor_run_id>"]
  ```

  The final element is the generated canonical supervisor run ID and is the
  only dynamic input.

The launcher mode accepts no other argument, caller-selected path, argument,
environment entry, credential, or option. It receives the already-validated
PTY descriptors and closed sandbox plan from the supervisor, then executes the
pinned Bubblewrap/provider chain. The supervisor calls `StartTransientUnit` in
non-replacing `fail` mode and never mutates an existing unit. The closed unit
properties include `Type=exec`, `ExitType=cgroup`, `RemainAfterExit=yes`,
`CollectMode=inactive`, `Restart=no`, `KillMode=control-group`,
`SendSIGKILL=yes`, a bounded stop timeout, `Slice=noisedeck-confined.slice`,
`StandardInput=null`, `StandardOutput=null`, `StandardError=null`, and the exact
pinned launcher executable and argument vector above.

These constants address substitution of a caller-chosen cgroup or executable
before the hostile workload boundary exists. The trusted supervisor owns their
enforcement and fails the confined launch before release if packaging,
transient-unit creation, or readback cannot prove an exact match. The hostile
effective-state test replaces the executable with a symlink or different file,
adds or changes one argument, injects an environment-selected executable,
moves the unit to another slice, and changes each initial stream; every case
must be rejected before any sandbox or provider code executes. Successful
readback must prove the exact slice, null stream properties, executable path,
argument vector, invocation identity, control group, lifecycle properties, and
effective resource assignments. Changing the slice identifier, launcher
install identity, launcher mode, or argument shape requires a new confinement
profile revision; it cannot mutate `confined-linux-v1` in place. Neither Deck
nor the runner receives the system D-Bus connection or a general unit
management capability.

The systemd-spawned launcher begins in one inert trusted bootstrap mode. It has
null standard streams, receives no project view, provider credential, sandbox
plan, or PTY, and cannot execute Bubblewrap or provider code. It connects only
to the launcher-bootstrap listener, verifies the supervisor peer, and sends one
fixed canonical hello containing the generated run ID and systemd-provided
invocation ID with no file descriptors. The supervisor enables per-message
credentials on this listener and accepts that hello only from the pinned
launcher executable in the exact recorded unit and cgroup; a runner identity,
runner request, descriptor, extra field, noncanonical packet, or second hello
rejects the connection.

Only after the launcher identity and unit property readback match does one
durable phase compare-and-swap authorize an exact content-free launch ticket
bound to the run, request, PTY, plan, unit, and invocation digests. The one
supervisor response has a fixed canonical envelope containing that ticket and
the exact closed sandbox plan plus exactly three `SCM_RIGHTS` descriptors for
the already-validated PTY. The launcher requires the expected supervisor
per-message credentials, rejects normal or ancillary truncation and any other
control-message shape, and closes every received descriptor on rejection. The
plan may name only supervisor-derived resources already bound by the immutable
policy revision; it contains no caller-selected path, executable, argument,
environment entry, credential, or option. The launcher verifies the ticket and
plan digest, accepts that combination at most once, binds the descriptors,
closes the bootstrap connection and every unrelated descriptor, and executes
the pinned chain.

If the supervisor disconnects before release, the launcher remains inert and
reconnects; it never times out into a fallback or starts from local data. A
restart may resend only the same authorized ticket to the same authenticated
launcher. If the launcher has already executed it, reconciliation observes the
recorded unit and sandbox instead of starting another process. The bootstrap
channel is outside the provider view and is never inherited by the provider.

`RemainAfterExit=yes` keeps a successfully exited transient service available
for result collection; a failed service is also retained under the selected
collection policy. The supervisor must durably record the service result and
positive empty-cgroup observation as `terminal` with cleanup pending before it
stops/releases the retained unit for garbage collection. Cleanup idempotently
stops an active-exited unit, resets a retained failed unit only after its result
is recorded, and observes the deterministic unit absent before marking cleanup
complete. On supervisor restart, every nonterminal row and every terminal row
whose cleanup is not complete is reconciled before new launch admission. An
already absent unit completes terminal cleanup only because the result and
empty-cgroup evidence were durably recorded first. A missing preterminal
result, prematurely collected unit, changed property, or unsupported retention
behavior is `needs_attention`, never evidence of successful exit. Startup
probes this behavior with a fast successful process, a fast failure, crashes
before and after terminal commit, and service-manager reconciliation; version
text alone is not readiness evidence.

Launch has five closed phases:

1. `prepared`: the unique durable reservation and run ID exist, and no
   service-manager request has been admitted;
2. `starting`: a successful compare-and-swap has durably crossed the one-way
   point after which it may issue `StartTransientUnit` for the recorded unit
   name;
3. `authorized`: the inert launcher's unit and effective properties match, and
   one durable ticket is authorized for that exact launcher and binding;
4. `running`: the service manager reports that exact unit and its observed
   cgroup, launcher, request, PTY, and sandbox facts match the record; or
5. `terminal`: the unit's complete workload cgroup is positively empty after
   observed exit or supervisor-directed teardown, with its content-free result
   retained and unit cleanup tracked separately to completion.

An exact retry while `prepared` may continue the same run. A retry in any later
phase only reconciles the recorded unit; it never chooses a new unit or run ID.
If a `starting` call times out, the supervisor queries the deterministic unit
name. A matching unit is adopted, a conflicting unit fails closed, and absence
is uncertain because the unit may have run and disappeared; that case becomes
`needs_attention` and is never blindly restarted. Supervisor restart performs
the same reconciliation before accepting launches. A changed request or PTY
binding for an existing application-session ID and generation is always a
conflict. A terminal exact retry returns the recorded identity and outcome and
never relaunches. A host boot-ID change cannot resume the old PTY/workload
binding and requires normal session recovery with a new application-session
generation.

`needs_attention` is a Deck session status, not a sixth supervisor phase. The
durable row remains in the last proven phase with its uncertain reason and
cleanup state recorded. Operator recovery never rewrites that row or reuses its
application-session generation; it fences the old unit and proceeds, if safe,
through a new generation.

This composition deliberately avoids a distributed transaction between Deck,
the supervisor, and process creation. The protected record supplies durable
intent, the deterministic service-manager identity closes a lost-response
window, and conservative `needs_attention` handles the one outcome that cannot
be proven. A generic container API, retry under a new name, or Deck-owned
deduplication would not provide the same guarantee.

After validating the protected request and PTY binding, the supervisor issues
the `supervisor_run_id` and `sandbox_generation` and returns them with a
content-free attestation. The pair `(application_session_id,
application_session_generation)` is the launch idempotency key. An exact replay
for the same immutable revisions and PTY binding returns the same run identity;
reuse with a different policy, provider profile, or PTY binding is a conflict
and becomes `needs_attention`. It never creates a second workload for that
key.

`provider_profile_revision` resolves through one version-pinned
`confined-linux-v1` manifest compiled into the trusted supervisor,
not through caller input or the mutable host-oriented provider descriptor. A
manifest is a closed canonical record containing the provider name, descriptor
revision, tested CLI version, immutable-runtime-relative executable, and
executable artifact SHA-256. Its canonical digest is the project policy's
provider-profile digest. The supervisor selects an exact manifest by that
digest and constructs the executable arguments and environment itself; an
unknown, malformed, cross-provider, or artifact-mismatched profile refuses
launch.

The supervisor owns launch, observation, termination, and reaping. Deck never
receives a Docker, Podman, containerd, or host-administration socket. Provider
stop targets the complete cgroup/sandbox instance, not only the tmux pane or a
single PID. Unknown prior state becomes `needs_attention`; recovery never
starts a duplicate workload.

## Effective project view

Each run receives a fresh namespace and a stable project-domain identity. The
managed view contains only:

- an immutable runtime and pinned provider executable;
- the exact managed project view, including its Git common directory and
  project-local `.worktrees/` and `.review/` locations;
- one private per-application-session home, provider history/state, XDG state,
  and bounded scratch area;
- immutable runtime assets and, after ADR-0002 exchange is enabled,
  content-addressed artifact projections admitted by its exchange broker; and
- the assigned PTY plus minimal synthetic devices required by the CLI.

The view does not contain the host workspace root, sibling projects, operator
home, another session's state, Deck data, tmux or supervisor sockets, host
`/proc`, host `/sys`, cgroupfs, runtime sockets, global credentials, SSH agents,
or special host devices. The private network namespace separates the abstract
Unix-socket namespace; the mount view hides forbidden pathname sockets; and
launch closes inherited socket descriptors. No one mechanism is treated as
complete socket isolation.

### Managed-view destination vector

The closed sandbox plan (`noisedeck.sandbox-plan.v1`) fixes six role
destinations. They are `confined-linux-v1` profile constants in this exact
canonical order, each role exactly once:

```text
runtime /usr
project /project
git_common /project.git
session_state /home/agent
scratch /tmp
imports /imports
```

- `/usr` is the pinned immutable runtime subtree carrying the provider
  executable and its toolchain;
- `/project` is the one managed project view, including its project-local
  `.worktrees/` and `.review/` reservations;
- `/project.git` is the Git common and administrative state of the same
  project backing. The workload reaches it only through the
  supervisor-materialized in-view Git indirection at `/project/.git`; a
  caller host path, external common directory, alternate, or hardlink is
  never a source for this destination;
- `/home/agent` is the private per-application-session home carrying the
  provider history and XDG state of exactly this run;
- `/tmp` is the bounded per-run scratch store; and
- `/imports` is the policy's admitted immutable, content-addressed input
  set.

The six destinations are pairwise disjoint at path-component boundaries:
none is a component-prefix of another, so no destination can overlap or
ancestor-shadow another. Each plan layout entry binds its role to one
supervisor-measured content digest, never to a host path, mount source, or
probe result.

The named threats are destination substitution — a caller substituting,
adding, reordering, or renaming a destination to redirect a role onto
other content; ancestor shadowing — one destination capturing another's
content; and cross-domain source exposure — a role resolving to live host,
sibling-project, operator-home, control-plane, or external Git content.
The trusted supervisor and launcher under this fixed profile own the
enforcement: the supervisor derives every plan with exactly these roles in
this order at these destinations, and the launch request and plan carry no
destination-selecting input. Plan verification, view materialization, and
effective-state readback must each prove this exact vector; any mismatch —
a substituted, duplicated, missing, reordered, unknown, overlapping, or
unprovable destination — rejects the confined launch before any sandbox or
provider code executes. The profile never warns and continues.

The hostile effective-state tests replace, rename, or
reorder one destination; redirect a role onto another destination's
content; shadow a destination with a symlink or ancestor directory; and
bind a destination to an external Git common directory, alternate,
hardlink, or sibling-project source. Every case must fail before the
workload starts, and a workload observing any destination resolving to
content other than its measured identity is a confinement failure.

Destination changes — to the set, the order, or any destination literal —
require both a new confinement profile revision and a new plan schema; neither
`confined-linux-v1` nor `noisedeck.sandbox-plan.v1` may be widened in place.
This vector ratifies destination authority only: it creates no mount,
source-resolution, runtime, or materialization behavior — those belong to
later proof slices under their own revisions.

A per-project host identity is defense in depth and filesystem ownership, not
the capability identity. The supervisor binds authority to the protected run
record and sandbox instance. Identity reuse is allowed only after prior
processes are reaped, mounts are detached, sockets are unlinked, capability
channels are closed, and retained storage is either purged or reassigned by
the supervisor before the identity is issued again.

## Privilege and resource boundary

The sandbox starts with no inherited ambient capability, credential, agent,
unexpected descriptor, host keyring, or controlling socket. It uses a private
PID view with an init/reaper, a minimal device view, `RLIMIT_CORE=0`, a
no-new-privileges policy, and the profile's seccomp filter. The provider may
receive only the PTY and explicit run channels named by the policy.
Terminal policy denies input-injection ioctls including `TIOCSTI` and
`TIOCLINUX`; conformance probes PTY ioctls and cross-boundary signals against
the effective workload.

Every run has cgroup v2 CPU, memory, PID, and I/O limits. Project storage and
scratch have byte and inode quotas, and control-plane storage retains reserved
capacity outside the project failure domain. Termination stops credential
refresh and kills the entire workload boundary. A copied remote bearer token
remains visibly pending until authoritative revocation or expiry, as required
by ADR-0003.

The numeric bounds come from the closed `noisedeck.project-policy.v1`
canonical policy: process count; memory, per-run cumulative content-blind
PTY-output, project, scratch, and exchange bytes; project and scratch inode
counts; a hard `{quota_per_sec_usec, period_usec}` CPU cap; and I/O
read/write bytes-per-second and ops-per-second rates. Every value is an
explicit positive integer — zero, defaults, and unlimited sentinels are
invalid at canonicalization. The per-period CPU quota is
`floor(quota_per_sec_usec * period_usec / 1_000_000)`; a result below the
kernel's 1,000-usec minimum is invalid, and flooring never widens the cap. The
policy commits numbers only; this profile's
immutable revision digest commits their mapping onto cgroup v2 controls, the
resolution of each bounded store's backing device — the I/O rates apply per
resolved device, and an unresolved device or a readback mismatch fails the
confined launch closed — how multiple devices coalesce, and the startup probes
that must pass before the numbers are believed. Output bytes are counted
content-blind against the per-run PTY budget and overage terminates the run
for `resource_limit`; exchange bytes bound the aggregate retained immutable
exchange-store bytes for the security-domain revision, and a signed route may
only lower that bound.
The policy's exact lowercase SHA-256 `memory_scope_digest` binds the closed
project-memory authority already resolved by the control plane.

## Network staging

The first proof slice launches with no external network. It establishes the
filesystem, process/control, PTY, capability, resource, and teardown boundary
without conflating those claims with egress policy.

The next network stage adds the production network namespace and egress
enforcement. The base rule denies host, loopback-to-host, LAN, metadata,
control-plane, sibling, and proxy-bypass paths. A run then admits the exact
provider, mapped source control, package, documentation, and project-memory
destinations in its immutable policy. Destination filtering claims only
connections and destinations; opaque TLS is not described as method, path,
redirect, or body filtering.

## Attestation contract

The supervisor sends a content-free attestation over its mutually authenticated
private channel, bound to the run. Deck stores and displays at least:

- profile name and immutable profile revision;
- supervisor build identity;
- kernel release and effective namespace/seccomp results;
- Bubblewrap archive digest and the executable identity, equality-checked
  against the closed linux/amd64 pin above;
- effective cgroup v2 hierarchy/controllers;
- project-policy and provider-profile revisions;
- sandbox instance and supervisor run IDs;
- session ID and generation;
- network-policy revision and credential class; and
- launch time, last reconciliation time, lifecycle state, and any content-free
  unavailable reason.

The evidence is descriptive, not self-authorizing. Deck accepts it only over
the private supervisor channel and checks it against the protected requested
run. A mismatch fails launch or reconciliation. Project content cannot mint,
replace, or widen an attestation.

Separately, each policy revision carries the content-free backing attestation
`noisedeck.project-backing-attestation.v1`. It binds exactly the server-owned
`attestation_id`, the policy `revision_id`, the `security_domain_id`, the
`policy_digest`, the supervisor-attested `backing_digest`, and the pinned
`confinement_profile_digest` (equal to the verified policy's
`noisedeck.project-policy.v1` confinement-profile digest). It carries no
managed-view, runtime, supervisor-build, path, state, secret, or expiry field.
Its digest is the canonical sha256 of those exact bytes, and verification
equality-checks the retained object against the trusted verifier's expected
binding; a missing, malformed, or mismatched backing attestation rejects the
confined launch closed and never falls back.

## Required proof before `confined` is visible

The hostile conformance suite’s first thin slice uses one real
provider CLI and proves, from inside the effective workload, that it cannot:

- launch when a required host primitive is absent, a protected revision or
  attestation mismatches, or effective-state verification fails, and never
  fall back to the unconfined profile;
- enumerate or access a sibling project, operator home, Deck database, tmux or
  supervisor socket, another native provider history, or undeclared host
  process;
- reuse a copied socket, capability, descriptor, stale identity, or Git
  alternate/common-dir trick to cross the boundary;
- signal, attach to, or manipulate the runner/supervisor through the PTY or
  process APIs;
- exceed the tested process, memory, output, scratch, project-storage, or inode
  bounds without preserving control-plane capacity; or
- leave a process, mount, capability channel, credential-refresh source, or
  control route after cancellation, supervisor restart, or teardown.

After network enforcement is implemented, the same suite proves forbidden
host/private egress fails and the declared provider workflow succeeds. Every
supported real CLI must then pass the full hostile conformance matrix; a mock
or configuration dump is not release evidence.

## Alternatives not selected

- **Current Compose container plus another package:** rejected because a
  helper installed inside the application container remains inside the
  workload's trust domain and cannot construct or attest the boundary, and no
  host running that topology has been qualified against the hostile conformance gate.
- **Deck with a Docker or containerd socket:** rejected because it gives the
  application a broad host-control capability unrelated to its product role.
- **A Unix UID and file modes without a supervisor:** rejected because they do
  not construct or attest the process, IPC, network, device, resource, PTY, or
  teardown boundary.
- **Provider-native permission and sandbox flags:** retained only as optional
  defense in depth; they vary by CLI and may warn, fall back, or protect a
  different boundary.
- **A portable sandbox abstraction:** deferred until a second proven substrate
  requires one. The v1 implementation targets this profile directly.
- **A microVM:** deferred to a stronger kernel-hostile profile. It adds material
  deployment and lifecycle complexity beyond the named baseline threat.

## Primary references

- [Bubblewrap project and security model](https://github.com/containers/bubblewrap)
- [Bubblewrap 0.11.2 release archive (`bubblewrap-0.11.2.tar.xz`)](https://github.com/containers/bubblewrap/releases/download/v0.11.2/bubblewrap-0.11.2.tar.xz)
- [systemd manager D-Bus API](https://www.freedesktop.org/software/systemd/man/latest/org.freedesktop.systemd1.html)
- [systemd service lifecycle](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html)
- [systemd issue #27919: fast-exit `ExitType=cgroup` startup race](https://github.com/systemd/systemd/issues/27919)
- [systemd fix commit `ef4300654e`](https://github.com/systemd/systemd/commit/ef4300654e70e76ed74f7d544e0f44c5d92fb698)
- [Linux cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html)
- [Linux Landlock userspace API](https://docs.kernel.org/userspace-api/landlock.html)

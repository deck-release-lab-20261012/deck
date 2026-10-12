# Tasks-owned Docker worktree boundary v1

- Status: Ratified design; no implementation or deployment is qualified
- Scope: task-bound worktree isolation
- Tasks protocol floor: 1.3.0; no released build is qualified for privileged
  topology execution until it implements the topology-only Git path below
- Confinement relationship: disjoint from and narrower than the full confined-project profile

## Security outcome

For an automated write-capable run, `docker-task-workload-v1` makes the pinned
Tasks engine the sole writer of linked-worktree topology. The engine atomically
claims the task and creates its assigned worktree before a provider process can
start. A trusted external materializer then constructs and verifies one Docker
workload that can perform ordinary source-control work in that checkout but
cannot create, register, move, repair, prune, deregister, or delete a linked
worktree.

This is one narrow authority claim. It does not isolate sibling projects,
credentials, memory, provider accounts, control state, process trees,
resources, or network destinations to the standard required by ADR-0003. It
does not replace the Bubblewrap substrate selected by `confined-linux-v1`,
satisfy any part of the full confined-project profile, qualify a project or
session as confined, or make Continuity available. The existing Compose
application remains explicitly unconfined and is not an enforcement path for
this profile.

## Threat and accepted authority

The adversary is a mistaken or hostile provider process and every child or
project-controlled program it launches. It may invoke Git under another name,
choose another `--git-dir` or `GIT_COMMON_DIR`, issue filesystem syscalls
directly, use symlinks, hardlinks, mount aliases, inherited descriptors, or
`/proc/self/fd`, and modify every project byte the assigned workload is allowed
to write. It may try to make the trusted lifecycle owner execute a Git hook,
filter, monitor, pager, alias, include, SSH command, or other project-selected
program with topology authority. It may crash or race create, stop, release,
and reconciliation.

The workload is allowed to damage or disclose its assigned project data. It may
edit files and perform status, add, commit, branch, fetch, and a separately
scoped push in the mapped repository. It may create nested ordinary repositories
or submodules inside the checkout. Those authorities do not include changing
the host linked-worktree registry or the supervisor-trusted binding of its own
assigned entry.

The host kernel, Docker daemon, pinned Tasks engine, and trusted external
materializer are in the trusted computing base for this one property. A
compromised kernel, daemon, Tasks engine, materializer, or host administrator is
outside the threat model. No broader Docker security claim follows from that
trust choice.

## One lifecycle owner per resource

The pinned Tasks engine owns task claim, fencing token, branch derivation,
worktree creation, binding, release, and prune semantics. It is the only
component allowed to mutate linked-worktree topology. The external materializer
invokes that released operation and owns protected filesystem resolution,
Docker create, inspect, start, stop, and teardown. It never reproduces Tasks
naming, runs `git worktree add` itself, adopts an existing directory, or treats
a path supplied by Deck or the workload as authority. Tasks never launches or
inspects a container.

Deck requests a run with protected project, task, run, and provider-profile
identities only. It supplies no host path, branch, worktree name, claim owner or
token, executable, argument, environment entry, image, mount, network,
namespace, security option, or runtime socket. The materializer retains the
claim token and every host path in protected state. Neither is mounted into or
returned to the workload.

The materializer must not run a generic host Git command against
provider-controlled configuration while it holds topology authority. The
pinned Tasks worktree operation uses a topology-only Git invocation with a
trusted empty hooks path and no checkout or other project-code execution in the
privileged phase. Generic host-side `git worktree prune` is forbidden while a
bound workload is active. A later Tasks release or prune occurs only after the
workload is stopped, its complete container boundary is empty, and the protected
binding has been reverified.

Tasks 1.3.0 establishes the atomic claim-and-worktree protocol floor, but its
current Git invocation is not evidence for this stronger execution property.
Qualification requires a later pinned Tasks release that implements and tests
the topology-only path; a materializer may not compensate by copying its naming
or worktree algorithm.

## Protected Git view

The workload sees one fixed checkout destination and an in-view `.git`
indirection created by the materializer. The indirection names only fixed
container destinations and never contains a host path. The repository entry
checkout, project `.worktrees/` parent, Tasks live store through another
checkout, and sibling worktree checkouts are absent.

The workload needs mutable objects, refs, logs, its assigned `HEAD`, and its
assigned index and lock files for ordinary Git work. That need does not make
all Git common and administrative bytes safe to share with a privileged
lifecycle process. At minimum, the effective mount construction must provide:

- the linked-worktree registry as read-only, with no second path or descriptor
  exposing it writable;
- only the assigned administrative entry overlaid writable inside that
  registry;
- the assigned entry's supervisor-trusted `gitdir` and `commondir` files as
  deeper read-only covers;
- shared hooks, repository configuration, and Git `info` configuration as
  read-only covers; and
- a verified shared configuration in which `extensions.worktreeConfig` is
  absent or false, so a provider-created per-worktree configuration cannot
  enter the privileged lifecycle path.

The assigned administrative directory may contain mutable Git state. The
materializer never trusts workload-created `locked`, `prunable`,
`config.worktree`, or unknown files as lifecycle authority. Before release it
compares the trusted `gitdir` and `commondir`, registry identity, branch, claim,
and every Tasks binding fact against protected state. An unexpected or
unprovable binding is not repaired or pruned automatically.

The implementation must specify the exact mount vector.
Four broad mounts from the earlier draft are explicitly not the ratified vector: a
writable whole Git common directory allowed privileged hook/configuration
injection, and a writable whole assigned entry allowed `git worktree repair` to
rewrite `gitdir` and induce host-side deregistration.

## Closed plan and filesystem identity

The workload plan is content-free and contains no host path, mount source,
image, command, environment entry, credential, Docker option, task token, or
socket. Its run and receipt binding is derived inside the materializer from the
fresh live Tasks record and retained protected state, never from a set of facts
supplied by its caller. A verifier must compare it with those independently
loaded authorities; re-deriving a digest from the caller's same facts proves
encoding consistency, not authority.

A mutable directory has no useful content SHA-256 identity. The materializer
opens each filesystem object beneath the already-attested backing with
descriptor-relative, no-link resolution; verifies its mount identity, device,
inode, type, and canonical role-relative location; and retains the protected
descriptors through container creation and effective-state inspection. Any
canonical receipt digest is over a versioned record of those measurements and
the exact re-read Tasks binding. Its field set and byte encoding must be
specified before implementation; an unexplained “directory SHA-256” is not an
identity algorithm.

## Docker enforcement floor

The external materializer is the only component with Docker authority. Deck and
provider workloads receive no Docker, Podman, containerd, systemd, supervisor,
or generic host-administration socket or API. The image is selected by immutable
ID from protected policy and built from a minimal pinned provider workload
stage, not by inheriting the Deck server, Tasks engine, build toolchain,
`EXPOSE`, or application healthcheck. It has an inert default and explicitly no
healthcheck; the materializer alone selects the pinned provider profile.

Before provider release, daemon inspection and in-container observation must
prove the exact accepted profile, including:

- read-only root filesystem, canonical numeric nonzero UID and GID, all five
  capability sets numerically zero, all capabilities dropped, and
  no-new-privileges effective;
- no privileged mode, device passthrough, added group, runtime socket,
  supervisor socket, host PID/IPC/network mode, shared propagation, or
  caller-selected runtime;
- an exact allowlist for security options, runtime, tmpfs or volume mounts,
  sysctls, masked and read-only paths, entrypoint, command, environment, and
  healthcheck rather than acceptance of daemon defaults or ignored fields;
- explicit private IPC, user, and cgroup modes plus host-versus-container
  effective namespace identities on the qualified Docker host; a daemon default
  or a host without the required user-namespace mapping does not qualify; and
- every topology-sensitive nested mount, read/write flag, source object
  identity, destination, and propagation mode, with no extra alias exposing a
  protected source.

The container may use exact profile-owned private home and scratch mounts.
Those auxiliary mounts are not authority to add arbitrary bind or tmpfs
destinations, and none may alias project administrative state, a host workspace,
or a runtime socket. Runtime mount observation checks the complete pinned
profile allowlist, including expected engine pseudo-mounts; it may not silently
ignore every destination outside the topology mounts.

Ordinary provider use, fetch, and scoped push require network access. The
materializer therefore selects one protected non-host Docker network profile
and proves a distinct effective network namespace. This milestone does not
filter or attest egress destinations: that missing protection remains visible
unconfined behavior until production network enforcement is implemented.

## Admission, failure, and recovery

The materializer performs this sequence without releasing provider code:

1. Resolve the protected project, task, run, image, and provider-profile
   records.
2. Invoke the pinned Tasks engine's atomic claim-and-worktree operation and
   retain its fencing token privately.
3. Re-read live authority and require exact owner, token, task revision,
   non-expired claim, repository boundary, branch, worktree path, and binding.
4. Resolve and hold every source object beneath the attested backing, derive
   the closed plan, and create one deterministic inert container.
5. Reconcile a create timeout by that exact container identity. A matching
   effective state may continue; a conflict or unprovable absence becomes
   `needs_attention` and is never retried under another name.
6. Verify daemon inspect state, the complete runtime mount view, process status,
   namespace identities, protected Git bytes, and absence of leaked descriptors
   before releasing the pinned provider.

A pre-release mismatch removes only an exactly identified inert container and
uses the current retained fencing token to release the claim without deleting
dirty work. An uncertain identity, stale token, dirty binding, or failure to
prove safe cleanup becomes `needs_attention`. After provider release, detected
binding drift or loss of effective enforcement fences and stops the exact
workload; it is never treated as successful release. There is no automated
unconfined fallback. A separately operator-selected compatibility session may
remain available only when visibly labeled unconfined and unavailable to
automated admission.

## Hostile effective-state gate

Qualification runs only on the deployment Docker host, in disposable
Tasks-created fixtures, with every supported real provider CLI. A denial counts
only when a paired positive control proves the operation was otherwise
well-formed and the observed failure is the enforcement reason such as
`EROFS`, `EACCES`, or `EPERM`; an absent executable, malformed command, missing
parent, or unrelated `EBUSY` is not evidence.

| Threat | Enforcement owner | Failure behavior | Required hostile evidence |
| --- | --- | --- | --- |
| Git or direct registry mutation creates, moves, removes, or renames topology | Kernel-enforced registry cover, absent `.worktrees/` parent, no writable alias | Operation is denied while the Tasks binding stays unchanged | `git worktree add`, `move`, `remove`, `repair`, and `prune`; create, rename, unlink, symlink, hardlink, descriptor-relative and `openat2` writes; renamed Git; alternate `--git-dir`, `GIT_COMMON_DIR`, and `/proc/self/fd` |
| Assigned admin mutation deregisters the live worktree | Read-only `gitdir` and `commondir`, no active generic prune, before/after protected binding verification | Workload is fenced and state becomes `needs_attention`; no repair, adoption, or prune | Mutate, replace, link, and repair each binding file; inject `locked`, `prunable`, `config.worktree`, and unknown entries; verify host lifecycle cannot be redirected |
| Provider-controlled Git state executes with topology authority | Read-only hooks/config/info plus topology-only Tasks Git invocation and trusted empty hooks path | Claim or release stops before any project-selected process executes | `post-checkout`, `reference-transaction`, filter, fsmonitor, pager, alias, include, and SSH-command canaries never execute during claim, reconciliation, or release |
| Docker options, mounts, capabilities, or sockets bypass the cover | External materializer, exact create profile, daemon and runtime readback | Provider remains inert; exact container is removed or state becomes `needs_attention` | Mutate every inspected field; add bind, volume, tmpfs, alias, group, device, runtime, sysctl, unconfined security option, shared propagation, runtime socket, remount, and detach attempts |
| A stale or substituted task/path gains a workload | Atomic Tasks claim, fresh equality read, descriptor-rooted resolution | Refuse before container or provider side effects | Stale, expired, foreign, wrong-revision, wrong-branch, wrong-boundary, symlink, mount, hardlink, alternate, special-file, and inherited-descriptor cases |
| Crash or timeout creates a second lifecycle owner | Deterministic identity and retained fenced state | Exact replay, conflict, or `needs_attention`; never a differently named retry | Crash and timeout before and after each create/start/stop/release transition, daemon and materializer restart, dirty work, stolen token, and operator stop |

The positive path proves edit, status, add, commit, branch, fetch, and scoped
push inside the assigned checkout. Nested repositories and submodules must not
open an administrative alias. Host-side observation compares the registry,
Tasks live record, container identity, protected Git binding, mounts,
namespaces, and whole workload state after every destructive transition.

Unit tests, requested Docker options, image labels, container status, or a fake
provider cannot qualify the boundary. Until the real-host gate passes, the
profile remains a ratified design with no implementation or deployment
qualified.

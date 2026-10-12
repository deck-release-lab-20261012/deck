# ADR-0003: Project security domains

- Status: Accepted
- Date: 2026-08-09
- Decision owner: Operator
- Amends: ADR-0001 decisions 2 and 3, and ADR-0002 decisions 2, 5, 6,
  and 7, only as described below

## Context

Noisefloor Deck currently launches every provider CLI as one Unix identity in
one container. The deployment mounts the whole host projects root, one provider
home, the operator's GitHub CLI credentials, shared MemPalace state, and one
tmux namespace. A project selects a working directory, but a provider can walk
to sibling projects, create a Git worktree elsewhere, inspect same-principal
processes, reach shared control sockets, and use ambient credentials against a
different remote repository. The current README correctly calls this profile
unconfined.

That topology cannot support a non-forgeable delegation protocol. A signed
grant is meaningless if its holder can edit protected state, control a sibling
session, steal the successor's capability, or act on another project through a
shared filesystem or credential. A prompt that says "stay in this directory,"
a canonical path check, a Git worktree, provider permission prompts, and file
modes shared by an equivalent Unix identity are conventions, not boundaries.

The intended policy is asymmetric: an assigned agent may work freely inside
one project, including its mapped remote repository. Crossing into another
project; authenticated access to or mutation of another repository; Deck
control state; another session's authority; global memory; or host
administration through Deck-controlled local, credential, and broker paths is a
different act and requires explicit authority. Public read-only repository
access follows the declared egress policy; configured upstream-provider paths
are separately disclosed below. The design must make that boundary real without
growing into a general zero-trust agent platform.

## Decision

### 1. The design has a narrow threat model and complexity budget

The baseline confined profile protects sibling projects, session-control
capabilities, operator-global credentials, and the Deck control plane from a
mistaken or hostile user-space provider process and the children it launches.
It does not protect the assigned project from its assigned agent. Damage,
disclosure, or bad changes inside that project remain possible and are handled
by Git, backups, review, and remote branch protections.

The host kernel, selected sandbox substrate, trusted supervisor, Deck control
plane, WebAuthn verifier, and immutable exchange broker are in the trusted
computing base. The configured model provider, subscription account, and
provider authentication path are explicit external trust boundaries: sending
the current project's content to that provider is the product's purpose. The
baseline subscription-CLI profile also accepts that the provider process may
be able to extract or reuse its own account credential and consume shared
subscription capacity outside Deck; every provider profile must measure and
disclose that fact plus every account-wide history, cloud task, connected-
repository, tool, and server-side action the upstream account exposes. This
exception grants no authority through Deck's local filesystem, broker, mapped-
remote credential, or control plane, but an unavailable upstream restriction
cannot be restated as a local guarantee. A profile may claim cross-repository
isolation only when provider-mediated actions are disabled or proven absent;
otherwise that path is a visible external exception. A separately named
provider-credential-isolated profile may require an opaque brokered credential
when a real CLI supports one. The baseline does not claim protection against a
compromised host kernel, hypervisor, provider vendor, or operator browser. A
separately named stronger
profile may add a microVM, dedicated host, hardware-bound credential, or
special-device policy without changing the project or Continuity protocol.

No mechanism belongs in the baseline unless it closes a named threat, has one
enforcement owner, fails closed, and has a hostile effective-state test. One
immutable project run policy replaces independently mutable filesystem,
network, credential, memory, and action lease state machines. One substrate is
implemented and proven first; Noisefloor Deck does not build a portable sandbox
abstraction before a second real substrate requires one. Typed brokers are used
only where an operating-system boundary, provider-supported scope, or remote
platform permission cannot express the required policy.

### 2. A project and its mapped repository form the default authority domain

Every confined project has a stable security-domain ID and immutable, versioned
policy revisions. A revision is the canonical digest of:

- the supervisor-attested managed backing identity and project view;
- the private per-session state layout and access scope, never its mutable
  contents;
- the pinned runtime/provider profile and sandbox substrate profile;
- process and storage resource limits;
- the provider account/profile and approved network destinations;
- the exact project memory scope; and
- one stable remote-repository identity and its credential issuance/permission
  policy, never an issued token or expiry.

An assigned session may edit files, run builds and tests, create branches and
project-local worktrees, and perform ordinary source-control work in that
mapped repository without per-operation Deck approval. For an automated
Tasks-owned run, the pinned Tasks engine exercises the worktree-creation part
of that authority while atomically assigning the task; the hostile provider
process is not a second linked-worktree topology writer. This changes the
mechanism, not the project's granted source-control authority. That authority
never includes another local project; authenticated access to or mutation of
another remote repository; operator-global credentials; host administration;
Deck or WebAuthn state; tmux control; or a sibling session's private state or
capability. Public read-only repository access follows the declared egress
policy.

Each policy revision carries a content-free backing attestation
(`noisedeck.project-backing-attestation.v1`) that binds the exact
supervisor-attested managed backing digest to that revision, its security
domain, its policy digest, its confinement-profile digest, and a server-owned
attestation ID. The threat it closes is a hostile project or provider
substituting or widening the managed backing a revision was approved for; the
trusted measurement owner is the host supervisor outside the workload, never
provider-writable storage. Verification fails closed: a missing, malformed, or
mismatched attestation rejects the confined launch and never falls back, and
the hostile effective-state gate must observe that the substituted
backing cannot produce a valid attestation. The attestation carries no managed
view, runtime, supervisor build, path, state, secret, or expiry field.

Project setup, not an agent, writes the declared author name, email, and
`user.useConfigOnly=true` once to repository-local configuration before any
session or linked worktree starts. Linked worktrees inherit that shared
configuration. A conflict is resolved explicitly at setup; agents, reviewers,
hooks, and harnesses are not instructed to validate or mutate it. A workload
with project Git authority can still override configuration or author
environment variables. The setup value therefore stays outside the immutable
security-policy revision: it is attribution metadata, not a credential,
signature, or security boundary. Enforced authorship would require a separate
signing or broker decision.

Only an authenticated operator control surface may create or import a confined
domain or approve a policy revision. The control plane resolves and stores it
outside provider-writable storage. Terminal prose, environment variables,
project files, development-container definitions, provider settings, hooks,
setup scripts, `.git/config`, remotes, and caller-supplied paths or IDs cannot
select or widen authority. Each run binds one exact revision for its lifetime;
an edit creates a new revision for new runs and never mutates a live sandbox.
Old-revision runs and grants remain visibly bound to that still-valid revision;
creating a newer revision alone does not revoke them. If the operator requires
immediate authority removal or revokes the old revision, the supervisor
terminates those runs, closes credential refresh, and fences their grants.
Copyable external credentials are reported removed only after authoritative
remote revocation or expiry; the UI shows that pending state and `expires_at`.

Nested or overlapping host roots cannot be distinct confined domains. They
must deliberately share one domain or be materialized with independent mutable
and Git administrative backing.

A second confined-project registration that resolves to an already mapped
writable remote-repository identity or writable memory scope is rejected unless
it is deliberately registered as another view or worktree of the same managed
project backing. Otherwise the external service must enforce disjoint
namespaces and credentials that the hostile gate can prove. A label, branch
convention, local clone, or caller-supplied account name is insufficient. The
system does not merge independent local projects into one implicit domain.

The current shared-container profile remains available as an explicitly
selected and visibly labeled **unconfined** compatibility mode. It is never a
fallback and cannot use Continuity or capability-gated cross-project exchange.
Continuity is unavailable while any co-resident unconfined workload can reach
confined or control-plane authority.

### 3. One trusted supervisor enforces one immutable run policy

The provider CLI and every child it launches are treated as one hostile local
workload. A small host supervisor outside that workload selects one pinned
sandbox profile, constructs the effective filesystem/process/IPC/network/
privilege/resource boundary, and binds it to one project policy revision and one
application-session generation. Project-controlled code runs only inside that
boundary; the supervisor and exchange broker never execute it.

The application-session ID and generation form the launch idempotency key. The
supervisor, not Deck or the runner, issues the supervisor run ID and sandbox
generation after validating the protected policy, provider profile, and PTY
binding. An exact retry returns that same run identity; a conflicting reuse
fails closed and never creates a second workload. The provider-profile digest
resolves only through a version-pinned closed manifest in the trusted runtime;
the mutable host provider descriptor and caller-supplied executable, arguments,
environment, or path never select supervisor authority.

In the unconfined profile, tmux continues to launch the real provider
executable directly. In a confined profile, tmux launches a fixed trusted
runner. The runner submits only protected identifiers and the pane PTY
descriptors to the supervisor. The supervisor validates that request,
constructs the sandbox, binds the PTY, and launches exactly one real provider
executable inside it. Neither component substitutes a shell, SDK adapter, or
provider emulator. The tmux server/socket and runner control channel remain
outside the provider's mount and process views. Reconciliation and stop target
the composite runner, sandbox, provider-process, workload, and PTY identity;
the tmux pane alone is not proof of a confined workload.

The workload sees only:

- an immutable runtime;
- one managed project view;
- private, bounded home, native provider history/session state, XDG state, and
  scratch for that application session;
- admitted immutable content-addressed inputs;
- its private process/device view and assigned PTY; and
- the exact network, memory, repository, and Continuity channels in its run
  policy.

It sees no host workspace root, sibling project, operator home, Deck database,
tmux/control socket, container-runtime socket, sibling native history, global
memory scope, or operator-global Git/SSH/cloud credential. Exact native resume
reattaches only the same application's private provider state. A shared cache,
if useful, is non-secret, capability-free, and read-only or safely partitioned.

Noisefloor Deck reserves project-local `.worktrees/` for linked worktrees and
retains `.review/` for review scratch. They are convenience boundaries, not
security boundaries: linked worktrees have separate checkouts, HEADs, and
indexes but share refs, objects, configuration, and Git common state. Every
linked worktree and common directory therefore remains inside the same project
domain. New Git projects ignore these paths; imports use local exclusions
unless the operator approves a tracked ignore change. Canonical task/PRD state
is durable project data and is never blanket-ignored as scratch. A separately
qualified Tasks-owned workload may use kernel-enforced mounts to make the
pinned Tasks engine the sole linked-worktree topology writer for an automated
run. That narrow control does not turn a worktree or Docker container into a
project security domain, does not satisfy this ADR's confined profile, and
cannot enable Continuity without the complete hostile confinement and Continuity
gates.

The network boundary denies host, loopback, LAN, metadata, sibling-service, and
proxy-bypass paths. The run policy admits only the model provider,
source-control host, package registries, documentation endpoints, and project
memory scope actually required. Destination-level filtering does not claim to
understand opaque TLS methods or bodies; a typed broker is necessary only when
the policy promises such application-level restrictions. A visibly distinct
public-egress option may permit broader destinations, accepting that the agent
can disclose its assigned project while leaving local sibling/control isolation
unchanged.

Provider subscription authentication is projected through the narrowest real
CLI contract available and scrubbed from agent-launched children where the
provider supports it. Each provider profile records whether the credential is
opaque to the workload, readable only by the parent CLI, or extractable by its
children, and inventories account-wide history, cloud tasks, connected
repositories, tools, and server-side actions. Extractability and upstream
capabilities that cannot be disabled are accepted, visible subscription-profile
risks in the baseline rather than silently failed local confinement claims. The
sandbox still excludes every other operator-global credential and authority.

The mapped repository may use a direct short-lived per-run credential restricted
to one exact stable repository identity and the minimum practical contributor
permission set offered by that source-control platform. Issuance and refresh
derive from the immutable policy revision and supervisor run ID without placing
token values or expiries in that revision. The policy and UI show the effective
permission set rather than claiming that a credential can
distinguish branch push from tag/release creation or pull-request update from
merge when the platform scopes those actions together. Those same-repository
effects are inside the relaxed project domain and remain governed by remote
rules, review, and backups. Organization administration, other repositories,
deployment/cloud secrets, signing keys, and operator-global authority remain
absent. A typed broker is an optional narrower profile when exact ref or
operation restrictions matter; it retains the writable credential, enforces
only bounds it can prove, uses idempotency and expected remote state, and never
retries an uncertain effect. A direct bearer credential is copyable: stopping a
sandbox immediately ends refresh and local use but cannot erase a copy already
read. Cutover, policy removal, and teardown report its authority gone only after
authoritative remote revocation or expiry, whose status and `expires_at` remain
visible.

Project-level byte/inode quotas, per-run process/CPU/memory/output limits, and
bounded exchange storage bound the tested local exhaustion classes and preserve
control-plane capacity. They do not claim to prevent exhaustion of the shared
upstream provider subscription. Control-plane storage has reserved capacity or
a separate failure domain.

Resource limits are carried as explicit positive numbers in the closed
`noisedeck.project-policy.v1` canonical policy, never zero, defaulted, or
unlimited: process count; memory, per-run cumulative content-blind PTY output,
project, scratch, and per-revision exchange bytes; project and scratch inode
counts; a hard CPU quota/period cap; and per-device I/O read/write byte and
operation rates. Output overage terminates the run as a resource limit;
exchange bytes bound the aggregate retained immutable exchange store for one
security-domain revision, and a signed route may only lower that bound. The
policy commits numbers only — the version-pinned confinement-profile digest
commits how they map onto substrate controls, how I/O rates resolve to backing
devices (an unresolved device or a readback mismatch fails the confined launch
closed), how multiple devices coalesce, and which probes must pass.
The same policy carries an exact lowercase SHA-256 `memory_scope_digest`; shape
validation does not resolve or establish that authority.

Run capabilities are derived from the protected run record and bind its project
policy revision, supervisor run ID, and application-session generation. A
Continuity capability additionally binds its grant, role, offer where
applicable, and custody epoch. A caller-supplied ID, socket path, or bearer value
alone cannot select authority. The chosen substrate must prove that a sibling
cannot reuse a copied token, socket, or passed descriptor as the holder. An
authorized holder can still proxy another party's instruction; no local
mechanism can prove who influenced a principal that already has authority.

### 4. Crossing a project boundary uses one signed, immutable exchange

No source project is mounted into a target project. Every cross-project
artifact exchange, including an operator-mediated one-off, requires an active
ADR-0002 WebAuthn grant whose optional ordered route names the exact source and
target project-policy revisions and allowed provider profiles. A one-off is a
one-step route with successor redelegation disabled. An ordinary authenticated
click or terminal instruction cannot create this authority.

ADR-0002 owns the linear custody state machine, actor directions, total artifact
byte budget, transition idempotency, snapshot receipt, and crash behavior. This
ADR supplies the isolated source/target views and content-blind exchange store
that make those requirements enforceable. The target receives only the exact
immutable object at its generated read-only path; it receives no source mount or
path oracle.

The exchange APIs retain only identity and lifecycle metadata and carry no
semantic body. The exact bytes may appear as ordinary PTY output when a real CLI
displays its imported artifact; Deck transports that stream without identifying
it as protocol content.

The signed route is intentionally a bounded bidirectional semantic data
channel, not operator approval of later contents. Its handoff, question, and
answer objects are individually immutable and limited by signed direction,
round, and cumulative-byte bounds. The lineage UI exposes each digest, size,
direction, round, and cumulative consumption so the transfer leaves an
intentional operational trace even though Deck never interprets the bodies.

This is not a general file-copy or messaging API. Agent-facing requests carry
no arbitrary source project, target project, source path, destination path,
terminal output, or text body. Outside the exact signed route, another project
or repository requires a new operator-approved domain mapping or WebAuthn
grant.

### 5. Confinement is a measured profile, not a configuration claim

Before a profile is labeled confined, one selected modern Linux sandbox or VM
must publish a versioned conformance record that names:

- its trusted components and explicit exclusions;
- the filesystem, process/IPC, privilege, network, credential, capability, and
  resource controls that enforce the immutable run policy;
- its fail-closed launch, recovery, stop, and teardown behavior; and
- hostile tests against the effective workload, not merely its configuration.

The tests use every supported real CLI and at minimum prove:

- absolute/relative link, rename-race, Git worktree/common-dir/alternate,
  special-file, inherited-descriptor, and mount tricks cannot reach a sibling,
  host, or control object;
- sibling process, tmux, native-history, capability, copied-token/socket/
  descriptor, stale-identity, and unconfined-coexistence attacks fail;
- direct host/LAN/metadata/private-service and undeclared egress fails while
  approved provider, repository, package, documentation, and memory workflows
  work;
- every operator-global credential except the declared provider-subscription
  profile is absent; the profile's child-process extraction and upstream
  connector/action results are measured and disclosed; the mapped repository
  credential fails against every other repository; and stopping a run closes
  refresh while copied credentials remain visibly pending until remote
  revocation or expiry;
- snapshot crash points produce only an unpublished orphan or a valid durable
  receipt, never a duplicate or premature target projection;
- project quotas and process limits bound the tested local exhaustion classes
  and preserve protected control-storage capacity; and
- cancellation, supervisor restart, and teardown leave no surviving workload,
  mount, local capability, credential source/refresh channel, or control route;
  copyable credentials issued under the run policy are separately proven
  revoked or expired, while the declared provider-subscription exception remains
  disclosed.

The record must include substrate-specific probes for its kernel, namespace,
device, descriptor, socket, and storage mechanisms. Those details belong in
the profile's implementation and test specification rather than becoming new
cross-product state in the protocol.

The first confined implementation selects one substrate and one baseline
threat model. A shared-kernel profile does not claim resistance to a malicious
kernel exploit; that requires a microVM or separate host profile. No stage may
warn and continue unconfined.

The current Linux 4.4 deployment has no usable modern namespace sandbox,
Landlock, `openat2`, cgroup v2, sandbox runtime, or host supervisor available
inside the application container. It therefore fails the confined gate.
Installing a helper inside the current container is not enough; confinement
requires a modern runner or VM and a supervisor outside the agent trust domain.

### 6. Relationship to ADR-0001 and ADR-0002

ADR-0001's general rule remains: outside a valid grant, only literal text
selected and sent by a fresh operator gesture crosses sessions. Multi-send and
Relay selection remain source-free and cannot use the exchange broker.

This ADR adds one narrow content movement to ADR-0001's ADR-0002 exception: a
valid grant may cause the content-blind broker to snapshot and import each exact
immutable artifact in the signed, byte/round-bounded route. This is a bounded
semantic channel whose contents agents choose after the ceremony, not an
operator-signed document. The broker never selects semantic content, reads
terminal output, composes a message, summarizes, routes by model output, or
retries an uncertain terminal write. Claims that no semantic bytes cross
domains are scoped to Deck's local/session/exchange surfaces; the configured
provider account, mapped same-domain remote, and declared egress remain the
explicit external channels above.

ADR-0002 remains authoritative for WebAuthn activation, absolute expiry,
bounded counters, owner initiation, capacity evidence, visible real successor
sessions, explicit declarations, accept-release-and-source-termination cutover,
custody epochs, the exact one-use bootstrap, no output inference, and no
uncertain-write retry.
The grant binds the source project-policy revision plus the
optional ordered route described above. Every registered artifact becomes the
immutable stored object defined there; a cross-domain step exposes only its
generated read-only projection.

An unconfined project cannot activate ADR-0002. Outside the signed domain route,
this ADR grants no file movement, new-session authority, or remote-repository
authority.

## Consequences

- Agent delegation becomes an enforceable chain of custody rather than a prompt
  convention.
- The assigned agent may still damage or disclose its own project and mapped
  repository. This boundary is isolation, not undo, correctness, or review.
- One immutable run policy and one signed Continuity grant keep ordinary
  project work simple. Optional brokers and stronger substrates appear only
  when a named policy needs them.
- The base provider-subscription profile protects local projects and control
  authority but may not protect a shared provider credential from the assigned
  workload; that accepted risk is measured and displayed rather than hidden.
- Worktrees remain useful collision isolation and never become a security
  claim.
- Provider-native sandboxes are defense in depth. The outer profile owns the
  boundary; disabling an incompatible inner sandbox does not weaken that claim
  when the outer gate still passes, and the inner sandbox alone is never proof.
- The current all-in-one Compose deployment remains honest but unconfined and
  cannot enable Continuity.

## Alternatives rejected

- **Working-directory and path-prefix checks:** they constrain Deck APIs, not
  syscalls issued by a real CLI or its children.
- **One Unix user with `chmod`:** equivalent processes can reach shared files,
  `/proc`, sockets, credentials, and remote services.
- **Git worktrees as isolation:** linked worktrees share Git administrative
  state and accept arbitrary filesystem locations.
- **One container with the whole workspace mounted:** a sandbox cannot hide
  what is deliberately mounted into it.
- **Provider permission prompts:** provider UX is not a provider-neutral control-
  plane boundary and may fail open or be disabled.
- **A passkey without privilege separation:** cryptography cannot stop an agent
  with equivalent control-plane authority from bypassing the verifier or
  stealing a capability.
- **A transactional broker for every project action:** repository-scoped
  permissions already express the ordinary within-project boundary. Emulating
  every Git/hosting/CI semantic would add a second agent platform without
  improving the stated project-isolation guarantee.
- **Four independently mutable lease state machines:** one immutable run policy
  carries the same scoped facts with fewer revocation, race, and recovery paths.

## Primary security references

These sources demonstrate individual mechanisms, not the combined Noisefloor
Deck guarantee. Conformance depends on the measured composition above.

- [OpenAI: agent approvals and security](https://learn.chatgpt.com/docs/agent-approvals-security)
- [OpenAI: sandboxing](https://learn.chatgpt.com/docs/sandboxing)
- [Claude Code: sandboxing](https://code.claude.com/docs/en/sandboxing)
- [GitHub Codespaces: security](https://docs.github.com/en/codespaces/reference/security-in-github-codespaces)
- [GitHub Codespaces: repository access](https://docs.github.com/en/codespaces/managing-your-codespaces/managing-repository-access-for-your-codespaces)
- [GitHub Agentic Workflows: safe outputs](https://github.github.com/gh-aw/reference/safe-outputs/)
- [GitHub App installation access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- [GitHub App REST permission map](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps)
- [OpenAI Codex: Git worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees)
- [Claude Code: Git worktrees](https://code.claude.com/docs/en/worktrees)
- [Linux Landlock](https://www.kernel.org/doc/html/latest/userspace-api/landlock.html)
- [Linux `openat2(2)`](https://man7.org/linux/man-pages/man2/openat2.2.html)
- [Linux seccomp](https://man7.org/linux/man-pages/man2/seccomp.2.html)

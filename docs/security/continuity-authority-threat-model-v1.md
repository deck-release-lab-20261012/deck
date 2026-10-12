# Continuity authority threat model v1

Status: release-gate threat model  
Applies to: `noisedeck-continuity-succession-v1`  
Authority: ADR-0002 and ADR-0003

## Security objective

Continuity lets an operator-authorized owner launch and negotiate with one
visible successor, then transfer custody only after exact receiver acceptance,
source release, observed source-workload termination, and authoritative
revocation or expiry of revocable per-run credentials.

The required claim is:

> A hostile provider workload cannot create, activate, widen, replay, or bypass
> a Continuity grant; act outside its capability-bound role, project, route,
> counters, expiry, generation, or custody epoch; forge another session's
> declaration; alter a registered artifact; or cause two active owners through
> Deck's local control, broker, sandbox, or supervisor boundary.

This is an enforcement claim, not a promise that an agent behaves helpfully.
Continuity remains unavailable unless the hostile confinement and Continuity
tests described below prove the boundary using real provider CLIs.

## Assets and enforcement owners

| Asset or invariant | Enforcement owner | Failure behavior |
| --- | --- | --- |
| WebAuthn credential registry, verifier, challenge, browser session, grant store | Protected control plane and exact authorization origin | Refuse activation; no partial or fallback grant |
| One immutable signed grant and its counters/expiry | Control-plane transaction boundary | Reject stale, exhausted, widened, expired, or revoked action |
| Caller identity, role, run, generation, project policy, and custody epoch | Supervisor-issued run identity plus capability verifier | Reject before side effects; never trust request IDs as authority |
| One session/generation in at most one nonterminal grant | Grant activation and offer-admission transactions | One winner; no second offer, process, or capability |
| Linear owner and source quiescence | Control plane, serialized writer, supervisor, reconciler | Fence source writes at release; park on uncertain termination |
| Real process termination and descendants | Supervisor and observed effective process/cgroup state | Never equate pane exit or database state with workload death |
| Per-run external credential authority | Credential issuer and authoritative remote revocation/expiry evidence | Keep successor provisional until authority is proven gone |
| Artifact identity, immutability, direction, and total bytes | Content-blind artifact broker | Freeze/fail offer; never parse, repair, or silently substitute bytes |
| Project, network, memory, repository, and sibling isolation | Immutable run policy and selected confinement substrate | Fail launch/readiness closed; never fall back to unconfined |
| Offer/transfer/round budgets and idempotency | Control-plane compare-and-swap transitions | Reject exhaustion/conflict; never refund or double-consume |
| Content-free lifecycle audit | Control plane | Record actor/identity/action/outcome only; omit semantic bodies |

Configuration, labels, file permissions under an equivalent principal, a cwd,
container naming, and successful helper invocation are not enforcement owners.

## Adversaries

The baseline adversary is one confused or fully compromised provider CLI plus
every process, hook, tool, shell, and descendant it can launch inside its run.
It may issue arbitrary syscalls and protocol requests, race and replay valid or
stale requests, mutate its writable project, lie in terminal text, consume its
resources, and deliberately proxy another party's instructions.

The hostile gate also assumes attempts to:

- steal sibling capabilities, cookies, sockets, descriptors, provider state,
  terminal contents, or capacity evidence;
- reach the Deck database/binary, WebAuthn verifier, browser authorization
  endpoint, container runtime, host, tmux server, supervisor, or exchange store;
- obtain root, `sudo`, device, namespace, or equivalent host authority;
- escape through DNS, loopback, host/LAN/metadata routes, proxy bypass, remote
  repositories, provider connectors, or undeclared egress; and
- exhaust CPU, memory, processes, output, project bytes/inodes, exchange bytes,
  launch slots, clarification rounds, credentials, or control-plane storage.

The trusted computing base is the operator and authorization device/browser,
the exact HTTPS authorization origin, Deck control plane, supervisor,
reconciler, sandbox/confinement substrate, artifact broker, kernel or
hypervisor for the selected profile, database/storage, system clock source,
credential issuer, and authoritative remote services used as evidence.

## Proven and cooperative properties

When every gate passes, Deck can prove:

- the grant was activated by a valid assertion over the exact canonical policy
  and current source generation;
- each accepted control action came through the capability for the recorded
  run, generation, role, project-policy revision, offer, and custody epoch;
- limits, state transitions, artifact receipts, and ownership changes committed
  transactionally and idempotently;
- no successor was activated without exact acceptance and the required source
  termination/credential-fence evidence; and
- the selected local isolation boundary denied the tested cross-domain and
  control-plane paths.

Deck cannot prove:

- that the operator read or understood the signed policy;
- that reported quota pressure is genuine, that a candidate is economical, or
  that the owner chose well;
- that an artifact is accurate, sufficient, safe, or on-topic;
- that a receiver understood or followed the goal, or that project work is
  semantically correct;
- that a provider account or approved egress destination will not disclose or
  misuse project data intentionally sent to it;
- that already-read artifact bytes or copied provider credentials can be
  retracted; or
- safety after compromise of the trusted browser/origin, Deck daemon,
  supervisor, confinement substrate, kernel/hypervisor, storage, clock
  authority, credential issuer, or operator device.

The goal/task reference is attribution only. It does not enforce semantics.

## Threats, controls, and hostile tests

Every row is a required release test. “Control” names an enforcement mechanism,
not a policy wish.

| ID | Threat | Control and failure behavior | Requirement and hostile test |
| --- | --- | --- | --- |
| T01 | Agent activates, renews, or widens a grant | Agent APIs expose no privileged grant operation; exact-origin WebAuthn activation binds canonical policy and source generation | attempt every operation from a real hostile CLI and ordinary-login browser session; grant bytes and counters remain unchanged |
| T02 | WebAuthn replay, challenge substitution, wrong policy/origin/RP, missing UV, or enrollment downgrade | Short-lived single-use challenge, policy digest, exact origin/RP checks, UP+UV, existing-credential or local break-glass enrollment | replay and mutate each bound field and prove zero grant mutation |
| T03 | Synced passkey presented as hardware-bound proof | Record backup flags; profile selects allowed credential class and attestation requirements | synced credential passes only the standard profile and fails a hardware-bound profile |
| T04 | Provider tampers with database, binary, verifier, browser cookie, privileged socket, supervisor, or exchange store | Separate principal/host boundary and immutable run policy omit every path and control socket | real CLIs probe filesystem, process, IPC, descriptors, loopback, and browser endpoints; readiness fails on any route |
| T05 | Root, sudo, container-runtime, host, device, or kernel authority bypasses policy | Remove those authorities from the run; stronger devices require a separately attested profile | effective capabilities, namespaces, devices, mounts, seccomp/LSM state, and runtime sockets are hostile-tested, not inferred from config |
| T06 | Stolen/copied sibling capability or caller-chosen session ID acts as another agent | Supervisor-issued run binding plus capability verification of role, grant, generation, policy, offer, and epoch; request IDs are CAS assertions only | replay tokens from siblings, descendants, different sandboxes, stale epochs, and arbitrary IDs; all fail before side effects |
| T07 | One session joins two grants or two offers race | Activation and offer admission reserve uniqueness transactionally; one live offer per grant | race cross-grant activation/admission and concurrent proposals; one winner, no second process/capability |
| T08 | Spawn storm or cost/quota exhaustion | Positive immutable launch/transfer/round/byte bounds; launch slot consumed before process/bootstrap and never refunded | race failures, declines, deaths, timeouts, and retries through exhaustion; no effect after the bound |
| T09 | Agent fabricates or scrapes capacity, or reaches another session's/account's evidence | Only current owner may request allowlisted documented structured adapter output; unknown stays unknown; no terminal/provider-state parsing | inject terminal 429 text, stale/foreign records, silence, and malformed adapter output; no proposal is initiated or capacity inferred |
| T10 | Forged acceptance, reverse ownership, or wrong-role declaration | Receiver capability alone accepts/declines/questions exact offer; owner alone proposes/answers/releases | invoke every action with the opposite role, sibling, stale generation, and arbitrary session ID; zero state/artifact changes |
| T11 | Replay or idempotency-key collision repeats effects | Stable server-derived transition IDs; identical retry returns result, conflicting reuse fails | crash/replay before and after every commit; counters, process, bootstrap, objects, receipts, epochs, and cutover occur at most once |
| T12 | Digest/revision substitution, staging mutation, symlink swap, path traversal, or broker oracle | Generated rooted names, no caller path/FD, no-follow rooted open, regular-file and byte ceiling checks, immutable object/receipt | race every path component and mutate bytes before/after registration; old receipt never changes and no outside byte is read |
| T13 | Artifact body leaks into SQLite, logs, audit, APIs, telemetry, or control messages | Broker is content-blind; control schemas contain identity/lifecycle only | unique canaries appear only in staging/object/projection and ordinary PTY display |
| T14 | Cross-project or reverse-direction artifact access | Signed ordered route, role/direction checks, generated receiver projection, no source mount or exchange browser | ADR-0003; receiver probes source/sibling projects and reverses every artifact direction; only exact allowed snapshot is reachable |
| T15 | Provisional successor exercises owner authority or escapes target domain | Receiver capability exposes snapshot, generated question staging, and receiver declarations only | propose/release/owner broker calls and cross-domain probes fail before side effects |
| T16 | Split brain during accept/release/cutover races | CAS validates both generations, exact acceptance, candidate, epoch, counters, offer, and transition; source owns until cutover | concurrent accept/decline/release, service crashes, tmux reuse, and generation changes never create two owners |
| T17 | Source writes or recovers after durable release | `activating` fences serialized writer, timers, refresh, and ordinary session relaunch before supervisor termination | attempt browser input, emulator replies, bootstrap, refresh, auto-resume, and manual relaunch after release; all source writes/authority fail |
| T18 | Pane exit is mistaken for workload/descendant death | Supervisor observes the composite sandbox/cgroup/process identity; pane and database state are insufficient | detach, daemonize, double-fork, orphan, reuse tmux pane, and kill runner components; cutover waits for positive workload termination |
| T19 | Copied per-run repository/cloud credential survives source stop | Close local refresh/use, request authoritative revocation, or wait expiry; display pending external authority and `expires_at` | retain a copy in a child and prove successor cannot activate while remote authority remains valid |
| T20 | Expiry, revocation, pause, or timeout causes implicit release or CLI kill | Timers only expire/abort declarations; revocation fences authority; neither kills a CLI; pre-release owner remains | expire/revoke/pause in every state and verify the specified owner/process facts |
| T21 | Revocation/expiry during `activating` rolls back or activates incorrectly | Release is one-way; termination continues. Expiry finalizes accounting with no owner/capability; revocation prevents activation | crash at each ordering point and assert no resume, no duplicate epoch, and correct terminal lineage |
| T22 | Host clock rollback extends authority | Protected wall-clock policy detects material backward movement and fails closed across restart | move clock forward/back across issue/expiry and restart; no mutation or capability issuance extends expiry |
| T23 | Generation/tmux reuse or restored database resurrects authority | Generation change supersedes grant; restore fences installation, rotates runtime authority, invalidates credentials/grants/policies/capabilities | reuse names/IDs and restore live-state backup; no old capability becomes valid |
| T24 | Audit channel becomes transcript or leaks label/artifact content | Closed atomic audit event records IDs, role, action, transition, counters, state, outcome, time; no bodies or labels | inject unique semantic/label canaries and inspect all audit/log/telemetry sinks |
| T25 | Resource exhaustion disables control-plane fencing or audit | Per-run and project quotas plus bounded exchange; protected storage has reserve/separate failure domain | exhaust process/output/project/exchange quotas and prove revoke/fence/audit remain available or service fails closed |
| T26 | Approved provider or public egress exfiltrates assigned project | Explicit external trust boundary and visible policy exclusion; no claim beyond local boundary | UI/effective-policy evidence names the exclusion and hostile tests still deny undeclared local/sibling routes |
| T27 | Agent-supplied label impersonates identity or injects terminal/audit content | Optional signed permission, direct-lineage target, NFC/length/control/bidi validation, escaped attributed rendering; never reaches CLI/audit body | hostile Unicode/markup, ancestor/sibling target, overlength, routing, terminal, and audit probes |
| T28 | General cross-session send is smuggled through Continuity | Closed schemas permit lifecycle/artifact identity only; sole automatic bytes are exact one-use bootstrap | ADR-0001; schema/fuzz/import checks find no arbitrary body, source-output dependency, source-session selector, or automatic retry |

## Provisional project writes

A provisional successor is not globally read-only. It is a normal confined
session in its signed target-project domain and may perform whatever ordinary
project writes that immutable project policy permits. “Source remains owner”
means ownership of Continuity protocol authority, not exclusive ownership of
target-project files.

The hard gates are instead:

- imported Continuity snapshots are immutable and read-only;
- a cross-domain successor has no source-domain mount or authority;
- the successor cannot propose, answer as owner, release, cut over, or obtain an
  owner capability before activation; and
- ordinary target-project authority never widens the signed route, remote,
  memory, network, credential, or broker scope.

An installation promising read-only provisional project files would need a
separate signed policy and tested permission transition. Version 1 makes no such
claim and does not add complexity to simulate exclusivity absent from ordinary
same-project sessions.

## Operator pause, revoke, stop, and recovery

**Pause before release** stops admission of new offers and declarations and
leaves process state unchanged. It does not infer acceptance or terminate a
CLI. Resume revalidates the unchanged grant, expiry, generations, policies,
counters, epoch, and capabilities; otherwise the offer aborts or supersedes.

**Abort before release** terminally fences both offer-scoped capabilities,
leaves the source owner, and leaves both visible CLI processes unchanged. The
launch slot remains consumed. A later offer requires a new admission.

**Revoke** immediately fences the grant and all capabilities without requiring
the security key. Before release it leaves CLIs running but outside Continuity.
During `activating`, it continues the already-authorized source termination,
prevents successor activation, and ends with no owner. It never resumes source.

**Stop** is an explicit workload action, separate from Continuity state. The UI
must show requested, observed, and uncertain termination separately. Stopping a
pane does not prove provider descendants stopped; the supervisor must positively
observe the composite workload boundary. External credentials remain visibly
pending until authoritatively revoked or expired.

If the source reaches a hard provider limit before accepting/releasing:

1. silence, an error string, or loss of prompt never transfers ownership;
2. the receiver remains provisional and cannot self-promote;
3. the operator may keep or abort the existing offer, stop either workload, or
   revoke the grant;
4. if the source can still explicitly release through its capability, normal
   cutover proceeds; an operator cannot forge that agent declaration;
5. if release is impossible, the run remains with the source as recorded owner
   until the grant ends; recovery requires a new operator WebAuthn ceremony and
   a new session/generation where necessary, linked only as non-authoritative
   lineage; and
6. no recovery path imports terminal output, replays bootstrap, promotes the
   provisional receiver, or reuses residual authority.

This may sacrifice unattended progress to preserve custody. That is the
intentional failure mode.

## Accepted risks and residual requirements

| Accepted risk | Why accepted | Required visible evidence and test |
| --- | --- | --- |
| Authorized owner can waste all signed launch/round/byte budget | The operator deliberately authorized bounded use; semantic intent is not enforceable | Signed-budget counters and audit; exhaustion tests T08/T11 |
| Provider subscription service/account may observe project data and expose account-wide connectors or credentials | It is the declared upstream exception needed to run the real CLI | Provider-account and credential profile disclosure; T19/T26 |
| Agent may copy artifact bytes after reading them | A readable handoff must reach the receiver; local revocation cannot erase knowledge | Artifact policy states non-retraction; T12–T14 prove future broker access is fenced |
| Agent may write harmful or irrelevant target-project changes before cutover | Target-project authority is normal confined project authority, not ownership proof | ADR-0003 visible provisional lineage; ordinary project/remote controls plus T15 |
| Agent may proxy another party's instructions | Capabilities bind authority, not cognition or influence | Explicit limit on principal binding; T06 proves another principal cannot directly reuse the capability |
| Synced passkey may be copied by its platform ecosystem | Standard profile chooses recoverability over hardware-bound assurance | Passkey policy records backup flags; T03; hardware-bound profile available separately |
| Trusted control-plane/kernel/browser/storage compromise defeats the claim | These components enforce the boundary and are inside the declared TCB | Readiness names profile/TCB; T04/T05 plus a separately stronger profile where required |
| Hard limit before release can strand the run | Automatic promotion or inferred acceptance would create split brain | Custody rules and operator recovery procedure above; T16–T21 |

No accepted risk authorizes terminal parsing, provider-history inspection,
credential access beyond the disclosed provider profile, a generic file API, a
generic cross-session send, or a warn-and-continue confinement fallback.

## Audit event minimum

One successful or rejected mutation emits one atomic content-free event after
the authoritative transaction result is known. It contains protocol version,
installation/grant/offer/transition IDs, authenticated actor run/session/
generation/role, project-policy revision, custody epoch before/after where
applicable, action enum, artifact identity metadata where applicable, counter
deltas, declared state/outcome, and timestamp. It contains no prompt, reason,
label value, artifact body, terminal bytes, transcript, provider state, or
capacity payload.

Audit delivery does not make an uncommitted transition true. If durable audit
cannot be recorded under the selected atomicity contract, the mutation fails
closed or remains in a reconciled pending state; it is never reported as
success merely because an event was attempted.

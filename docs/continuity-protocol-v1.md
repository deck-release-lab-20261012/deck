# Continuity succession protocol v1

Status: implementation contract  
Protocol identifier: `noisedeck-continuity-succession-v1`  
Authority: ADR-0002 and ADR-0003

## Purpose and boundary

This protocol transfers custody of one operator-authorized Continuity run
between visible application sessions backed by real interactive CLIs. It is a
linear, durable ownership protocol. It is not terminal relay, a conversation
transport, provider orchestration, or an SDK-owned agent loop.

Deck carries only closed lifecycle declarations, capability-bound identity,
bounded counters, and immutable artifact metadata. Handoff, question, and
answer bodies remain project-owned files which a content-blind broker
snapshots under the signed artifact-exchange policy. No control message
contains semantic text, terminal output, a transcript, or a caller-selected
path. Readiness and acceptance are declarations by the participating CLI
sessions; Deck never infers either from output or prompt state.

This document refines, but does not weaken, the governing ADRs. Their grant,
WebAuthn, confinement, artifact-publication, credential-revocation, and restore
requirements remain prerequisites.

## Actors and durable identities

- The **operator** creates the immutable grant and may revoke it.
- The **owner** is the one capability-bound `(session_id, generation,
  custody_epoch)` allowed to propose and release.
- The **provisional successor** is the exact capability-bound candidate for one
  offer. It may clarify, accept, or decline, but cannot exercise owner actions.
- The **control plane** validates declarations and performs transactional state
  changes. It does not inspect semantic artifacts.
- The **supervisor** observes workload termination and authoritative revocation
  or expiry of revocable per-run credentials.
- The **artifact broker** roots generated staging names and publishes immutable,
  content-blind snapshots and receipts.

All IDs are server-generated lowercase UUID strings. A session identity is
always paired with a positive reconciled generation. A capability additionally
binds its role, grant, offer when applicable, and custody epoch. Caller-supplied
IDs select no authority.

## State model

An offer has exactly one of these states:

| State | Meaning | Owner |
| --- | --- | --- |
| `proposed` | The launch slot is consumed, the candidate session is visible, and the handoff snapshot is registered. Bootstrap may have one recorded outcome. | Source |
| `negotiating` | The receiver explicitly requested clarification, or the source registered the answer for the current round. | Source |
| `accepted` | The receiver accepted the exact handoff revision and digest. No further clarification is allowed. | Source |
| `activating` | The source durably released; source writes are fenced and termination/revocation is being observed. This is ADR-0002's `releasing` linearization state. | Source, until cutover |
| `active` | Cutover completed. Ordinarily a new custody epoch/capability was issued to the successor; the post-release expiry exception records the terminal successor but issues no capability. | Successor, or none after post-release expiry |
| `declined` | The receiver explicitly declined. | Source |
| `aborted` | Expiry, supersession, operator cancellation before release, or bounded timeout ended the offer. | Source unless the grant is terminal |
| `failed` | A non-recoverable launch, bootstrap, artifact, or invariant failure froze the offer. | Source |
| `superseded` | A participating session generation or immutable policy revision changed. | No protocol successor |

`declined`, `aborted`, `failed`, and `superseded` are terminal offer states.
`active` is terminal for that offer but advances the grant lineage. Only one
nonterminal offer may exist for a grant. No transition moves backward.
Entering any terminal offer state transactionally fences both offer-scoped
role capabilities. The surviving current owner may use its separately bound
grant-owner capability to propose a later offer when the grant remains active.

The allowed transitions are:

```text
admit + publish handoff -> proposed
proposed   + request_question -> negotiating
negotiating + publish_answer  -> negotiating (same round)
negotiating + request_question -> negotiating (next round, after prior answer)
proposed|negotiating + accept -> accepted
proposed|negotiating + decline -> declined
accepted + release -> activating
activating + observed termination and credential fence -> active
proposed|negotiating|accepted -> aborted|failed|superseded
activating + invariant uncertainty -> needs_attention on the grant; never rollback
```

After `activating`, expiry may only finish the already-admitted cutover with no
current owner or residual capability. Revocation continues source termination
but prevents successor activation and ends with no owner. Neither event resumes
the predecessor.

A current-owner generation change terminally supersedes the whole grant and
all its offers. A provisional-successor generation change supersedes only that
offer and leaves an otherwise valid grant with its current owner. An immutable
project-policy revision change supersedes every affected grant. No running
grant or offer rebinds to a new generation or policy revision.

## Closed control messages

Messages are JSON objects with UTF-8 encoding and no duplicate or unknown
fields. Integers are non-negative and within the signed 53-bit safe range;
generations, epochs, revisions, and round numbers are positive. Timestamps are
UTC RFC 3339 strings. Digests are lowercase `sha256:<64 hex>` strings. The
authenticated capability supplies actor identity and role; an actor field is
never accepted from the body.

Every mutating request contains:

```json
{
  "protocol": "noisedeck-continuity-succession-v1",
  "grant_id": "00000000-0000-4000-8000-000000000001",
  "offer_id": "00000000-0000-4000-8000-000000000002",
  "expected_custody_epoch": 1,
  "idempotency_key": "00000000-0000-4000-8000-000000000003"
}
```

The server derives a stable transition ID from the authenticated operation,
grant, offer, custody epoch, and idempotency key. Reusing a key with identical
canonical input returns the recorded result. Reusing it with different input is
`idempotency_conflict`. A stale epoch is `custody_fenced`.

The optional display-label action is a separate session-metadata
endpoint and is not a member of this message family. Its bounded plain text is
never protocol content, delivered CLI input, identity, or routing authority.

### Propose

The owner sends the common fields plus:

```json
{
  "candidate_profile_revision": "codex@7",
  "target_route_index": 0,
  "handoff": {
    "staging_revision": 1,
    "declared_size": 4096
  }
}
```

The staging name, source and target domains, candidate session, offer ID, and
artifact paths are server-derived. Admission consumes an offer-launch slot
before session creation or bootstrap. The operation publishes the handoff
receipt before the offer can be negotiated. `declared_size` reserves capacity;
publication records the actual size.

Admission first transactionally proves that both source and candidate
`(session_id, generation)` participate in no other nonterminal grant as owner
or provisional successor. Failure rejects the request without consuming a
launch slot or causing any process, artifact, or bootstrap side effect. The
uniqueness reservation and launch-slot consumption commit atomically; a later
launch failure does not release either the consumed slot or the offer's
reservation until that offer becomes terminal.

`target_route_index` is required only for a cross-project grant and is the
zero-based index of the exact next unused signed route stop. It is omitted for
a same-project grant, whose target is the immutable source-domain policy
revision. A skipped, repeated, out-of-order, or exhausted route index is
rejected before admission.

### Request clarification

The provisional successor sends the common fields plus:

```json
{
  "round": 1,
  "question": {
    "staging_revision": 1,
    "declared_size": 512
  }
}
```

The round must be the next allowed round, within the signed bound, and no
unanswered question may exist. The broker direction is receiver to owner.

### Answer clarification

The owner sends the common fields plus:

```json
{
  "round": 1,
  "question_digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "answer": {
    "staging_revision": 1,
    "declared_size": 1024
  }
}
```

The digest must identify the published question for that round. The broker
direction is owner to receiver. One answer is permitted per question.

### Accept or decline

The receiver accepts only the immutable handoff identity:

```json
{
  "handoff_revision": 1,
  "handoff_digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}
```

Accept is invalid while a question lacks an answer. Decline adds no reason or
other text. `no_questions` is an explicit declaration with the same handoff
identity and moves no state; it proves that acceptance did not arise from
silence.

### Release

The owner sends the common fields plus:

```json
{
  "accepted_handoff_revision": 1,
  "accepted_handoff_digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "expected_receiver_session_id": "00000000-0000-4000-8000-000000000004",
  "expected_receiver_generation": 1
}
```

Release compare-and-swaps `accepted` to `activating`, closes negotiation
timers, fences all new source writes, and records the exact cutover transition.
It does not itself claim termination or activate the receiver.

### Artifact reference and receipt

Clients receive identity metadata only:

```json
{
  "artifact_id": "00000000-0000-4000-8000-000000000005",
  "kind": "handoff",
  "direction": "owner_to_receiver",
  "round": 0,
  "revision": 1,
  "relative_path": ".noisedeck/continuity/inbox/00000000-0000-4000-8000-000000000005",
  "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "size": 4096
}
```

`relative_path` is a generated project-relative display/access path, never an
input. It is NFC-normalized, uses `/`, contains no empty, `.` or `..` segment,
no NUL or control character, and is confined beneath the role-specific
Continuity root. The broker opens every source component beneath a pre-opened
project root without following symlinks, requires a regular file, applies the
reserved size ceiling while copying, hashes the copied bytes, durably publishes
one immutable object and receipt, and then creates the read-only projection.
Acceptance binds `revision` and `digest`; a changed staging file is a new
registration, never mutation of a receipt.

## Bootstrap and waits

The grant fixes the bootstrap template version and digest. Its only variables
are grant ID, offer ID, generated artifact path, artifact digest, and revision.
The serialized tmux writer attempts the exact rendered bytes once and records
`sent`, `failed`, or `uncertain`. `failed` and `uncertain` are never retried by
reconciliation. The session remains visible and provisional for explicit
operator or agent handling.

Agent waits are bounded reads over declared protocol state. A wait accepts an
offer ID, a closed set of desired states, and a duration capped by deployment
policy and the grant expiry. Timeout returns `wait_timeout` and changes no
protocol state. Offer policy may separately cause a durable `aborted` transition
before `activating`; a wait timeout itself never implies decline, acceptance,
or readiness.

## Operator intervention

Before `activating`, the operator may explicitly abort an offer without killing
either CLI. The authenticated emergency-revocation action may terminate the
whole grant at any point and never requires an agent capability. After
`activating`, neither operator nor agent can roll custody back or resume the
source: the operator may revoke to prevent successor activation, wait for
authoritative termination and credential evidence, or abandon the run with no
owner. Resolving `needs_attention` rechecks recorded facts under the same
transition; it cannot force liveness, waive credential fencing, replace an
artifact, or manufacture acceptance. Continuing from a superseded or
ownerless terminal run requires a new application session where necessary and
a new WebAuthn grant, with only a non-authoritative lineage link.

## Cutover transaction and reconciliation

Cutover is one idempotent compare-and-swap over the recorded release transition.
It verifies:

1. the immutable grant and credential status;
2. both exact session generations and the provisional candidate;
3. the expected custody epoch and `activating` offer;
4. the accepted handoff revision/digest and bounded artifact accounting;
5. positive observed source workload termination;
6. authoritative revocation or expiry of every revocable per-run credential;
7. a remaining accepted-transfer slot; and
8. absence of a competing nonterminal grant or offer.

On ordinary success it consumes one accepted-transfer slot, advances the
custody epoch once, terminally fences predecessor and offer capabilities,
records `active`, and issues a new owner capability. Crash reconciliation
repeats the same transition ID and cannot consume twice or select new facts.

Unknown liveness, uncertain credential revocation, missing immutable objects,
or mismatched facts park the grant as `needs_attention`. Reconciliation keeps
the source fenced and never guesses, relaunches it, or activates the receiver.

## Sequence

```mermaid
sequenceDiagram
    participant A as Owner A
    participant D as Deck control plane
    participant X as Artifact broker
    participant B as Provisional B
    participant S as Supervisor
    A->>D: propose(candidate, handoff metadata)
    D->>D: consume launch slot; create proposed offer
    D->>X: snapshot generated handoff staging file
    X-->>D: immutable receipt
    D->>B: launch real CLI; one bootstrap attempt
    B->>D: request clarification(round 1, metadata)
    D->>X: publish question B to A
    A->>D: answer(round 1, question digest, metadata)
    D->>X: publish answer A to B
    B->>D: accept(exact handoff revision and digest)
    A->>D: release(exact accepted facts)
    D->>D: CAS accepted to activating; fence A
    D->>S: terminate A and revoke per-run credentials
    S-->>D: observed termination and authoritative fence
    D->>D: CAS epoch; consume transfer slot
    D-->>B: active owner capability
```

## Failure behavior

| Condition | Durable result | Forbidden behavior |
| --- | --- | --- |
| Launch budget exhausted | Reject before process/bootstrap side effects | Treat zero as unlimited or refund an old offer |
| Bootstrap `failed` or `uncertain` | Preserve visible provisional session and evidence | Automatic retry or inferred delivery |
| Handoff bytes/path fail validation | `failed`; source remains owner | Parse content, follow symlinks, or accept caller path |
| Artifact changes after registration | Old receipt remains immutable; new revision required | Mutate an accepted revision |
| Round bound exhausted | Reject question; keep current state | Add an implicit round or free-form message |
| Receiver silence or wait timeout | No inferred declaration; policy may explicitly abort | Infer acceptance, decline, or prompt state |
| Receiver declines | `declined`; launch slot stays consumed | Transfer ownership or refund the slot |
| Source generation changes before release | `superseded`; fence capabilities | Rebind the grant to the new generation |
| Expiry before `activating` | `aborted`; no new actions | Reset expiry or terminate a CLI because of expiry |
| Expiry after `activating` | Finish admitted termination/cutover accounting, then no owner/capability | Issue residual authority |
| Revocation during `activating` | Finish source termination, prevent activation, no owner | Resume source or activate receiver |
| Source termination unknown | `needs_attention`; successor stays provisional | Treat a database row as process truth |
| Credential revocation unproven | `needs_attention`; successor stays provisional | Assume teardown erased credential copies |
| Duplicate identical request | Return recorded result | Repeat side effects or charge counters twice |
| Same idempotency key, different input | `idempotency_conflict` | Choose either request |
| Concurrent accept/decline/release | One CAS winner; losers receive current state | Branch custody or overwrite declarations |
| Restore or runtime-incarnation change | Terminally invalidate grant/capabilities | Resume restored authority |

## Compatibility rules

- The protocol identifier selects one closed message family and state graph.
- Receivers reject unknown protocol identifiers, message kinds, enum values,
  and fields. They never ignore an unknown field for forward compatibility.
- A new optional field still requires a new protocol identifier because signed
  and capability-bound semantics must remain unambiguous.
- Grant, bootstrap-template, provider-profile, project-policy, artifact-broker,
  and protocol revisions are independent and exact. Compatibility is an
  allowlisted tuple proven before grant activation.
- A running grant never upgrades in place. A protocol or immutable policy
  revision change supersedes it and requires a new WebAuthn ceremony.
- A v1 owner may propose only a v1-capable receiver whose real-CLI bootstrap
  contract passed the deployment conformance gate.

## Executable conformance vectors

The machine-readable corpus is
`docs/continuity-protocol-v1-vectors.json`. A conformance runner must reject
unknown action or assertion keys and execute every case as a crash-repeatable
test. Each vector asserts database state, counter deltas, capability validity,
process evidence, artifact receipts, emitted metadata, and absence of semantic
bodies in SQLite, logs, audit, API responses, and telemetry. The table below is
the human-readable index; its IDs are exact corpus keys.

For schema version 1, `action_vocabulary` and `assertion_vocabulary` enumerate
the closed names. Every action string and every case key other than `id` and
`actions` must appear in its respective list, and every listed name must be
used by at least one case. Adding a new name requires a corpus schema-version
change. `owner` values are `source`,
`source_fenced`, `successor`, or `none`; `capability`, `grant_capability`, and
`offer_capabilities` values are `valid`, `fenced`, or `none`. Other string
values are the exact closed enums demonstrated by their assertion key; boolean
and integer assertions retain their JSON types. A runner validates this
vocabulary before executing a case and rejects duplicate case IDs.

| ID | Setup and action | Required assertion |
| --- | --- | --- |
| `V01-happy-no-questions` | Propose, declare no questions, accept exact handoff, release, observe termination/fence | One launch and one transfer consumed; epoch advances once; B alone gets owner capability |
| `V02-one-round` | Publish question and answer for round 1, then accept/release | Directions and round are exact; three immutable receipts; no body enters control state |
| `V03-round-overflow` | Grant permits one round; B requests round 2 | Rejected without artifact read, reservation, or state advance |
| `V04-stale-accept` | Register handoff revision 2; B accepts revision 1 | Rejected; source remains owner |
| `V05-concurrent-declarations` | Race accept and decline from B | Exactly one terminal/CAS result; retry returns that result |
| `V06-duplicate-propose` | Replay byte-identical propose and key across restart | One offer, process, bootstrap attempt, and launch charge |
| `V07-key-conflict` | Reuse propose key with another candidate | `idempotency_conflict`; no second side effect |
| `V08-bootstrap-uncertain` | Writer returns uncertain; restart reconciler | No retry; B remains visible/provisional; A remains owner |
| `V09-expiry-before-release` | Expire during negotiation | Offer aborts; capabilities fenced; neither CLI killed by expiry |
| `V10-expiry-after-release` | Durably enter activating, then expire | Termination completes; epoch/transfer accounting occurs once; no current owner or capability |
| `V11-revoke-after-release` | Revoke during activating | Source termination continues; B never activates; no owner remains |
| `V12-liveness-unknown` | Release, then supervisor cannot prove source death | Source writes stay fenced; grant parks; B stays provisional |
| `V13-generation-race` | Change source generation concurrent with propose or release | CAS rejects/supersedes; no capability rebind |
| `V14-artifact-symlink-race` | Replace a generated staging component while broker opens it | Registration fails or snapshots only the rooted regular file; no escape/read leak |
| `V15-publication-crash` | Crash before and after each object/receipt/projection durability boundary | Retry publishes at most one receipt/object and never exposes an unreceipted projection |
| `V16-byte-race` | Concurrent registrations approach total byte cap | Reservations prevent oversubscription; actual bytes charged once |
| `V17-missing-object` | Remove/corrupt an object referenced by a published receipt | Offer freezes and never cuts over |
| `V18-two-live-offers` | Concurrent owner proposals | One admission wins; losing path launches nothing |
| `V19-cross-domain` | Route A to B with exact policies, then attempt sibling C access | Only brokered snapshot appears in B; C and source domain remain unreachable |
| `V20-capability-direction` | B calls owner release/propose; A calls receiver question/accept | Every wrong-role action is rejected before side effects |
| `V21-content-canary` | Put unique canaries in all semantic artifacts | Canaries appear only in immutable objects/projections and ordinary PTY display, never control surfaces |
| `V22-restore-fence` | Restore a backup containing a live grant | New runtime incarnation invalidates all grant, credential, policy, and capability authority |
| `V23-uncertain-credential` | Workload is dead but remote revocation is not authoritative | No activation until revocation or expiry is proved |
| `V24-cutover-replay` | Crash after each cutover write and replay transition | Transfer decremented and epoch advanced exactly once |
| `V25-cross-grant-uniqueness` | Propose a candidate already participating in another nonterminal grant | Reject atomically before slot, process, artifact, or bootstrap effects |
| `V26-terminal-capability-fence` | Enter each declined, aborted, failed, and superseded terminal state | Both offer-scoped role capabilities are fenced in the same transaction |

Real-CLI acceptance additionally runs `V01`, `V08`, `V09`, `V10`, `V12`, and
`V13` for every eligible provider profile under the hostile confined-project
gate. Fakes are not release evidence for process continuity, terminal-write
outcomes, credential revocation, or isolation.

## Prior-art disposition

- Temporal Continue-As-New informs durable event histories and idempotent
  replay, but this protocol does not move execution into a workflow engine or
  let replay repeat external CLI side effects.
- A2A task negotiation informs explicit submitted/working/completed-style
  declarations and durable task identity, but its message and artifact bodies
  are intentionally absent from Deck's control plane.
- MCP task and elicitation semantics inform bounded request/response lifecycles,
  but no MCP server becomes the agent loop, judges semantic adequacy, or gains
  terminal authority.

These are vocabulary and failure-model references only. The authority remains
with real CLI processes, tmux/process observation, the protected control plane,
the signed grant, and the immutable artifact broker.

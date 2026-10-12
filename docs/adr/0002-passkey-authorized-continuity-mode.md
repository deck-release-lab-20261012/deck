# ADR-0002: Passkey-authorized continuity mode

- Status: Accepted
- Date: 2026-08-08
- Decision owner: Operator
- Amends: ADR-0001 decisions 1 through 3 and their corresponding
  consequences, only as described below
- Further amended by: ADR-0003, which makes confined project domains a
  prerequisite and adds one immutable cross-domain artifact exchange

## Context

Long-horizon work can outlive a Claude, Codex, Kimi, OpenCode, or other
subscription allowance window. The current manual practice is for the owning
agent to write a handoff artifact, for the operator to start another real CLI
session, and for that successor to continue. Hidden provider subagents and
in-runtime SDK handoffs are not substitutes: the operator needs to see which
real session owns the work and whether a transfer was accepted.

ADR-0001 deliberately forbids automatic cross-session text transport. It
requires a fresh operator gesture for each Multi-send or Relay selection and
assigns general agent-to-agent conversation to the Room vertical. Its literal
wording also forbids a standing authorization, a receiver bootstrap, stored
lineage, and bounded agent-to-agent clarification. An operator instruction
such as "run overnight and use the succession protocol" is explicit intent,
but Noisefloor Deck cannot treat that terminal prose as machine-verifiable
authorization without interpreting terminal input or provider state.

The desired capability is narrower than general conversation. It transfers
ownership of one operator-scoped continuity run through a linear chain of
visible real CLI sessions. Noisefloor Deck owns only authorization, lifecycle,
artifact identity, and lineage. The participating CLIs own all semantic
reasoning and write or read the handoff material as ordinary project files.

The operator also requires a stronger property than policy compliance: an
agent must not be able to manufacture or bypass the authorization. WebAuthn
can prove that an enrolled passkey or security key produced an assertion bound
to an exact grant with user presence and verification, but only if provider
CLIs cannot alter the verifier, credential registry, control database, or
privileged control channel. The current same-Unix-user trust boundary is
therefore insufficient for this mode.

## Decision

### 1. Continuity is a separate, default-off lifecycle mode

Continuity mode is a bounded ownership-transfer protocol, not Multi-send,
Relay selection, a Room, provider-internal delegation, transcript transport,
or arbitrary agent-to-agent messaging. It is off for every ordinary session.

The operator may tell the current agent what to do in the terminal, but that
text does not enable the mode. Activation requires a separate WebAuthn
ceremony in a trusted Noisefloor Deck authorization surface while the operator
controls a reconciled source application session. Agent-facing tools cannot
create, activate, extend, widen, renew, or resurrect a continuity grant.
Every cross-project artifact exchange must be covered by an active grant
created through this ceremony. An operator-mediated one-off is a grant with one
exact route step and successor redelegation disabled; an
ordinary authenticated click or terminal instruction cannot substitute for the
assertion.

### 2. A WebAuthn assertion signs one exact, bounded grant

Before the ceremony, Noisefloor Deck renders the complete proposed policy to
the operator and deterministically serializes it. Version 1 uses RFC 8785 JSON
Canonicalization Scheme over one closed `continuity-grant-v1` schema. Unknown
or duplicate fields, floating-point values, unsafe-range integers, invalid
Unicode, and non-canonical bytes are rejected. Times are UTC RFC 3339 strings;
IDs and digests use their schema-defined ASCII encodings; array order is
semantic. The browser renders every field and the resulting digest from the
same pending policy bytes that the verifier later binds, independently hashes
those bytes, and refuses a digest mismatch. The server canonicalizer plus the
browser parser/renderer/hash path must pass shared golden byte/digest/display
vectors before the ceremony can ship. The policy contains exactly:

- protocol purpose and version, installation ID, operator ID, and grant ID;
- source application session ID and reconciled generation;
- source project security-domain ID and immutable policy revision;
- allowed provider-profile revisions and an optional ordered cross-project
  route whose stops name exact target policy revisions and allowed profiles;
- an opaque operator-visible goal reference or canonical task ID for
  attribution, not semantic enforcement;
- positive maximum offer launches, accepted transfers, clarification rounds,
  and total semantic-artifact bytes, where zero never means unlimited;
- whether an accepted successor may redelegate to a later successor; branching
  within one grant is forbidden initially;
- whether the owner may set bounded display labels on itself and its direct
  provisional successor;
- the approved receiver-bootstrap template version and digest; and
- issuance time and absolute expiry, whose interval cannot exceed the
  deployment's configured maximum grant duration.

The review surface states plainly that accepted cutover terminates the
releasing source workload before it activates the successor. That behavior is
part of the signed protocol version, not an agent-selected option.

The challenge binds a fresh random nonce to the complete policy digest using
this domain-separated construction:

```text
policy_digest = SHA-256("noisedeck-continuity-grant-v1\0" || canonical_policy)
challenge = random_32_bytes || policy_digest
```

The pending challenge is short-lived and single-use. Any policy edit creates a
new challenge and ceremony. Verification requires the exact expected type,
challenge, HTTPS origin, relying-party ID hash, enrolled credential, signature,
and both user-presence and user-verification flags. Cross-origin assertions are
rejected. An identical network retry may return the already-created grant but
must not create another grant or reset any counter.

Registering an additional credential requires an assertion from an existing
enrolled credential or a local break-glass ceremony unavailable to provider
CLIs; ordinary login is not a downgrade path. The operator should enroll at
least two credentials before relying on the mode. A hardware-bound profile may
add verified attestation and reject backup-eligible credentials, while the
standard profile may accept a synced passkey and records its backup flags.

A requested duration such as eight hours becomes one signed absolute expiry
for the entire lineage. A handoff does not restart or extend it. The server
checks expiry on every continuity action and fails closed on material clock
rollback. At expiry, pending negotiations abort and no new proposal,
acceptance, release, or capability issuance is allowed. A `releasing`
transition durably admitted before expiry is already past its one-way
linearization point: §6 may finish termination and record the accepted
terminal successor after expiry, but the grant becomes terminal with no current
owner and issues no usable residual Continuity capability. Expiry itself does
not kill a CLI; any source termination in that case was separately authorized
by the pre-expiry release.

### 3. Signed trust passes through the bounded lineage

The verified assertion and immutable grant remain in the protected Deck
control plane; they are never given to an agent. The current owner receives
only a narrow, launch-bound capability tied to the grant, application session,
generation, role, and custody epoch.

Before any provisional process or bootstrap write is attempted, admission of
a new offer atomically and irreversibly consumes one signed offer-launch slot.
A declined, failed, uncertain, timed-out, or dead offer is not refunded. An
idempotent retry of the same offer returns its recorded result without
consuming another slot, and only one live offer may exist for the run.

Exactly one accepted successor may receive the residual authority. After §6's
durable release and observed source termination, cutover atomically increments
the custody epoch, decrements the separate signed accepted-transfer budget,
fences the predecessor and competing offers, and issues a fresh capability to
the accepted successor. Only when successor
redelegation is enabled may that successor later transfer to another allowed
candidate under the same original grant, expiry, route, and remaining counters.
No agent can broaden, clone, renew, branch, or reset the grant. Widening scope,
extending time, un-revoking a run, or exhausting a positive bound requires a
new WebAuthn ceremony.

One application session/generation may participate in at most one nonterminal
Continuity grant, whether as owner or provisional successor. Activation and
offer admission enforce that uniqueness transactionally. Separate operator-
authorized workflows require separate application sessions; a second signed
grant never shares a workload that another grant may terminate.

The operator signs once for the bounded transitive lineage, not once per hop.
Every cutover re-proves that the next edge and all residual authority remain
inside that exact signed envelope; it never delegates the passkey, assertion,
or signing power itself. A hop outside the signed route or bounds requires a
new operator ceremony.

A generation change terminally supersedes the old grant and invalidates its
capability. Version 1 has no capability rotation or residual-grant
reauthorization: continuing from the recovered session requires a brand-new
WebAuthn grant, with only a non-authoritative lineage link to the superseded
grant. It never replays a prompt or bootstrap.

An authenticated operator may revoke immediately without the security key so
loss of the key cannot prevent emergency shutdown of the mode. Revocation
marks the grant terminal, increments the custody epoch, and invalidates pending
challenges, offers, and agent capabilities. It does not kill a CLI. Removing an
enrolled credential revokes every live grant authorized by it. Revocation wins
over an unfinished `releasing` cutover: the already authorized source
termination is not undone and continues idempotently without new authorization,
but the provisional successor never receives ownership or a Continuity
capability. The grant ends with no current owner, the successor remains visible
as a non-owner session, and the run visibly parks for operator attention.
Revocation itself is not the cause of that termination; the source's earlier
release is.

A supported database restore is deliberately not Continuity- or confined-
authority-preserving. Before opening restored state for normal service, the
trusted restore command enters maintenance and fences every workload and
privileged run channel in the installation's supervisor/tmux namespace,
including post-backup runs absent from the restored rows. It then rotates the
protected runtime-incarnation/capability secret kept outside the backup, closes
credential issuance/refresh, and proves every revocable per-run credential
revoked or waits the configured maximum token lifetime. It stamps the restored
database with the new incarnation, invalidates all pending
challenges, grants, offers, and agent capabilities, and disables all restored
WebAuthn credentials and confined project-policy revisions pending local
credential re-enrollment and operator re-attestation. No mapped-remote
credential may be issued from a restored policy before that approval. Snapshot
receipts may be reconciled for retention, but restored counters, epochs,
revocations, credential enrollment, or project authority never become live
implicitly. The trusted host/control-plane operator and storage remain inside
the baseline threat model; arbitrary manual database replacement is unsupported
and the product does not claim to detect every same-incarnation rollback.

### 4. The owner initiates; Noisefloor Deck does not infer

Only the current owner may propose a successor, and only while its signed
grant is active. Noisefloor Deck does not decide that an agent is near a
limit, rank models, maintain a provider model catalog, react to terminal
output, or initiate from a timer. The owner may explicitly inspect documented,
provider-supported structured capacity evidence and choose an allowed
candidate. Missing or stale evidence is `unknown`, not estimated from terminal
text or token counts.

Timers may expire grants and offers or record a negotiation timeout. They may
not initiate a transfer, select a candidate, inject semantic content, or retry
an uncertain write. Entering `releasing` closes every offer/negotiation timer;
no later timeout can change the offer facts. Emergency revocation remains the
only post-release protocol transition that may prevent successor activation;
expiry has the terminal finalization described above.

### 5. Semantic content moves through immutable artifacts

The state machine permits one handoff artifact and at most one question/answer
pair per clarification round. Each agent creates only the artifact allowed by
its role at a generated staging name; it supplies neither an arbitrary path nor
a file descriptor. Registration validates the actor capability, custody epoch,
state transition, route, expiry, and remaining total-byte budget under one
server-derived transition ID. Before reading bytes, one control transaction
records the transition as pending and reserves its rooted file-size ceiling
against the remaining byte budget. Publication charges the actual durable size
and releases unused reservation; crash reconciliation either returns that one
recorded result or records failure and releases a reservation only after
proving no receiver projection became visible. Concurrent or retried
registrations cannot oversubscribe the signed budget.

A content-blind broker copies the rooted regular file into one opaque immutable
object and exposes the receiver's generated read-only path only after both
object and receipt are durable. The receipt stores the grant, offer, actor-
capability and transition IDs plus object digest and size; immutable grant and
offer records supply the route and role. A retry of the transition ID returns
that result and never stores or charges a second copy. Startup removes an
unpublished orphan and freezes an offer whose published receipt lacks its exact
object. The staging file may later change, but the registered revision cannot.
Neither project is mounted into the other.

No Continuity control API returns the semantic body; SQLite, audit, logs, APIs,
and telemetry do not contain, parse, compose, summarize, serve, or deliberately
render it. The exact bytes may appear as ordinary PTY output if a native CLI
displays the read-only snapshot. If this outcome cannot be enforced, Continuity
remains unavailable. Substrate-specific rooted-open and crash-ordering mechanics
belong to the selected storage conformance specification.

Agent control actions contain declarations and artifact metadata only. There
is no arbitrary-text, last-message, transcript, source-output, question-body,
or answer-body parameter. Readiness, acceptance, and satisfaction are explicit
agent declarations, never conclusions derived from terminal output.

The operator does not sign later artifact contents. By authorizing a route,
round bound, and total-byte bound, the operator authorizes a bounded
bidirectional semantic data channel composed of individually immutable
handoff, question, and answer objects. Each object's direction, round, digest,
size, and cumulative budget consumption is an intentional lineage trace in the
UI. “Content-blind” describes Deck's handling, not operator review of each
future body.

The sole optional text-bearing agent action is lineage display naming when the
signed grant expressly permits it. The current owner may set a plain-text label
only on itself or its direct provisional successor. After NFC normalization,
the label is limited to 80 Unicode scalar values and rejects control and
bidirectional-override characters. It is escaped on every render and every
surface attributes it as agent-supplied, visually distinct from
Deck-authoritative identity, lineage, protocol state, and process facts. The
label is operator-visible session metadata, never delivered to a CLI or used
as identity, routing, protocol content, or an audit body. The audit records
actor, target, action, and outcome without copying the label; the session
record intentionally stores the current display value.

### 6. A successor is visible before it can own the run

A valid proposal launches one normal Noisefloor Deck application session with
its own real provider executable, tmux identity tuple, generation, and visible
provisional lineage row. Provider-internal subagents remain folded away and
are never discovered by inspecting provider state.

Before cutover, the provisional successor is a normal isolated application
session in its signed target project. When target and source differ, it has no
source-domain access. Its Continuity capability exposes only the exact imported
snapshot, generated clarification staging path, and receiver declarations; it
cannot propose a successor, release the owner, or exercise owner authority.
"Source remains owner" identifies protocol authority, not exclusive ownership
of target-project files. The protocol does not add a read-only remount or a
second project-permission transition at cutover merely to simulate exclusivity
that other authorized project sessions do not have.

The only automatic terminal input authorized by the grant is one rendering of
the signed receiver-bootstrap template. Interpolation is restricted to the
grant, offer, artifact path, digest, and revision fields defined by the
template. The rendered bytes must match the approved template contract, use
the serialized fenced tmux writer, and retain the sent/failed/uncertain
delivery outcomes. Failure or uncertainty is never automatically retried. A
provider is ineligible unless a documented and conformance-tested bootstrap
preserves its real interactive CLI and native session contract.

For an ownership offer A to B, only current owner A may register handoff and
answer artifacts A to B and release; only that offer's exact provisional
successor B may register bounded question artifacts B to A and accept or
decline the exact handoff revision and digest. The reverse clarification
direction authorizes no reverse ownership, successor proposal, or release.
Terminal offer state or cutover fences both role capabilities. The source
remains owner until the receiver has accepted and the source explicitly
releases. Release durably enters `releasing` and authorizes the supervisor to
terminate the source workload, close its refresh channels, and revoke every
revocable per-run external credential, including its mapped-repository
credential. Entering `releasing` immediately rejects every new terminal write
to the source, cancels offer/negotiation timers, and makes it ineligible for
automatic resume or relaunch. Only observed workload termination and
authoritative remote revocation or expiry of those credentials permit the
compare-and-swap to validate both generations, grant status, custody epoch,
candidate, artifact identity, round bounds, offer state, and transition ID;
advance the custody epoch; and activate the successor. The declared shared
provider-subscription credential is the explicit upstream exception: Deck stops
the local CLI and refresh path but cannot retract a copy already read or
provider-side authority disclosed by its profile.

Reconciliation treats `releasing` as a durable cutover intent, never as a dead
session to recover. It idempotently requests source termination and completes
the same transition only when termination is positively observed and its
recorded generations, candidate, artifact, offer, transition ID, and custody
epoch are unchanged. Expiry after durable release does not invalidate those
facts: finalization advances the fence, records B as the terminal successor,
and leaves the grant expired with no current owner or usable residual
capability. Revocation does invalidate them and parks the run without an owner
after source termination. Unknown liveness, unexpired revocable per-run
credential authority, or any other changed/invalid fact also parks the run with
the successor still provisional; it never resumes the predecessor or activates the
successor by guess. This rule covers a Deck restart after release, during
termination, or after observed termination but before the custody transaction
commits. The predecessor's terminal trace remains visible through tmux
`remain-on-exit`, but a live source workload never coexists with an active
successor owner.

### 7. The verifier is outside the agent trust domain

Continuity mode must refuse to enable until deployment evidence proves all of
the following:

- the WebAuthn verifier, credential registry, grant store, browser session
  secrets, and privileged control channel are not readable or writable by any
  provider CLI;
- provider sessions cannot replace the Deck binary, edit authorization state,
  control sibling tmux sessions, steal a sibling capability, or reach browser
  authorization endpoints with operator credentials;
- through Deck's local filesystem, process, IPC, broker, and control boundary,
  provider sessions cannot access another project domain, an operator-global
  credential or memory scope, undeclared network egress, the protected exchange
  store, authenticated access to or mutation of another remote repository, or
  an optional broker outside their immutable project run policy; public
  read-only repository access follows the declared egress policy;
- agent capabilities are isolated by a mechanism stronger than a caller-
  supplied session ID and are bound to reconciled process identity; and
- root, `sudo`, host administration, the container runtime control socket, or
  equivalent authority is absent from provider sessions.

This requires the complete ADR-0003 confined-project profile: a separate
operating-system security principal, sandbox, host, or equivalent isolation
boundary for the control plane and each provider run, plus one immutable run
policy binding files, processes, IPC, network, provider state, memory, and the
mapped remote repository. Merely changing database permissions while all
processes retain equivalent host authority is not sufficient. The configured
provider service, subscription account, and authentication path remain the
explicit upstream trust boundary described by ADR-0003; Continuity makes no
claim that they cannot observe the projects intentionally sent to them.

The guarantee is precise: an agent cannot create or widen a valid grant or
bypass its enforced limits. An authorized owner can still exercise every
protocol action the operator signed. The goal/task reference records intent and
attribution; it does not constrain ordinary project work or prove semantic
relevance. WebAuthn does not prove that the operator read the policy, that quota
pressure was genuine, that a receiver understood or followed the stated goal,
or that a compromised browser, authorization origin, operating system, or Deck
daemon is safe.

### 8. Relationship to ADR-0001

This ADR partially supersedes ADR-0001 rather than claiming the old universal
wording already permitted continuity:

- General multi-session text movement remains limited to Multi-send and Relay
  selection with a fresh operator gesture per send.
- General agent-to-agent conversation remains in the Room vertical.
- A valid signed continuity grant is a second, disjoint exception for bounded
  lifecycle succession. Its standing authorization replaces per-edge operator
  gestures only inside the signed lineage, duration, and counters.
- ADR-0001's bans on output-derived routing, Deck-authored summaries,
  automatic retry, provider-output parsing, and generic auto-relay remain.
- Relay and Multi-send schemas remain source-free. Continuity uses separate
  endpoints that derive the caller from a protected capability; no caller may
  nominate an arbitrary source session.
- The existing zero-write test is amended only for the one exact, signed
  receiver bootstrap. Continuity code must not import session-output access.
- This ADR defines one separate content-blind movement, while ADR-0003 supplies
  its confined project substrate: the broker may snapshot and import only the
  exact immutable artifact authorized by the grant transition and receipt. It
  is not a text send, output-derived route, project mount, or general file API.

Outside an active, valid grant, ADR-0001 applies unchanged. "Relay last
response," arbitrary auto-relay, and use of continuity as a generic messaging
channel remain design-stop signals.

## Prior art and the missing composition

The examined systems provide useful individual mechanisms, but none documents
the complete sequence of proactive consumer-subscription limit awareness,
durable bilateral acceptance, a new operator-visible real CLI session, linear
ownership cutover, and predecessor retirement:

- [Temporal Continue-As-New](https://docs.temporal.io/workflow-execution/continue-as-new)
  provides durable linked executions and a fresh run under one workflow
  identity, but not model/subscription selection or terminal-session custody.
- [A2A tasks](https://a2a-protocol.org/dev/specification/) and the
  [task lifecycle](https://a2a-protocol.org/dev/topics/life-of-a-task/) provide
  discovery, state, artifacts, and pre-task negotiation, but treat the remote
  agent as opaque and do not define source retirement or a visible local CLI.
- [OpenClaw sessions](https://docs.openclaw.ai/concepts/session-tool),
  [subagents](https://docs.openclaw.ai/tools/subagents), and
  [model failover](https://docs.openclaw.ai/concepts/model-failover) provide
  visible spawned sessions, bounded agent-to-agent rounds, and reactive
  fallback as separate primitives, without a signed handoff artifact/cutover
  contract or proactive subscription-window trigger.
- [Claude Code status lines](https://code.claude.com/docs/en/statusline) expose
  subscription-window usage, and
  [agent teams](https://code.claude.com/docs/en/agent-teams) expose named peers
  and shutdown coordination, but teammates consume the same subscription
  authority and do not carry a cross-provider signed lineage.
- [OpenAI Agents SDK handoffs](https://openai.github.io/openai-agents-python/handoffs/)
  transfer control and provide traces inside one SDK-owned run; they do not
  create a separately accepted native CLI process or consumer-subscription
  succession chain.

The design therefore borrows durable lineage, explicit task states, visible
peers, and bounded negotiation while defining the missing operational custody
contract narrowly rather than importing any one framework.

## Consequences

- The operator gets an intentional, visible chain of custody across real CLI
  subscriptions without approving every edge separately.
- Trust is transitive only within an immutable signed envelope. Every
  successor receives less residual authority, never signing authority.
- Passkeys and FIDO2 security keys such as a YubiKey can authorize the same
  grant. A hardware-bound deployment may additionally require trusted
  attestation and a non-backup-eligible credential; ordinary synced passkeys
  provide a different recovery and device-sharing profile.
- Signature counters are advisory clone signals, not replay protection.
  One-time challenges, immutable grant IDs, epochs, and transactional state
  provide replay protection.
- Automatic provider-native recovery terminally supersedes the generation-bound
  grant because version 1 does not rotate or reauthorize residual authority. An
  unattended owner crash may therefore require a brand-new WebAuthn grant even
  when ordinary recovery restores its CLI session.
- Supported backup restore intentionally invalidates Continuity and WebAuthn
  enrollment rather than risking rollback of revocation, counters, or custody.
- High-assurance continuity cannot ship on the current shared-principal trust
  boundary. Privilege separation and hostile-agent validation are release
  gates, not later hardening.
- The Room remains the home for general multi-agent conversation. Continuity
  records operational lineage—who owns one run—not a transcript.

## Primary security references

- [WebAuthn Level 3: cryptographic challenges](https://www.w3.org/TR/webauthn-3/#sctn-cryptographic-challenges)
- [WebAuthn Level 3: verifying an authentication assertion](https://www.w3.org/TR/webauthn-3/#sctn-verifying-assertion)
- [WebAuthn Level 3: signature counters](https://www.w3.org/TR/webauthn-3/#sctn-sign-counter)
- [RFC 8785: JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785)
- [Yubico: user presence versus user verification](https://developers.yubico.com/WebAuthn/WebAuthn_Developer_Guide/User_Presence_vs_User_Verification.html)
- [Yubico: high-assurance passkey relying parties](https://developers.yubico.com/Passkeys/Passkey_relying_party_implementation_guidance/High_assurance_passkey_relying_party.html)

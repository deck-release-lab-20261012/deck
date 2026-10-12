# ADR-0005: Provider-owned session reconciliation

- Status: Accepted (amended 2026-08-24: sessions are ephemeral and
  restorable, so unverifiable rows stay listed and selectable with a
  wordless attention mark and present a passive recovery surface; only the
  terminal mount keeps the verified-attachable gate)
- Date: 2026-08-14
- Decision owner: Operator
- Supersedes: the 2026-08-13 intermediate form of this ADR — the
  `needs_attention` absorbing workflow, the Check again / Remove from Deck
  dead-end surface, the indefinite automatic retry series, and the death-proof
  gate that withheld a successor while old liveness was merely unverifiable —
  plus the 2026-08-14 passive-status/manual-retry presentation contract.
  The `needs_attention` database value is a frozen legacy input that new
  reconciliation code never writes; it is no longer a product workflow, UI
  surface, or reconciliation state.

## Context

Deck must not present a database row as runtime reality. A pane name, PID, or
command line can be reused, so attaching, writing, or signalling without the
complete recorded identity can target unrelated work. That threat and its
enforcement — the complete-identity preflight for attach, write, stop, and
record-removing deletion — remain real and unchanged.

**Superseded 2026-08-28 (write only).** The write path no longer repeats the
session-row and process-identity reconciliation on every input frame. It keeps
the controller and generation fences, then reads the attached pane's own
`pane_dead` and `pane_in_mode` state before writing. Attach, stop, and deletion
retain their complete-identity preflights.

The earlier product coupled that safety boundary to a durable dead-end
workflow. A row whose liveness could not be positively disproved was parked,
given a Check again / Remove from Deck surface, and recovered only after a
positive death proof. Three defects followed from that coupling: recovery was
withheld whenever liveness was merely unverifiable, the recovery loop ran
indefinitely, and the operator was trapped in a remediation surface that
Deck itself was supposed to fix. None of those is a safety property; all three
are removed here without weakening identity preflight.

**Superseded 2026-08-28 (write only).** Removing the dead-end workflow did not
weaken the attach, stop, or deletion identity preflights. Per-write complete
identity reconciliation was later removed as unsupported second-writer
ceremony; the pane-state checks required for an honest write outcome remain.

The deployment still has two distinct restart shapes. Restarting only the Go
service preserves the tmux server and provider processes. Replacing the
co-located application container removes that container's tmux server and
provider processes while preserving SQLite. A host boot ID alone does not
prove which shape occurred, so Deck never manufactures a death proof from
deployment intent — and under this decision it no longer needs one to act.

## Decision

### Opaque identity, not a lock

A native session ID is opaque documented argv handed to the provider CLI on
resume. It is never an ownership, exclusivity, or concurrency key. Native-ID
concurrency never blocks a launch: a fresh or resume argv may be issued even
when the same native ID is concurrently live, because the provider CLI owns
native-session concurrency and Deck never adopts, writes to, or signals the
old runtime. The complete runtime identity tuple still gates every
controlling side effect; the native ID merely selects argv, never authority.

### Attach the exact pane, else one successor per lost generation

Reconciliation observes each row and either attaches the exact current pane
— the complete recorded identity matches a live pane — or treats the recorded
generation as lost. A generation is lost when its recorded identity no longer
resolves to that exact live pane. One lost verified-live committed generation
consumes exactly one durable automatic successor attempt, regardless of old
local liveness. Old liveness never gates the successor, because the successor
touches no old runtime; it is a fresh generation and process. The provider CLI
decides what that one attempt does — native resume, fresh relaunch, or
rejection — and Deck records the outcome passively.

### One automatic opportunity, never reopened

The automatic successor attempt is persisted and consumed before any spawn or
fencing side effect. It is never reopened by a periodic sweep, a service
restart, a redeploy, unchanged evidence, or a failed candidate. Only a later
verified-live committed generation that is subsequently lost creates another
automatic opportunity. A generation that never reached verified-live
commitment — for example a launch whose pane died before it could publish an
identity tuple — never creates one, because nothing verified was lost. A
launch whose eager identity hook stayed silent is not one of these: the live
pane commits as running with a pending native ID, so it is resumable-later,
not lost.

The process-wide installation lock supplies cross-process exclusion. The only
new persisted recovery coordination is one row-local successor slot containing
the candidate generation and marker, optionally bound to one durable capture
grant. A row-local in-process gate is held from admission through the observed
outcome. There is no recovery executor, manual nonce, replay response,
cleanup-token protocol, stale-owner takeover, or second candidate.

### Durable native identity capture

For retrieved identity, Deck commits a hash-only expiring capture grant before
spawn. The grant binds the row, provider, generation, identity marker,
canonical work directory, expected structured-hook source, and when required
the expected native ID. The raw bearer is never stored. Acceptance validates
the provider-declared structured event and stores the opaque native ID while
consuming the grant in one SQLite transaction. An identical replay after a
lost response is idempotent; a conflicting replay fails closed. A service
restart preserves pending grants, and hook delivery retries only transport and
5xx failures within one fixed deadline using the exact body and bearer.

Capture mechanisms are an ordered provider declaration: assigned-at-launch,
documented structured native hook/plugin, a future host-attested zero-argument
tool, or documented provider API. Every mechanism converges on the same
row-and-generation CAS. Deck never parses transcripts, terminal output, or
provider state stores and never accepts a model-supplied ID. A future
cooperative tool is eligible only when its provider exposes the native ID and
Deck can mechanically validate provenance; no current provider is described as
having such host attestation.

For a CLI that may silently turn an unknown resume ID into a fresh session,
the provider's documented hook/adapter must attest the expected resume source
and exact opaque ID before the provisional candidate may commit. A mismatch is
made terminal before cleanup; restart may retry cleanup only against the exact
candidate tuple and can never publish or adopt it.

### No later recovery surface

Once the automatic opportunity is consumed, Deck does not offer a manual
Resume, Relaunch, Check again, or second attempt. A failed, exited, mismatched,
or unverifiable candidate remains diagnostic database state; its session row
stays listed with the wordless attention mark and presents the passive
recovery surface, and no terminal mounts for it.

### Zero old-runtime effects

No side effect reaches an old, foreign, or unverified runtime: no input,
signal, attach/write, output import, broker action, identity-tuple mutation,
adoption, or kill. Exactly one local committed controller acts, and only
against the exact current identity it committed. The old runtime, if any
survives, is left entirely alone; the provider CLI owns its own concurrency.

### Only verified panes mount terminals

A terminal mounts only for a row whose exact current pane is verified
attachable. An unverifiable or detached row stays listed and selectable: its
only row chrome is a wordless attention mark, and selecting it shows the
passive recovery surface — no visible Running, Recovering, Deck
attachment unavailable, Ended, or Inactive badge; no Check again or manual
Resume/Relaunch action; no blank error pane. Ended and inactive rows are the
ones omitted from the sidebar, and a stale browser selection is cleared only
when its row leaves the list. Detached and terminal rows remain diagnostic
state and may be retired through ordinary durable deletion. Deck never
claims an unverifiable provider process died.

### Legacy convergence before first response

Rows already persisted as `needs_attention` by an earlier release are a frozen
legacy input that new reconciliation code never writes. They converge to this
contract in place before the first response after upgrade: no database
deletion, no project removal and re-addition, no manual row repair, and no
released-migration edit. Each such row receives one of three outcomes — an
exact-pane attach when the complete recorded identity still matches a live
pane; exactly one automatic successor attempt when its prior committed
generation qualifies as a lost verified generation; otherwise the row remains
diagnostic-only. An absent recorded pane and a reused or mismatched live pane both
converge identically, and no row is parked behind a `needs_attention` overlay
or dead-end surface.

### Separate Continuity and confined fences

Continuity cutover and confined-project capability fences are separate
from this reconciliation contract and remain so. A Continuity source in
durable `releasing` state never enters the automatic successor path; it
follows its own idempotent termination, custody transition, and
provisional-successor parking under its own authority. Confined recovery
recreates its trusted runner and sandbox generation under ADR-0003's immutable
run policy and never relies on a native ID, cwd, or container label as the
boundary. This ADR adds no authority across either fence; it consumes its one
automatic opportunity inside the same local controller and project domain.

## Consequences

- `needs_attention` is a frozen legacy input that new reconciliation code
  never writes, never a product workflow, absorbing reconciliation state, audit
  state, or UI surface.
- The indefinite automatic retry series is removed. One automatic opportunity per
  lost verified generation, with no manual recovery endpoint or retry surface.
  A successor attempt that the provider rejects, mismatches, exits, or cannot
  verify consumes that one opportunity; it does not mean nothing verified was
  lost.
- The Check again / Remove from Deck dead-end surface is removed. Record
  removal is ordinary deletion with no special attention workflow: when there
  is no verified current controller, removal is record-only and sends zero
  effects to any old or unverified runtime; when a verified current controller
  exists, ordinary stop-and-remove keeps its exact complete-identity preflight and
  remains the only record-removing path.
- No prompt or input is ever replayed, and no side effect ever reaches an old
  runtime.
- The complete-identity preflight for attach, write, stop, and deletion is
  unchanged.
  **Superseded 2026-08-28 (write only):** attach, stop, and deletion are
  unchanged; writes retain controller/generation fencing plus direct dead/view
  pane-state checks, without reloading the session row or process identity.
- Acceptance covers: a hash-only grant committed before spawn; restart between
  grant creation and provider callback; atomic ID store/consume and identical
  replay; exact source/ID resume attestation where the CLI can silently fall
  back; a lost verified generation consuming exactly one automatic successor
  regardless of old liveness; no reopened or second opportunity; native-ID
  concurrency not blocking launch; zero old-runtime effects; and the
  terminal mount withheld from every row without a verified attachable pane.

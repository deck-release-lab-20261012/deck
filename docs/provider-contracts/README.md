# Phase 0 — provider behavioural contracts

These files record what the installed provider CLIs actually do, measured in a
real tmux pane. They are the evidence Phase 0 exists to produce, and no
implementation task may invent a value that belongs here: an unmeasured
contract is recorded as unmeasured, never guessed.

Every field is either a measurement or explicitly marked `unmeasured`. Nothing
is inferred from another provider — an earlier attempt to configure Kimi's
hooks by analogy with Codex's format failed outright, and an earlier survey of
Codex that skipped hooks produced a wrong conclusion about the whole product's
scope.

Nothing here is enforced at runtime. A launch refuses only what Deck can prove
absent: a missing or unrunnable executable, and an unprovisioned identity hook
for a retrieved-identity provider. Version and command-line drift in a CLI Deck
does not own is not evidence the provider is broken, so no gate measures it.

All agent providers may launch across versions. The status table below records
which rows are carried forward rather than verified. Each is a candidate for
the next conformance run, Kimi first: it is nine minor releases past its
measurement and its injection contract was never measured at all.

Remote browser authentication is documented in [Finish remote harness login](remote-login.md),
including the complete harness matrix and native versus mocked qualification.

## Workspace trust is per project, and provisioning can carry it

Claude, Codex and Kimi each stop a launch in a directory they have not been
trusted for, and none of the permission flags skips the modal. Each records
the answer in its own state, and seeding that record before the launch
removes the modal — so the ritual is one command per project rather than one
modal per harness per project:

```sh
noisedeck-provision trust /abs/path/to/project
```

It carries a decision the operator has already made by naming the path; it
never makes one. A project a harness has already decided keeps that decision,
including an explicit refusal, and the run says so. Deck itself never
writes these files: `GET /api/experimental/projects/{id}/harness-readiness`
reports what each harness's record says for a project, and no launch path
consults it.

Claude's `~/.claude.json` is live configuration the CLI rewrites while it
runs. The edit is staged beside it and renamed over it after re-reading and
finding the bytes it was built on — best effort, not a lock: a write landing
between that check and the rename is still lost. **Run the command with no
Claude session live on that home**; that precondition is the real protection.
A symlinked `.claude.json` is refused rather than replaced, because the
rename would swap the link itself.

Each contract records the file, what inherits a decision, and what a recorded
refusal means there.

## Status against the Phase 0 exit criteria

Phase 0 exits when every resumable provider has established an exact native
identity and passed its input-transport contract. "When available" does not
qualify a provider for release.

The shipped column is maintained by the harness-bump workflow (ADR-0010),
which moves a pin only after the image built with it and the CLI passed the
contract's `runtime_compatibility_probe`. The measured column moves only by a
conformance run.

The version each row measured is not always the version the image ships.
Where they differ, every contract in that row is carried forward on the
assumption that nothing it depends on changed between the two — an
assumption no measurement supports.

| | shipped | measured | identity | injection contract | containment |
|---|---|---|---|---|---|
| claude | 2.1.296 | 2.1.220 | ⚠️ carried forward | ⚠️ carried forward | ⚠️ carried forward — escapes |
| codex | 0.162.1 | 0.147.0 | ⚠️ carried forward | ⚠️ carried forward | ⚠️ carried forward |
| devin | 3000.11.3 | 3000.6.14 | ✅ measured 2026-09-06 | ✅ measured 2026-09-06 — modal input unmeasured | ⚠️ carried forward (measured on 3000.5.20) — escapes |
| kimi | 2.1.1 | 0.29.2 | ⚠️ carried forward | ⬜ unmeasured | ⚠️ carried forward |
| opencode | 1.19.0 | 1.18.4 | ⚠️ carried forward | ⚠️ carried forward | ⚠️ carried forward |
| pi | 1.2.0 | 0.84.1 | ⚠️ carried forward | ⚠️ carried forward | ⚠️ carried forward — escapes |
| command-code | 1.81.0 | 1.21.0 | ⚠️ carried-forward documented hook; exact resume unmeasured | ⬜ unmeasured | ⬜ unmeasured |
| cline | 3.0.71 | 3.0.53 | not applicable — fresh relaunch only | ⬜ unmeasured | ⬜ unmeasured |
| kilo | 7.8.8 | 7.4.21 | ⚠️ carried forward | ⚠️ carried forward | ⬜ unmeasured |
| omp | 18.10.3 | 17.2.12 | ⚠️ carried forward | ⬜ unmeasured | ⬜ unmeasured |
| qwen | 0.25.1 | 0.21.14 | not applicable — fresh relaunch only | ⬜ unmeasured | ⬜ unmeasured |
| mimo | 0.1.15 | 0.1.13 | not applicable — fresh relaunch only | ⬜ unmeasured | ⬜ unmeasured |
| qoder | 1.1.70 | 1.1.28 | not applicable — fresh relaunch only | ⬜ unmeasured | ⬜ unmeasured |
| cursor | 2026.10.01-e373342 | 2026.08.11-e8db854 | not applicable — fresh relaunch only | ⬜ unmeasured | ⬜ unmeasured |
| grok | 1.0.52 | 1.0.5 | not applicable — fresh relaunch only | ⬜ unmeasured | ⬜ unmeasured |

The image also ships Crush 0.98.1 as an operator-invoked CLI. Crush has no Deck
provider descriptor in this revision and is excluded from the behavioral table.

**Exact resumability is no longer an unknown for the original five.** They
establish an exact native identity without reading provider internals. Claude
and Pi assign; Codex and Kimi report theirs through a `SessionStart` hook;
opencode reports through a plugin `session.created` event. Codex has an
important lifecycle constraint: during a ten-second idle window after a fully
provisioned process became ready, 0.145.0 emitted no event. The first observed
event arrived after the first user submission, before that turn's reply.
opencode shares that constraint and sharpens it: the session is created
lazily, so no id exists at launch at all. Deck must account for that
measured late identity without injecting a synthetic prompt or pretending the
id was observed at launch.

Pi accepts a canonical UUID through `--session-id` before launch and resumes
that same conversation through `--session <full-uuid>`. The authenticated
0.84.1 probe recovered the prior synthetic marker, while an unknown full UUID
exited non-zero before any model call.

Command Code 1.21.0 documents a structured `SessionStart` hook carrying its
native UUID and exposes `--session <path|id>`. Deck always supplies the complete
UUID and rejects the prefix form the CLI also accepts. Authenticated exact
resume, active-turn input, modal input, and containment remain explicitly
unmeasured in `command-code.yaml`; the canary must not turn those declarations
into a release claim.

Devin 3000.5.20 documents `--resume <SESSION_ID>` and a structured
`SessionStart` hook with a stable `session_id` and a `source` field. A valid
existing id reports `source=resume` with the requested id. An unknown but
well-formed id does not fail: it silently starts a different session and reports
`source=startup`. Deck therefore stores the expected source and native-id hash
before spawning a provisional candidate, commits that candidate only after the
exact hook attestation, and revokes the grant before exact-tuple cleanup on a
mismatch or timeout. No provider output, list command, state file, or database
participates in identity.

Devin emits `SessionStart` only after its workspace-trust prompt. Deck passes
the documented `--respect-workspace-trust false` flag for both launch and
resume so a provisional exact-resume candidate can attest before it becomes
attachable. This does not widen Deck's project authority: the operator's
explicit project/provider launch gesture and Deck's outer project policy own
that boundary, and Devin workspace trust is not an enforcement mechanism.

**Hook installation is owned by provisioning, not by Deck**
(maintainer decision, 2026-07-31). The container image/bootstrap that seeds
provider configs installs the SessionStart hooks and establishes any native
hook trust; Deck never writes the operator's provider configuration
or answers provider modals. Before every Command Code, Codex, Devin, Kimi,
Kilo, or opencode launch or resume, Deck must verify the hook is present,
correctly shaped, and provisioned as required, then refuse with a remediation
error naming the file and expected entry when it is not.

**Codex's input contract is now measured against the real 0.145.0 CLI.** The
opt-in harness under `scripts/provider-spike/conformance/` launches the bare
executable in a private tmux namespace after a separate test-owned provisioning
pass. The fixture pins Sol/low/fast, approval `never`, `danger-full-access`, and
a trusted test project; the hook payload stays in memory, and only sanitized
process identities reach scratch for timeout cleanup.
It established bracketed multiline paste plus separate Enter submission,
exactly-once queueing after the current tool during an active turn, silent
discard in the native `/permissions` modal, Escape cancellation, normal idle
Ctrl-D exit, handled SIGTERM, same-pane respawn, and exact resume with the same
native session id and conversation history. Escape cancels the conversation
turn but does not stop an already-running command in Codex's independently
managed background terminal.

Terminal presentation is observed only by this test harness to establish
version-pinned evidence. It is not a product mechanism: Deck consumes
the resulting static descriptor and never parses provider output to infer
identity, busy/idle state, modal state, or delivery.

**Phase 0 has not exited.** Kimi still needs its injection contract measured
the same way Claude's and Codex's were.

## The finding that changes a design assumption

Claude's tool subprocesses leave the pane's process group **and** its session:

```
sleep(31805) <- bash(31803) <- claude(31194) <- tmux server
claude:  pid 31194  pgid 31194  sid 31194
sleep:   pid 31805  pgid 31805  sid 31803
```

While that subprocess ran, the pane's process group still had exactly one
member.

So `kill(-pgid, …)` does not reach tool subprocesses, and "the recorded process
group is empty" does not mean "every process this provider started is gone".
Signalling the pane's process group — which is what unconfined stop does — is
not sufficient for containment on its own.

This is not a bug to fix in application code. A Unix process group is signal
routing, not a supervision boundary, and Claude deliberately leaves it.

**All three providers were measured on 2026-07-31, including the kill.**
Each interactive TUI was launched as the pane process in an isolated tmux
namespace, driven through one long-lived foreground tool command
(`python3 -c 'import time; time.sleep(180)'`), its descendant tree enumerated
(pid/ppid/pgid/sid/tty from `/proc`), and then SIGKILL sent to the pane's
process group. Probe and procedure: `scripts/provider-spike/containment/`.

Pi was measured separately on 2026-08-09. Its authenticated TUI ran a
native `!` foreground command in a private tmux namespace; the child tuple was
read from `/proc`, the pane group was killed, the surviving child was observed,
then that exact child group was killed and verified absent.

| provider | child topology | after SIGKILL to the pane's group |
|---|---|---|
| claude 2.1.220 | bash tool shell calls setsid (new pgid + sid); children live in its session | CLI dies (`pane_dead_signal=9`); tool shell **and** child **survive**, reparented to init |
| codex 0.145.0 | tool child setsid (new pgid + sid, no ctty); a `codex-code-mode` helper also leaves the group | CLI dies; **every observed descendant gone ≤ 2 s** (measured twice) |
| kimi 0.29.2 | tool child spawned directly, setsid (new pgid + sid, no ctty) | CLI dies; tool child **survives**, reparented to init |
| pi 0.84.1 | native `!` child spawned directly, setsid (new pgid + sid) | CLI dies; native-command child **survives** until separately killed |

Every measured provider can place child work outside the pane's process group,
so across all four `kill(-pgid)` cannot reach every running child, and an empty
pane group never means "everything this provider started is gone."
Codex's descendants dying anyway is codex's own machinery — the escaped child
held no controlling terminal, so PTY hangup cannot explain it; kernel
parent-death signalling is the consistent explanation, and that is inference,
not measurement. Nothing in the product may rely on it: it does not
generalise to Claude or Kimi, and a future codex could stop doing it.

**The stop boundary is decided** (2026-07-31):
the product accepts this and says so plainly. "Stop" means signalling the
pane's process group per the provider's contract and recording the requested
action, the observed exit, and its status — no more than that. Escaped
descendants are outside that boundary: stop must not chase them (no
`/proc`-walking compensation), the reconciler cannot see them, and product
surfaces that expose session stop must state that detached tool processes can
outlive it rather than implying
total teardown. The product must define "stopped" as "the CLI process exited and
its exit was recorded", claiming nothing about detached descendants. A real
boundary (per-generation cgroup) remains an infrastructure decision for a
future host — kernel 4.4 with read-only cgroup v1 mounts has no cgroup kill
and no pidfd — and is out of scope for the first release.

## The finding that validates the outbox design

Input delivered to Claude while its startup trust picker was open was
**silently discarded** — no composer text, no queue entry, no change to the
modal — while tmux reported the write as successful.

Codex 0.145.0 independently showed the same loss mode: bracketed input sent
while its native `/permissions` modal was open disappeared without entering
the composer or active-turn queue.

That is the concrete justification for wording the product has already
adopted: `injected` means only that tmux acknowledged the paste and submit for
the intended pane. Here that would have been true while the message vanished,
with no error anywhere to notice.

It is also why held input can never be drained automatically. There is no
observation that distinguishes "delivered" from "discarded by a modal", so the
operator has to look. Deck does not infer whether a provider is busy, idle, at
a prompt, or accepting input, and never holds or suppresses input on that
basis: the native CLI's own queuing is what handles input during a turn.

## Two smaller facts worth not rediscovering

**Nothing in /proc identifies an interpreted provider.** Measured:

```
           /proc/exe                    /proc/cmdline
claude     .../versions/2.1.220         (the launch path)
codex      /usr/local/bin/node          "node /usr/local/bin/codex"
kimi       /usr/local/bin/node          "kimi-code"
pi         /usr/local/bin/node          "node /usr/local/bin/pi"
```

Every shortcut this table forbids was tried during the spike:

- **`/proc/exe` is the interpreter** for the Node providers — the same value
  for Codex, Kimi, Pi, and every other Node process on the host. It distinguishes
  nothing. An earlier draft of this file generalised from Claude and
  recommended comparing it against the resolved launch path, which would have
  rejected every valid Codex, Kimi, and Pi process.
- **`/proc/cmdline` does not rescue it.** Codex shows the *symlink* path, not
  the resolved script. Kimi has rewritten `argv[0]` to `kimi-code` and shows no
  path at all — the sharpest demonstration that a process's self-reported
  command line is not identity.

So for an interpreted provider there is **no reliable runtime executable
evidence**. That is the honest answer rather than a gap to engineer around: a
name, a PID, or a command line alone is never sufficient identity, and no
amount of care in reading them makes one so.

Identity therefore rests on the rest of the tuple — and above all on the
generation marker and identity marker Deck writes as tmux pane
options. Those are the best available evidence, and the only evidence we
control.

**They are not tamper-proof, and an earlier draft of this file wrongly said
they were.** Measured: a pane process inherits `TMUX=<socket>,<pid>,<session>`
and `TMUX_PANE=%N`, and anything holding that environment can rewrite the
pane's options — `tmux set-option -p @noisedeck_marker rewritten` from inside the pane
succeeds. tmux re-injects those variables even when `new-session` is given
`-e TMUX=`, so it cannot be suppressed.

That is inside the threat boundary the product accepts: the first-release
profile is unconfined and single-tenant, and any other process running as the
same Unix user can bypass Deck entirely. Nothing in the design may depend
on markers holding against a hostile process.

**And markers do not catch every accident either.** Measured: `respawn-pane -k`
replaces the pane's process while the pane id and both markers survive
unchanged —

```
before:  pane=%0  pid=16918  gen=7  marker=marker-original
after:   pane=%0  pid=16926  gen=7  marker=marker-original
         start ticks 12980990 -> 12980992
```

An out-of-band respawn is invisible to markers alone; only the pid and start
time move.

This is the clearest argument for why pane identity is a **tuple** rather than
a field: no single member sees everything.

The table below records only what was **measured**. An earlier draft filled it
in by reasoning and got two rows wrong, so unmeasured cells now say so rather
than guessing.

| member | measured to catch | measured NOT to catch |
|---|---|---|
| identity + generation markers | — | an out-of-band `respawn-pane` (markers survive it) |
| pane id | a pane-scoped target staying put while a session-scoped one follows the active pane | a pane **moved** between windows — `move-pane` from window 0 to 1 kept `%0` |
| pid + start ticks | an out-of-band respawn (`pid 16918→16926`, `ticks 12980990→12980992`) | — |
| process group | — | an **escaped child**: the pane stayed `pgid=18662` while the child took `pgid=18664` |

One thing NOT in the table because it was not measured, only reasoned: a
recycled process-group id would compare equal to the recorded one, and the
tuple records no group start time to tell reuse apart. That is an inference
from how pgids are allocated, not an observation, and it is kept out of the
table deliberately — the table's whole value is that everything in it was run.

**Two failures nothing in the tuple detects**, which matter directly for the
reconciler:

1. **An escaped child.** The pane's own process group is unchanged when a child
   leaves it, so no tuple member registers the escape. This is the same finding
   as the containment section above, seen from the reconciler's side: not only
   can we not *kill* escaped children, we cannot *see* them.
2. **A pane moved between windows.** The pane id survives `move-pane`, so a
   pane-id comparison shows a match. Detecting it would need window identity,
   which the tuple does not record.

Neither is a reason to add fields speculatively. Reconciliation must state
plainly what it does not cover, rather than implying the tuple is exhaustive.

**SIGTERM is reported as a status, not a signal.** Claude handles SIGTERM and
exits 143 itself, so tmux records `pane_dead_status=143` with an empty
`pane_dead_signal`. A process that dies *from* the signal reports the opposite:
`pane_dead_signal=15`, empty status. A reconciler expecting one shape would
record no exit cause for the other.

## Adding a provider: the touchpoints checklist

Every new provider touches all of these, in roughly this order. A new
provider's identity POST 409s forever if its id shape is not in the capture
validator, and no existing suite fails without a dedicated round-trip test.

1. **Descriptor** (`internal/provider/<name>.go`): the `Descriptor`
   interface, contract comments from measurement, the `Name` constant, and
   for retrieved-identity providers the `IdentityHook` fields.
2. **Provisioning** (`cmd/noisedeck-provision`): the hook entry or plugin
   file the provider loads, installed byte-for-byte from an embedded asset.
3. **Capture validator** (`internal/hookcapture/hookcapture.go`
   `validNativeID`): the provider's documented id pattern plus a round-trip
   test through the durable capture service — valid ids persist atomically,
   identical replay is idempotent, and wrong-shape ids return 409.
   Identity-none providers — the shell provider, which has no native session
   id to capture — skip this step entirely.
4. **Session manager** (`internal/session/manager.go`, `resume.go`): check
   every `IdentityContract()` switch handles the new contract — create,
   resume, durable grant expiry, and successor-slot boot convergence.
5. **DB CHECK** (`internal/db/migrations/`): a new migration widening the
   sessions.provider CHECK — a table rebuild with the `foreign_keys: off`
   marker (see 008/009), plus a row-fits/bogus-fails test.
6. **Config** (`internal/config/config.go`): the provider stanza, env vars,
   PATH resolution, hook-config validation for retrieved providers.
7. **Boot** (`internal/boot/boot.go`): registration in `buildProviders`.
8. **API** (`internal/server/providers.go`, `internal/session/handler.go`):
   the inventory endpoint serves the boot-built registry, and the create
   handler admits a provider only if the registry contains it. There is no
   per-provider create switch and no hand-maintained admission list.
9. **Provisioning** (`cmd/noisedeck-provision`): install what the gate verifies.
10. **Image**: Dockerfile pinned version + probe, compose env vars, the
    example config.
11. **Frontend** (`web/src/ui/session-identity.ts`): add the provider's
    display-name rule and tile colour class if they are not already covered.
    The browser learns the available inventory from `GET /api/providers`, so
    there is no `PROVIDERS` list to maintain. Add the name to
    `web/src/app/fixture-providers.ts` as well: that list is the preview
    console's fake-server data rather than runtime authority, but the preview
    and the palette coverage test only see the harness once it is there.
12. **Contract file** (`docs/provider-contracts/<name>.yaml`): every value
    measured on a private tmux namespace, never declared.

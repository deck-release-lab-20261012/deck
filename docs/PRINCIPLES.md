# Noisefloor Deck — principles

Deck is a thin wrapper. It runs unmodified agent CLIs in tmux panes for one
operator and puts a browser in front of them. Everything below earns its
place by naming a failure a single operator actually hits; anything that
cannot name one does not belong in the product.

These principles replace the requirements document. They are prose on
purpose: a numbered requirement invites code to cite it instead of stating
its own reason, and a citation cannot be argued with. A principle can.

## The thesis

**Run the CLI, don't reimplement it.** The harness is the product; Deck
supplies a browser, a place to keep sessions, and a way back to them. When
Deck and a harness disagree about how something should work, the harness
wins.

**Best effort, then say what happened.** Attempt the useful thing and report
the outcome plainly — resumed, relaunched, or refused with the reason. Do not
withhold an action until it can be proven correct; the operator can read a
result and decide.

**Never destroy to satisfy a check.** A failed verification is a reason to
report, never to kill a live pane, drop a recorded conversation, or discard
work. Restore, or fail visibly.

## What Deck must never do

**Never interpret provider output.** Identity, status, and progress are never
parsed from a transcript, a state file, or the terminal screen. Providers
reword their output freely; a wrapper that reads it breaks on their schedule,
not ours. Read process facts, tmux facts, and hooks the provider offers —
never the bytes it prints.

**Never modify the harness's own configuration at runtime.** Provisioning may
install what a provider needs before launch; a running Deck does not write
into an operator's provider home.

**Never put a secret in argv or in the terminal stream.**

## Sessions

**A session is a tab.** It remembers a directory, a harness, and the
conversation the pane was last on. Restoring means going back there. Deck
does not attest that the restored conversation is the same one, and does not
classify how it moved — whatever the live pane last reported is true.

**Status is observed, not assumed.** A session's state comes from
reconciliation with tmux and the process table, not from the last write. A
write is reported as sent when tmux accepted the bytes — never as understood,
accepted, or acted on by the model.

**Unattended recovery is bounded.** Relaunching a dead pane without a human
present is a convenience, and it costs real money when it loops: two attempts
in ten minutes, then stop and say so. An operator asking explicitly is not
that loop and is not bounded by it.

## Concurrency

**One operator, one writer.** Exactly one backend process runs. Guards that
defend against a second writer are answering a question this product does not
ask; do not add them, and delete them when found.

**One browser owns the terminal.** Two clients typing into one agent's stdin
interleave into garbage, so a second connection sees a takeover screen until
it deliberately takes control, and the displaced one is closed. Input is
serialized through a single writer to tmux, and every frame carries the
generation it was written for.

**Identity is only what stops harm.** Enough process identity to avoid
signalling a stranger — the boot epoch, the process group, the generation.
Fields that verify nothing an operator would notice are not identity, they
are bookkeeping.

## Security posture

The first-release profile is **unconfined and single-tenant**: sessions share
a user, a provider home, and the projects mount. Deck's protections are
against accident and confusion, not against the operator's own agents, which
already run arbitrary commands as that user. Design for a trustworthy
operator on their own machine; say so plainly rather than building ceremony
that implies otherwise.

The exception is anything that crosses a real boundary: the terminal reply
channel (provider output must never be able to type into provider stdin),
credentials, and whatever a future confined profile adds.

---

*History: the 2,369-line requirements document this replaces is in git
history. It served the product to stability; keeping it would have meant
maintaining ceremony no operator ever needed.*

// Package tmux wraps the tmux CLI for session lifecycle, pane identity, and
// serialized input writes within a dedicated Deck tmux namespace.
//
// tmux is the authority for whether a live terminal session exists (PRD
// §9.2). Each application session owns exactly one tmux session, launched
// with the provider executable as the pane command and remain-on-exit set —
// never an interactive shell with the command typed into it, so input after
// CLI exit can never fall through to a shell.
//
// A tmux session name alone is never sufficient identity: names can be
// reused. Neither is a pane id — a restarted tmux server reallocates $0 and
// %0 to different processes (measured on 3.6a). Callers must verify the
// full runtime identity tuple: socket, session and pane IDs, generation
// marker, pane PID, process-group ID, process start time, and expected
// executable ancestry.
//
// # Scope: mechanism, not policy
//
// This package reports what it observed and performs the tmux operations it is
// asked to. It deliberately does NOT decide whether a session has stopped.
//
// That boundary was learned rather than designed. An earlier version of
// this package owned a StopSession workflow — signal the process group,
// fence by start time, re-fence by group, wait, escalate, confirm the group
// is empty — and it kept producing confident answers it could not support.
// The decisive case: it read a dead pane's exit signal and then called
// kill-session, which destroys the pane and that evidence, so it discarded
// the very thing the exit record must keep — when the CLI exited and with
// what status or signal — and the dead pane native resume needs.
//
// The underlying problem is that "did it stop?" is not answerable from tmux
// state. tmux losing sight of a pane means only that; a process group is a
// signal-routing construct rather than a supervision boundary, so an empty
// group does not prove every descendant is gone; and persisting exit evidence
// before removing a pane requires the database. Those are session-lifecycle
// concerns with access to recorded identity, provider behavior, audit state,
// and the reconciler — so termination lives in internal/session, and deriving
// runtime status lives in internal/reconciler.
//
// What remains here: create and respawn panes, observe them, enumerate the
// namespace, and deliver literal input. The characterization tests in this
// package record the tmux behaviours those consumers must design around.
package tmux

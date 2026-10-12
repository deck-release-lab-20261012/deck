# Design brief — Noisefloor Deck

## What this is

A browser workspace for the *unmodified* Claude, Codex, and Kimi command-line
tools. It runs the real CLI in a terminal on a home server and shows you that
terminal in a browser tab, so you can drive an agent session from anywhere and
close the laptop without killing it.

It adds exactly four things on top of the terminal: projects to organise
sessions, a message box that won't lose what you typed, honest session status,
and a task panel.

**One user.** A technical operator running coding projects on their own server.
Not a team product; no permissions, no collaboration, no onboarding.

## The constraint that shapes everything

The terminal is the product. The CLI renders its own interface — its own
prompts, approvals, menus, colours — and we transport bytes to and from it. We
never re-draw or interpret what the agent is doing.

**Please do not design:** chat bubbles, message threads, tool-call cards,
reasoning panels, an approval dialog, a model picker, a settings screen, or
anything that restyles the agent's output. Every one of those is explicitly out
of scope, and proposing them costs us a conversation about why not.

So: the terminal occupies most of the screen and styles itself. What needs
designing is the frame around it.

## The actual hard problem

**Making uncertainty legible.**

This product's whole reason for existing is that the current system lies about
state — it shows green when a session is dead, and reports messages as sent
when they vanished. The replacement has to be *honest*, and honesty is a
display problem.

Here is a real measurement from testing last week. Claude was showing a modal
prompt ("do you trust this folder?"). We sent it a message. Every layer
reported success — the write succeeded, the terminal accepted it — and **the
message was silently discarded.** Nothing appeared. Nothing errored.

We cannot detect that case. It is not fixable in code. The only defence is a UI
that never lets the operator believe a message arrived when we only know it was
*sent*.

That distinction — **sent** vs **arrived** — runs through the entire design.

## What has to be visible, and separately

These are nine independent facts. Collapsing any two into one indicator is a
bug, not a simplification:

- browser connected?
- backend ready?
- terminal process alive?
- can this session be resumed if it died?
- session generation (incremented on every relaunch)
- how many messages are waiting, and how old is the oldest?
- how many messages are in an uncertain state?
- when did the terminal last produce output?
- did the last message delivery succeed, fail, or become uncertain?

The trap: an open connection is not a healthy session, and a healthy session is
not a delivered message.

## The message box has nine states

This is where we most need your help. Every message the operator types is in
exactly one of these:

| state | meaning | needs the operator? |
|---|---|---|
| **held** | saved, not sent | yes — release or cancel it |
| **queued** | released, about to send | no |
| **injecting** | mid-send | no |
| **injected** | sent (not necessarily *arrived*) | no |
| **ambiguous** | we cannot tell if it arrived | **yes, urgently** |
| assumed_delivered | operator looked and decided it arrived | no |
| skipped | operator looked and decided not to resend | no |
| retry_linked | operator resolved it by resending as a new message | no |
| cancelled | operator cancelled before sending | no |

Three things about this list:

1. **`ambiguous` is the one that matters.** It means a crash happened
   mid-delivery. The operator must go look at the terminal themselves and tell
   us what they see. We will never guess, and we will never retry
   automatically — resending could run a destructive command twice.

2. **Order is strict, and a stuck message blocks the ones behind it.** If
   message #3 is ambiguous, messages #4 and #5 wait. The operator needs to see
   that they are blocked and why.

3. **The four resolution states are history.** They matter for the audit trail
   but the operator rarely acts on them. They should recede.

## Scenarios to design for

**Returning after the server restarted.** Overnight, the container rebooted.
Six sessions across three projects. Some processes are gone. Some can be
resumed exactly where they left off; some cannot and need attention. Two have
messages that were in flight. *What does the operator see first?*

**A message went ambiguous.** The service crashed halfway through sending. We
know we started; we do not know if it landed. The operator must inspect the
terminal and choose: it arrived / it did not / resend as a new message. There
may also be half-typed text left in the input line that they need to clear
first — we will not clear it for them.

**A second browser tab opens.** Only one tab can control a session. The second
sees a takeover screen. Taking over disconnects the first. *How does the second
tab understand what it is about to do?*

**Force-stopping a session.** Destructive, needs confirmation, and — worth
knowing — the agent's own subprocesses can survive it. If we cannot confirm the
stop, we must say so rather than showing a tick.

## The layout, roughly

- project & session sidebar
- the terminal (dominant)
- session status + recovery controls
- the message box with its queue
- a collapsible task panel

Desktop-first. It runs behind a reverse proxy on a home network. Dark mode
matters — it sits next to a terminal.

## What would help most

In rough priority:

1. **The status display.** Nine facts, glanceable, honestly distinguishing
   "working" from "we don't know". This is the whole ballgame.
2. **The message queue.** Nine states where two demand action and four are
   history. What does "blocked behind an ambiguous message" look like?
3. **The ambiguous-message resolution flow.** The screen where a confusing
   layout causes real damage — someone clicking "it arrived" on something that
   never did.
4. **Sidebar and session list**, once the above are settled.

Static screens are fine; we do not need a prototype. If it is easier to react
to something concrete, say so and we will build a rough version first for you
to tear apart.

## Reference: Moshi (getmoshi.app)

Moshi is an iOS app that wraps tmux to drive agent CLIs from a phone. It solves
a neighbouring problem and is worth studying — the operator already runs it, so
you can see it working against the same three agents.

**Take from it:**

- **"Agents & Usages" — a live kanban of every agent's tasks, asks, and context
  budget.** The *asks* column is the interesting part: surfacing what each agent
  is waiting on, across sessions, without opening each one. Our equivalent
  question is "which of my six sessions needs me right now?"
- **Ambient status.** Live Activity, Dynamic Island, Apple Watch, push when a
  long job finishes. We have no phone surface, but the underlying idea — the
  operator should not have to keep the tab open to know something needs them —
  should shape how loud our status display is.
- **A diff view reachable from the terminal header**, for reviewing what the
  agent changed.
- **Terminal-first framing.** Their line is "a terminal built for phones, not
  shrunken from desktops." Ours is the same posture for a browser.

**Deliberately do not take:** Moshi renders "the agent TUI as a phone-native
conversation" — a chat view built by interpreting terminal output. That is the
single thing our product most explicitly refuses. Deck never parses provider
output to discover identity, status, or progress, and the whole architecture
depends on not doing it. It is a reasonable choice for a phone; it is the
wrong one here.

That divergence is the most useful thing about the comparison: **Moshi
interprets the agent, we transport it.** Where Moshi can show a tidy
conversation because it parses, we must show a raw terminal plus honest
metadata *about* it. Our design problem is what that metadata looks like.

Also note the form factor differs: Moshi is mobile, multi-host, pair-with-your-
machine. We are a desktop browser tab against one home server, one operator.

(This description comes from their marketing site plus their integration
running on our machine — not from using the app. The operator has it installed
and can show you the real thing.)

## Where we are

Backend foundations are built and tested — database, terminal control,
provider integration. No UI exists yet, so nothing is sunk and you are not
working around existing decisions.

## Non-negotiables

- Never show success we have not verified.
- Never merge two independent facts into one indicator.
- Never make an uncertain message look resolved.
- Destructive actions and every ambiguity resolution get an explicit
  confirmation.
- The terminal is the agent's; we do not restyle its output.

If a design makes the product look calmer by hiding uncertainty, it is the
wrong design. Showing "I don't know" clearly *is* the feature.

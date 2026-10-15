# ADR-0015: reviewer model pins move by a daily offer

Date: 2026-10-14

## Status

Accepted.

## Context

The SDLC pins its reviewer models by name: Codex on `gpt-6.1-sol` as the
primary, Claude on `claude-sonnet-5-5` as the secondary, and
`'gpt-6-astra'` as the in-repo fallback for the harness-bump settlement
reviewer (the `NOISE_REVIEW_MODEL` repository variable overrides it when
set). Unlike the CLI version pins, which ADR-0010 moved behind a daily
discovery job, the model pins had no machinery at all: when a provider
ships a successor — Sonnet 5.5 to 5.6, GPT-6.1-Sol to 6.2 — the pins
silently rot. A rotated-out model eventually fails at dispatch time, and
until then every review runs a model one generation older than the
operator believes.

The models cannot simply be aliased away (`claude --model sonnet` tracks
the latest automatically): the cross-model review gate's whole claim is
*which* model reviewed, so the pins must stay explicit and the refresh
must be a recorded decision.

## Decision

A daily job in the deployed workspace watches the pins and opens a
like-for-like refresh PR. Like-for-like means the same vendor and the
same tier family with a newer version — `claude-sonnet-5-5` to
`claude-sonnet-5-6`, never sonnet to opus — and the offer is a pull
request, never an automatic merge. Concretely:

- `.noise/reviewer-models.json` is the pin store. The SDLC recipe blocks,
  the dominance-rule example, and the settle workflow's fallback literal
  must repeat its values exactly; `internal/modelbump.Verify` fails CI on
  drift, the same fail-closed contract the harness pins have.
- Claude publishes no model list. The job probes the claude CLI's *local*
  catalog membership for the two nearest successor candidates
  (`claude-sonnet-5-6`, then `claude-sonnet-6-0`). Measured on the pinned
  CLI 2.1.296: an unknown `--model` prints a structured
  `claude-code:unrecognized_model` marker, but on an authenticated host
  the CLI still proceeds to send `/v1/messages` requests — so the probe
  runs with a scratch HOME (no credentials) and a dead loopback
  `ANTHROPIC_BASE_URL` (no egress). The marker then means absence, a
  local fact; Present demands a measured downstream signature — the
  pinned CLI's own "Not logged in · Please run /login" gate (measured on
  2.1.296, exit 0) or a connection/credential failure — so argument
  rejection, startup errors, silent exits, and timeouts classify
  Ambiguous and offer nothing. No model call is ever spent, and a
  withheld offer is safe, a misread one is not.
- The job runs in the deployed workspace (bootstrap-scheduled, like the
  task-hygiene sweep), not in CI, because the claude probe needs the CLI
  the workspace runs and CI has no Anthropic credential. It never touches
  the local checkout: the offer branch and file updates go through the
  GitHub API, and one offer PR may be open at a time.

## Consequences

- An accepted refresh is one squash-merged PR that moves the store and
  every repeat together; nothing else can change a reviewer model.
- When `NOISE_REVIEW_MODEL` is set, the offer PR cannot move the settle
  reviewer by itself — its body says to update the variable too.
- The tier families are read out of the slugs. A provider that renames
  its scheme (a tier disappearing, a new naming grammar) yields no
  successor, not a wrong one; the pin then waits for a human, which is
  the correct failure.
- Probing costs at most two credential-free claude invocations per day;
  no model call is ever spent on discovery.

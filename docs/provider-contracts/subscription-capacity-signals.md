# Subscription capacity signals

Status: measured feasibility record

Snapshot date: 2026-08-12

Record version: 1

## Purpose and boundary

This record identifies provider-supported, structured evidence that a future
Continuity policy could use to decide whether a subscription-backed CLI is a
candidate for new work. It is not a router and grants no authority to switch a
provider, start a session, or transfer custody.

Only documented CLI or protocol surfaces qualify. Terminal output,
transcripts, provider databases, opaque state files, undocumented endpoints,
elapsed time, locally counted tokens, silence, and text scraped from a `429`
message are forbidden inputs. A missing field means unknown; it never means
zero usage or available capacity. Authentication material and account output
must remain inside the real CLI that owns it.

The installed baseline measured on this host was:

| Path | Installed version | Authentication probe |
| --- | --- | --- |
| Claude Code | `2.1.228` | Not queried; version and help only |
| Codex CLI | `0.147.0` | Existing app-server auth used without printing account data |
| Kimi Code CLI | `0.34.0` | Not queried; version and help only |
| OpenCode | `1.18.15` | Not queried; version and help only |
| ZCode / Z.AI helper | not installed | Not applicable |

## Capability matrix

| Provider path | Qualified surface | Scope and units | Reset semantics | Cadence and staleness | Authentication boundary and side effects | Decision class |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code subscription | Status-line stdin JSON: `rate_limits.five_hour` and `rate_limits.seven_day`, each with `used_percentage` and `resets_at` | Account subscription windows; percent consumed (`0..100`) and Unix epoch seconds | Provider-supplied reset instant for rolling five-hour and seven-day windows | Event-driven after session start and provider responses; optional configured refresh interval reruns the status command but does not promise a fresh upstream fetch. Fields can be absent or null before the first API response | Produced by the real Claude Code process for Claude.ai Pro/Max subscribers. Enabling a status line changes CLI configuration and launches a local command. A collector must emit only the four allowlisted scalar fields and must discard other input fields, especially `transcript_path` | **Proactive, qualified with constraints.** Per-live-session observation only; absent/stale values are unknown |
| Codex ChatGPT subscription | App-server JSON-RPC `account/rateLimits/read`; `account/rateLimits/updated` notification | Each window has `usedPercent`, `windowDurationMins`, and `resetsAt`; optional `individualLimit`, `spendControlReached`, reached type, named limit IDs, and reset-credit metadata | Duration plus provider-supplied Unix reset instant. Read again after any reset-credit consumption; do not infer the new state | Snapshot on read. Notifications are sparse rolling updates and must be merged into the last snapshot without treating null/omission as a clearing value; refetch after reconnect or ambiguity | Runs through the real `codex app-server` and its existing ChatGPT authentication. Read is non-mutating. `account/rateLimitResetCredit/consume` is explicitly outside collection because it has an account side effect | **Proactive and qualified.** Best current machine contract |
| Kimi Code subscription | `/usage` in the interactive CLI; Kimi Code Console | The documentation describes shared account quota and five-hour, weekly/billing-cycle, and monthly limits, but publishes no machine-readable `/usage` schema | Console/CLI display provider refresh state; documented errors distinguish five-hour and monthly/billing-cycle exhaustion | Manual query only. No documented push cadence, timestamp, or structured staleness marker | Owned by the logged-in Kimi CLI or Console. Automating the slash command would require terminal-output parsing, which is forbidden | **Manual-only, not eligible for automatic decisions.** Structured quota errors are reactive failure evidence only |
| OpenCode with OpenCode Go/Zen or another subscription provider | No documented subscription-capacity endpoint. `opencode stats` reports local session token usage and cost; the server publishes health, projects, sessions, providers, messages, and events | Local historical tokens/cost are not an upstream allowance and have no authoritative subscription scope | None for subscription capacity | Historical local records only; no provider reset or staleness contract | Reading stats is local, but converting local consumption to remaining provider quota would be inference. Provider auth remains in OpenCode | **Unsupported/unknown.** Never derive capacity from `stats` |
| Z.AI GLM Coding Plan candidate | Official `glm-plan-usage` Claude Code plugin provides an interactive usage query; official API errors have structured business codes | Plan docs describe five-hour and weekly prompt pools plus monthly MCP quotas. Error codes `1308`, `1310`, and `1316..1319` carry exhausted-window/reset facts | Five-hour and seven-day reset times appear in reactive error payloads; the usage plugin documentation publishes no output schema | Plugin is manual-only with no documented structured cadence or staleness marker. Errors occur only after a request fails | Plugin installation changes Claude Code configuration and is Personal-plan-only. Directly calling an undocumented backing endpoint is forbidden. The installed host has neither `zcode` nor the plugin | **Manual-only; reactive structured errors only.** No proactive machine contract |

## Source record

The source links below are official product documentation or upstream
repositories. They are the contract anchors for this snapshot.

- Claude Code documents the exact status-line fields, their units, update
  triggers, nullable startup behavior, and optional refresh interval in
  [Customize your status line](https://code.claude.com/docs/en/statusline).
  Its [error reference](https://code.claude.com/docs/en/errors) distinguishes
  subscription exhaustion from temporary throttling and directs operators to
  `/usage`; error text itself is not a collection surface.
- Codex documents initialization, `account/rateLimits/read`, sparse
  `account/rateLimits/updated` notifications, field semantics, and the
  side-effecting reset-credit method in the official
  [app-server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md#auth-endpoints).
- Kimi documents shared quota and the manual `/usage` surface in
  [Membership benefits](https://www.kimi.com/code/docs/en/kimi-code/membership.html)
  and distinguishes overload, concurrency, five-hour, billing-cycle, and
  monthly failures in its
  [error reference](https://www.kimi.com/code/docs/en/kimi-code/error-reference.html).
- OpenCode documents local token/cost statistics in its
  [CLI reference](https://opencode.ai/docs/cli/#stats) and the complete
  documented HTTP categories in its
  [server reference](https://opencode.ai/docs/server/). Neither surface
  defines remaining upstream subscription capacity.
- Z.AI documents the manual, Personal-plan-only
  [usage query plugin](https://docs.z.ai/devpack/extension/usage-query-plugin),
  plan windows in the
  [GLM Coding Plan overview](https://docs.z.ai/devpack/overview), and reactive
  JSON business errors in the
  [API error reference](https://docs.z.ai/api-reference/api-code).

## Safe probe results

The probes were deliberately content-blind:

1. Version commands and top-level help were run for each installed executable.
   No login/status command, credential path, environment value, account
   identity, quota value, terminal transcript, or provider state file was read.
2. Codex app-server was initialized over stdio and sent one
   `account/rateLimits/read`. The probe retained only field names and JSON
   primitive types. At version `0.147.0`, the response contained
   `rateLimits`, `rateLimitsByLimitId`, and `rateLimitResetCredits`; the primary
   window exposed numeric `usedPercent`, `windowDurationMins`, and `resetsAt`.
   No values or account metadata were printed or persisted.
3. Kimi help exposed no non-interactive usage/status command. The documented
   `/usage` command is interactive, so it was not driven or scraped.
4. OpenCode help exposed `stats`, whose official definition is historical
   session token and cost statistics. It was not run because those records are
   forbidden as subscription-capacity evidence.
5. No ZCode executable or Z.AI usage plugin was installed, so no runtime probe
   was attempted.

## Collector contract for later tasks

A future capacity collector must satisfy all of these rules:

1. Identify the provider, executable version, authentication mode when the
   provider returns it, observed-at time, source method, and source-native
   scope. Never attach the evidence to an account by guessing from a profile
   name.
2. Store only typed capacity facts: window identifier, percent used, duration,
   reset instant, reached classification, provider staleness marker, and an
   explicit `unknown` reason. Do not store raw protocol payloads.
3. Treat a snapshot as stale after transport restart, authentication change,
   provider version/contract change, missed sparse-update sequence, reset
   instant, or a provider-specific maximum age established by a later real-CLI
   test. Time passing cannot make an unknown value available.
4. Claude collection must occur through an operator-installed, allowlisting
   status-line adapter. It must ignore every non-capacity field and cannot read
   the transcript path it receives.
5. Codex collection must initialize a dedicated official app-server connection,
   take a fresh snapshot, merge sparse notifications, and refetch on ambiguity.
   It must never invoke login, logout, reset-credit consumption, or another
   side-effecting account method.
6. Kimi, OpenCode, and Z.AI remain `unknown` for proactive automation until an
   official versioned structured surface is documented and measured. Reactive
   errors may explain a failed request but cannot authorize blind replay or
   predict availability.
7. Contract tests use synthetic provider-owned payloads for parsing and a
   privacy-bounded real-CLI probe for presence/type checks. They assert that
   credentials, identities, raw payloads, transcripts, terminal text, and
   provider database/state-file contents never enter logs, storage, audit, or
   telemetry.

## Feasibility conclusion

Codex is ready for a proactive typed collector. Claude is feasible only through
an explicitly configured per-session status-line adapter with strict field
allowlisting and honest staleness. Kimi and Z.AI currently offer operator
visibility and reactive errors but no documented proactive machine contract;
OpenCode exposes local consumption rather than authoritative remaining quota.
Those three paths must remain unknown until their providers publish and the
project measures a suitable structured surface.

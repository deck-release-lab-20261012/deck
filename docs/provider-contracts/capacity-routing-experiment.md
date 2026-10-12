# Unconfined capacity-routing experiment

Status: capacity-routing feasibility spike

Snapshot date: 2026-08-14

This default-off experiment answers three questions only:

1. Which configured provider harnesses and provider-reported models can Deck
   observe through their real executables?
2. Which of those executables returns current subscription-window usage?
3. Can Deck launch a normal same-project session and wait for that receiver to
   declare acceptance, then a content-free task completion, without treating
   process output, process exit, or task state as either?

It is not Continuity, confinement, automatic routing, or custody transfer.
The source chooses the target. The loopback endpoint is only an accident
boundary and the provider process receives the existing unconfined project and
subscription profile.

## Commands

Enable the experiment only on an explicitly unconfined Deck process. Deck
creates a fresh in-memory control capability at boot and injects it into the
scrubbed environment of sessions it launches; the CLI sends it automatically.
The capability is not configuration, operator identity, or a confinement
claim, and it is never persisted or logged:

```sh
export NOISEDECK_EXPERIMENTS_UNCONFINED_CAPACITY_ROUTING=true
noise deck serve --config /path/to/config.yaml
```

Agents launched by that process inherit the loopback control URL and project
identifier plus the process-local capability, so they can run:

```sh
noise deck harnesses list --json
noise deck harnesses show claude --json
noise deck agent-handoff \
  --provider claude --model fable --role reviewer --task <id> \
  --correlation-id capacity-route-example --timeout 5m \
  --completion-timeout 30m --json
```

`agent-handoff` exits successfully only when MemPalace contains the exact
content-free `handoff.accepted` event named in the one-time receiver bootstrap,
followed by one content-free `handoff.completed` event on that same fresh
route and correlation. The bootstrap tells the receiver to close the handoff
exactly once, with status `applied` when the delegated task is finished and
verified, or `failed` when it cannot be completed; the Logstream status
vocabulary has no literal `complete` value, so `applied` is the
completed-successfully closure this experiment uses. A closure carrying any
other status, one that predates its acceptance, or one on another route or
correlation is rejected. Deck generates a fresh event correlation for every
launch; the caller's correlation remains request metadata and cannot let an
old acceptance or completion satisfy a new handoff.

The command waits for acceptance (bounded by `--timeout`, at most 5m), then
for completion (bounded by `--completion-timeout`, default 30m, maximum 2h —
long enough for a bounded delegated unit of work, short enough that an
abandoned receiver cannot pin a caller indefinitely). A single Logstream wait
blocks at most five minutes, so longer completion deadlines are waited in
bounded chunks under the one operator-selected deadline. Timeout, a `failed`
closure, or a malformed declaration exits nonzero while the ordinary session
stays visible in the project session list, so normal sidebar inspection and
cleanup still work; Deck never stops, releases, or hides the receiver.

The JSON result carries the minimum a caller needs: `unconfined`, `accepted`,
`completed`, the ordinary `session` record and capacity `evidence`, the
`acceptance` route with the server-generated `correlation_id`, a `completion`
object naming only the awaited event `type` and the observed closed `status`,
and a `diagnostic` on failure. No task or prompt body, terminal output, or
other semantic content appears in the result.

## Compose deployment

`compose.yaml` maps the switch into the app environment with a generic
`false` default:

```yaml
NOISEDECK_EXPERIMENTS_UNCONFINED_CAPACITY_ROUTING: ${NOISEDECK_EXPERIMENTS_UNCONFINED_CAPACITY_ROUTING:-false}
```

`deploy/verify-production-compose.py` accepts only the rendered strings
`true` and `false` for it; a missing, empty, or abbreviated value fails the
production capability check instead of silently enabling the experiment.

Enable it only on a deployment already known to be unconfined, and treat the
label as conspicuous: `true` is an explicit UNCONFINED opt-in that makes no
confinement claim and grants no additional authority beyond the ordinary
unconfined project and subscription profile.

1. In the private `deploy/compose.env`, set
   `NOISEDECK_EXPERIMENTS_UNCONFINED_CAPACITY_ROUTING=true`.
2. Redeploy with the ordinary operator commands — for Noisefloor production
   `deploy/production-compose.sh`, otherwise the documented
   `docker compose ... up -d` invocation. The redeploy is an operator
   action; the value changes nothing until that redeploy restarts the app.
3. Verify the running app container after the redeploy, not just the rendered
   file — the experiment is on only when the app process's effective
   environment carries the exact value:

   ```sh
   docker exec noisefloor-deck printenv NOISEDECK_EXPERIMENTS_UNCONFINED_CAPACITY_ROUTING
   ```

   The command must print exactly `true`. Naming the variable makes `printenv`
   emit only that value, never the rest of the environment.

Roll back by restoring `false` in `deploy/compose.env` and running the same
ordinary redeploy; the next boot starts with the experiment off. Confirm the
rollback the same way — the identical
`docker exec noisefloor-deck printenv NOISEDECK_EXPERIMENTS_UNCONFINED_CAPACITY_ROUTING`
command must print exactly `false`.

## Measured provider surfaces

| Provider | Installed version | Model source | Capacity source | Experiment result |
| --- | --- | --- | --- | --- |
| Claude | `2.1.232` | `claude --print --output-format json --tools '' --no-session-persistence /model` | The equivalent single-shot `/usage` command | Current session, all-model weekly, and Fable-specific weekly percentages and reset instants were returned. This is direct provider-command text normalized by an experiment adapter, not a structured capacity contract of the kind Continuity would require. |
| Codex | `0.147.0` | App-server `model/list` | App-server `account/rateLimits/read` | Provider-reported model IDs/reasoning efforts and named account windows were returned as typed JSON-RPC fields. |
| Other configured providers | varies | no capacity adapter | no capacity adapter | `unknown`; local token or cost estimates are never substituted. |

The adapters retain only provider, source, observation time, model ID/display
name/reasoning efforts, window name/scope, used percent, duration, reset time,
state, and a fixed diagnostic. Raw responses, account identity, credentials,
terminal output, transcripts, and provider state files are not returned,
logged, audited, or stored.

## MIT implementation survey

The spike evaluated behavior and public interfaces from these projects and did
not copy their source, protocols, assets, or tests:

- [CodexBar](https://github.com/steipete/CodexBar) is MIT-licensed and offers
  the broadest mature provider inventory, JSON-capable CLI, and guard/routing
  precedent across Claude, Codex, Kimi, OpenCode, and other providers.
- [cclimits](https://github.com/cruzanstx/cclimits) is MIT-licensed and is a
  thinner Linux/macOS CLI precedent for normalized JSON across Claude, Codex,
  Gemini, Z.ai, Kimi, and Copilot.
- [coding_agent_usage_tracker](https://github.com/Dicklesworthstone/coding_agent_usage_tracker)
  has a license rider in addition to MIT wording, so it is not treated as a
  clean MIT dependency candidate.

No third-party runtime dependency was added. Deck calls the already-configured
real provider executables, which preserves the native subscription and
authentication boundary and keeps unsupported evidence explicitly unknown.

## Boundary with noise sdlc

This spike follows the accepted split in the noise sdlc incubation contract.
Deck owns configured runtime adapters, fresh provider observations, real CLI
launch, and ordinary session visibility. `noise sdlc` owns the curated harness
catalog, compatibility certification, model-family and quality metadata,
lifecycle role definitions, routing templates, and operator-confirmed project
bindings. Deck treats `--role` as an opaque bounded identifier and does not
define a competing role vocabulary.

The plural `noise deck harnesses list|show` commands are the first thin slice
of SDLC's already-reserved Deck runtime-inventory noun. This experiment does
not implement the catalog-digest receipt or persistent synchronization
contract, and its volatile subscription windows are not SDLC support evidence.
`noise sdlc inventory` remains the optional standalone, best-effort executable,
version, and safe-model probe; it deliberately reports readiness, quota, and
spend authority as unknown. Deck neither imports that disposable observation
as runtime truth nor recreates SDLC's version certification in this spike.

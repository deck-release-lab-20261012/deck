# ADR-0010: Harness pins move by a daily job

- Status: Accepted 2026-09-04 by the decision owner, who directed the
  automation
- Date: 2026-09-04
- Decision owner: Operator

## Context

The image pins sixteen agent harness CLIs by version, and three of them by
artifact digest as well. Each upstream ships every few days. Until now a
pin moved when the operator asked an agent to move it: the agent read the
upstream, rewrote the `ARG`, the package test that repeats it, the shipped
column of the contracts README, and for Claude the supervisor's provider
profile, then opened a pull request. The work is mechanical, it was asked
for often, and the asking was the cost.

The contracts README records that version drift in a CLI Deck does not own
is not evidence the CLI is broken, so no runtime gate measures it. That
stands. A bump is different from drift: it is Deck choosing to ship a
version, and the operator wants that choice gated before it reaches a pull
request, not after.

## Decision

The daily job's workflows run only in the private repository and are not part
of the source release.

1. **A scheduled workflow moves the pins.** Twice a day (amended
   2026-10-15: the fastest upstream ships more than twice a day, the run
   averages under fifteen minutes, and a failed run previously cost a full
   day of staleness) `harness-bump.yaml`
   compares every pin in the harness catalogue with what its upstream
   publishes and, for each eligible harness that has moved, rewrites the pin and
   every literal that repeats it. The catalogue and the rewrite live in
   `internal/harnessbump`, driven by `cmd/noisedeck-harness-bump`, so a
   bump by hand and a bump by the job are the same code.

2. **One combined build gates all updates before publication.** Discovery
   reads every catalogue upstream once and fails on unavailable sources.
   The job applies every eligible outdated pin and its repeated literals, runs pin
   tests, builds the runtime image once, then runs the contract probe for
   every updated CLI. A harness whose probe fails is returned to its
   pre-batch pin and named in the report, and the rest of the batch ships;
   the next run discovers it outdated and tries again (amended 2026-10-15:
   one broken release must not hold every other harness's update hostage).
   A batch in which every updated harness failed its probe opens no PR and
   fails the run. Per the operator's 2026-09-05 amendment, daily probes
   validate installation and credential-free startup/syntax only: no harness
   account login, API key, authenticated prompt, or exact historically
   measured version is required. Probes have no network and use disposable
   HOME and XDG config/data/state/cache, with no provider credentials mounted.
   Authenticated behavioral certification is separate, opt-in, and non-blocking
   for daily updates. Historical measured versions and behavioral observations
   remain historical evidence; syntax checks do not re-certify them and the
   updater must never rewrite them to imply otherwise. GitHub/private-source
   access and the independent reviewer's subscription login below are distinct
   from credentials for a CLI being upgraded.

3. **One complete batch per pull request.** The branch is
   `harness-bump/all-<id>`, titled `chore(provider): pin all <id>`, where
   the ID hashes the complete catalogue of target versions. Retries reuse
   the existing PR without overwriting its branch. Before discovery or an
   image build, an open batch is handed back to settlement; newer upstream
   releases do not create parallel batches. Multiple open batches fail with
   an explicit cleanup error rather than silently selecting or deleting one.
   A blocked batch remains visible for intervention, with no daily duplicates.
   Settlement reports blocked CI, requested changes and provenance handoffs
   as failed runs with per-PR reasons rather than a successful no-op.
   Reconstruction uses the candidate's recorded versions, not today's latest
   tags; exact-tip producer evidence still proves its build and probes. A
   newer release or discovery outage cannot change who authored a snapshot.
   Native-login contract tests run before building and publishing, alongside
   the pin tests. Every harness follows the same automatic update policy:
   a new version is not held for separate manual login qualification. Shipped
   remote-login version bindings move with the image pins, preserving exact
   package and process identity checks. Build or compatibility failures still
   block publication; historical account-level measurements are not rewritten
   or asserted by a version bump. An orphan is admitted
   only after trusted code reconstructs the complete candidate tree at its
   merge base. A modified orphan or Git error fails visibly.
   The job uploads exact-tip evidence with a `4\\n` producer marker only
   after every updated CLI that remains in the batch passes its contract
   probe and its native a2a receive probe; earlier per-harness markers
   cannot attest to a batch, and a dropped harness leaves the branch, the
   report and the pull request before the marker is written. Publication follows upload and a tip recheck.
   Settlement is awakened by completion of the producer and Fast checks,
   with an hourly retry. It deliberately has no pull-request-review trigger:
   those events use PR refs, which the main-only runner cannot admit, and
   their skipped check blocks otherwise green PRs. A settlement run completes
   its own review/merge round; independent reviews are picked up by explicit
   dispatch or the hourly retry. It runs trusted main and proves author,
   allowed files, deterministic reconstruction and exact-tip evidence before
   dispatching branch CI. The Actions author's REST and GraphQL forms,
   including `app/github-actions`, are accepted; unrelated authors are not.
   A `GITHUB_TOKEN`-created PR can have approval-required CI whose merge-ref
   check rollup hides a successful standalone dispatch. After candidate and
   build-evidence proof, settlement uses its existing Actions-write permission
   to approve only the same-repository `ci-fast.yaml` pull-request run bound
   to the exact current PR head. This admits execution, not a passing result
   or a review. It rechecks the head before approval, fails visibly on API
   errors, and retains explicit dispatch as the fallback when no approval is
   pending. The trusted settlement run polls current PR state for up to fifteen
   minutes before review and again after review, repeating admission and
   exact-head checks each time. Missing completion events therefore do not
   strand a run that reached CI while it was pending. A deadline or API error
   fails visibly; failed CI and human handoffs stop polling. A branch update
   that needs a fresh review explicitly dispatches settlement on main once
   CI is green. The hourly schedule remains a fallback, not the normal
   continuation path.
   Review waits for green exact-head CI. Only a formal different-model
   `noise-review[bot]` approval at the current head, green checks, no
   unresolved threads and an up-to-date branch permit a squash merge.
   Mechanical branch updates retain the existing merge-evidence proof and
   invalidate old approvals. Human edits are handed off, not overwritten.

4. **The reviewer uses the local Codex subscription; the host posts.**
   Production settlement runs trusted main on the private Linux runner.
   Its dedicated `deck-trusted-review` runner group admits only this private
   repository and `harness-bump-merge.yaml@refs/heads/main`, enforced by
   GitHub outside editable workflow YAML. The policy is recorded in
   `deploy/harness-review-runner-group.json`; provision it before attaching
   the dedicated `noisefloor-review` runner. Never put this runner in the
   default group or broaden the group to other refs. The YAML ref guard
   is defense in depth, not that enforcement boundary. Existing build
   runners remain in their current groups. Host administrators and other
   Docker-privileged host services remain trusted; this group restricts job
   admission, not privileged co-resident host processes.
   The dedicated review runner’s systemd unit reuses the generic runner
   resource-limits drop-in rather than duplicating that policy.
   Codex runs in the review container with its dedicated ChatGPT-managed
   login, not an API key. `NOISE_REVIEW_CODEX_AUTH_DIR` names an operator-owned
   local directory outside every checkout. Only `auth.json` is copied into
   an otherwise fresh Codex home; configuration, history and skills are not
   inherited. A lock serializes this login. Before candidate content is
   mounted, a separate Codex invocation in an empty workspace refreshes the
   login using a fixed trusted instruction. Only successful authentication
   from that invocation is retained, after confirmed container termination.
   Authentication written by the PR reviewer is always discarded, including
   after failed reviews. Uncertain teardown fails visibly and retains private
   scratch for operator recovery rather than promoting auth or deleting a
   still-mounted directory.
   Cleanup first terminates and reaps its own Docker launcher, then checks
   the unique container name independently of the cidfile. A delayed
   launcher cannot register a new workload after the final inventory.
   Missing authentication fails closed; no seed is silently restored over
   refreshed tokens. This workflow is disabled for public repositories.

   The container still has no network interface beyond loopback. Its one
   exit is a Unix-socket CONNECT proxy permitting TLS to `chatgpt.com:443`
   and `auth.openai.com:443`. It resolves destinations outside the container,
   rejects private addresses, and dials the checked address directly.
   The proxy holds no credentials and does not inspect or emulate provider
   protocols. TLS remains end to end. The subscription credential is an
   explicit exception: Codex and its children can extract it and exercise
   upstream account capabilities. This profile does not promise isolation
   from account-wide history, connected repositories or cloud actions.
   It does exclude the host workspace, other credentials, GitHub mutation
   authority, host processes, Docker socket and direct host/LAN egress.

   The host compares the dispatcher's complete diff to an immutable GitHub
   comparison of the captured base and head before invoking Codex; a raced
   or truncated diff fails closed. The verdict capture and exact-head
   host-side posting described below remain unchanged. Hostile probes test the subscription exception and
   absence of other credentials, direct network paths and proxy destinations.
   The API-broker profile below remains a credential-free CI regression
   fixture, not the production authentication path and not an API-key
   prerequisite for the daily updater.

   In that fixture, the model runs in a
   container (`scripts/harness-bump/review-jail.sh`) that holds a dummy
   API key, a copy of the pull request's tree, and the pinned Node, Codex
   and Go mounted read-only, as an unprivileged user with every capability
   dropped, with no network at all: loopback is its only interface, it
   has no route and no resolver, so no query and no byte can leave it. Its
   one way out is the broker's unix socket, bind-mounted in alone and
   read-only and reached through a loopback dialer inside the jail; the
   broker's own record of what it admitted and forwarded lives outside
   every jail mount, where only the host writes; the broker
   (`noisedeck-harness-bump broker`) is the one process that holds the
   real key, and it holds nothing else: it starts from an empty
   environment with the model key alone, and the workflow reads its
   environment back to prove it. The pinned Codex is installed, with no lifecycle script, in a
   step that holds no credential. The broker forwards exactly one operation,
   `POST /v1/responses`, and only in Codex's own request shape, measured
   against the pinned CLI: the model the round was dispatched with,
   client-executed tools only (no hosted web search, file search, code
   interpreter, MCP, image or computer tool; Codex's own web search is
   switched off in the jail, and the broker refuses it regardless), no server-side persistence
   or continuation, no service tier, no background run, a bounded output,
   a bounded body, a bounded number of calls for the round, text-only
   input items of the kinds Codex sends (no file, image, URL or stored
   item anywhere in a message, a tool call or a tool output), and no field
   outside that set. The forwarded body is rebuilt
   with the policy's values, not relayed; anything else is refused before
   the key is touched.
   The review command the prompt names is a stub inside the jail that can
   only capture the verdict to a file. When the container exits, the host
   validates the capture (`noisedeck-harness-bump verdict`: a known event,
   the matching verdict line, no token or key shape, a bounded size) and
   posts it as the app against the exact head the round was of: the tree
   the reviewer tested, the diff it read and the commit the verdict names
   are one SHA, so a push during the review leaves the verdict on the old
   commit, where settle does not count it.
   Before any review, the workflow runs the jail in hostile mode and
   proves from inside that no credential is in the environment, in any
   visible process, or on any mounted path, that the host's process tree
   is not visible, that loopback is the only interface and there is no
   route and no resolver, that the broker refuses any other operation,
   model, persistence, hosted tool or non-text input, and that the one
   write the jail must make, the verdict, reaches the host. The same probe
   is a pull request gate: `fast-checks` runs the real pinned Codex and
   container with canary credentials on every change, so the boundary is
   proved before it ever holds a real key. A prompt injection in a pull request can therefore
   reach a model with nothing to steal and no way to post.

5. **Digests are measured, never copied.** For a digest-pinned harness the
   job downloads each artifact and hashes the bytes; it does not read a
   checksum from an upstream manifest. The Dockerfile's check then verifies
   the same bytes the job saw.

6. **Discovery is complete or fails.** Devin uses the promoted manifest at
   `https://static.devin.ai/cli/current/manifest.json`, the same source as
   its official installer. All sixteen catalogue harnesses have discovery
   sources. An unreachable upstream fails the batch rather than silently
   shipping an incomplete update.

7. **The measured column stays.** A bump updates the contracts README's
   shipped column only. Re-measuring a contract is a conformance run, not a
   bump, and the README's carried-forward markers say so.

## Consequences

- Eligible new versions arrive as reviewed, merged bumps with a build and
  a probe behind them, and a pull request to read when one did not merge.
  No harness has a separate manual version-qualification hold. A green
  discovery run may still await build, CI or merge; the resulting pinned
  versions and deployment evidence establish what actually ships.
- Publication and settlement explicitly dispatch Fast checks at the bump
  branch, never main, so the short-lived workflow token does not depend on
  approval-required PR-event runs. Settlement itself always executes main.
  Both jobs require Actions write permission. GitHub's repository setting
  **Allow GitHub Actions to create and approve pull requests** must be enabled
  to publish with this token; that setting does not replace the independent
  `noise-review[bot]` verdict or required checks. An optional
  `HARNESS_BUMP_TOKEN` remains supported with contents, pull-requests and
  actions write on this repository. The separate private reviewer source
  is fetched with a short-lived token from the existing review App, scoped
  to contents read on the reviewer source repository alone. It is minted after
  provider installation, used only by the source-fetch step, and revoked
  at job end; neither provider installation nor the jailed model receives it.
  PR creation, probe, evidence upload, and dispatch errors fail visibly.
  A rerun retries the handoff for an existing open PR without rewriting
  its branch. A recovered branch predating Fast checks' `workflow_dispatch`
  trigger needs a reviewed update from main before this handoff can work;
  a run on main cannot stand in for checks on its head.
- The reviewer runs locally only when its configuration is present:
  `NOISE_REVIEW_APP_ID`, `NOISE_REVIEW_INSTALLATION_ID`,
  `NOISE_REVIEW_PRIVATE_KEY` as repository secrets,
  and the `NOISE_REVIEW_REF` repository variable naming one commit of
  the reviewer source repository by its full SHA: the reviewer runs with the app
  key and the Codex login, so it is never fetched from a branch.
  `NOISE_REVIEW_CODEX_AUTH_DIR` points to the private runner's persistent
  subscription login; the credential itself never goes to GitHub secrets,
  caches or artifacts. `NOISE_REVIEW_MODEL` is optional.
  On SELinux hosts, bootstrap that directory with a private `:Z` Docker
  bind mount. The review jail labels its disposable auth, work, verdict
  stub and proxy socket privately too; the persistent login is never
  mounted into the reviewer. Read-only Node, Codex, Go, module cache and
  proxy executable mounts use `:ro,z` because tool installations may be
  shared by jobs. Do not disable SELinux or relabel the entire runner home.
  The credential-free proxy runs in a separate read-only container with
  only its executable and socket directory mounted. The reviewer reuses
  that proxy's Docker-assigned SELinux level so its socket connection is
  permitted without allowing containers to connect to host process domains.
  They still have separate process, mount and network namespaces: only the
  proxy has an external network; the reviewer has only loopback.
  Validate `review-jail.sh --hostile`, `--auth-probe` and its interruption probe on an
  enforcing host with the same mounts as production; hosted Ubuntu CI
  alone cannot prove SELinux access works.
  Missing configuration or a failed review fails visibly and leaves the PR
  open. A separately dispatched exact-head approval still satisfies the gate.
- The contracts README's shipped column is now maintained by the job.
- Adding a harness to the image means adding it to the catalogue; the
  catalogue test fails if a catalogue entry does not match the Dockerfile.

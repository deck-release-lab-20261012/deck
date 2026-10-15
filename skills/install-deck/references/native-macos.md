# Native macOS source installation

Use this path only when the operator explicitly selects native macOS. The backend, tmux and exercised provider must be Darwin processes, not Linux containers or emulated Linux binaries. This procedure targets one trusted operator on Apple Silicon; do not imply qualification of Intel Macs, other providers, confinement or every optional subsystem. A from-source build is not an end-to-end qualification by itself.

Apply the parent skill's public-repository selection, anonymous source checks, exact released-tag binding and origin checks to every source checkout. Never use private cached inputs, an advancing default branch, a local patched tree or credentials to repair a public-source failure. If the selected release lacks this procedure or its native implementation, stop rather than fetching newer helpers separately.

## Agree scope and prerequisites

Deck is not a sandbox: provider sessions and dev servers run as the same macOS user and share the service home. Trusted agents can access that user's files outside the selected projects directory. The projects allowlist constrains Deck's browser APIs, not native processes. Obtain acceptance before installation. Keep the service home, control database, backups and source checkout outside the directory exposed as projects.

Require Darwin arm64, Xcode command-line tools, a native Go toolchain satisfying `go.mod`, the native Node version pinned in the selected `Dockerfile` web-build stage, the pnpm version declared by `web/package.json`, and tmux 3.6a. Confirm actual executable paths and versions. The current native procedure uses tmux 3.6a; an arbitrary `brew install tmux` may install a newer, unqualified behavior contract. Do not replace a user's existing tmux or downgrade global tools. The operator may supply the pinned tmux in a private installation tools directory; otherwise stop for prerequisite setup. Put that tools directory first in the recorded PATH, verify `tmux -V` through that exact PATH, then verify the running dedicated server's `#{version}` after boot; a different interactive-shell tmux is not proof. Use a valid installed UTF-8 locale such as `en_US.UTF-8` and a canonical short temporary directory such as `/private/tmp`; macOS's usual temporary alias and long Unix-socket paths can invalidate native tests.

The selected provider CLI must be an official native Darwin executable at this release's declared pin (`CODEX_VERSION` in the selected Deck `Dockerfile` for Codex), with an account permitting its normal CLI authentication. Do not copy unrelated provider homes, transcripts, settings, hooks, memories, MCP or skills. Provider login belongs to the human; no API key is required for a supported subscription login. A provider's enterprise restrictions are not permission to replace its authentication flow.

For private tmux prerequisite setup, the selected Deck `Dockerfile` declares `TMUX_VERSION`, `TMUX_SHA256` and the public upstream archive URL. An operator can download that archive, verify the declared SHA256 before extraction, and build it into a fresh private prefix without sudo or changing Homebrew's tmux. The tested Darwin build uses libevent, ncurses and utf8proc development libraries, their actual include/library paths, and `./configure --prefix=/absolute/private/tools --enable-utf8proc`, then `make` and `make install`. Obtain missing build dependencies through the operator's package manager separately; do not alter global tools implicitly. Verify the resulting native executable/version and use its private bin directory in the recorded runtime PATH.

Codex additionally requires these two helpers from the **verified selected release**: `deploy/provider-hook/noisedeck-provider-hook` and `deploy/provider-hook/noisedeck-codex-identity-hook`. Their stock receiver locations are `/usr/local/bin/noisedeck-provider-hook` and `/usr/local/bin/noisedeck-codex-identity-hook`. The human installs them as root:wheel, mode 0555, after privately comparing SHA-256 against that checkout. The installer agent must not run sudo, install a sudo policy, overwrite an existing different helper, or change ownership to make a check pass. An identical root-owned, non-symlink, owner-executable helper may be reused. Missing or differing helpers require an explicit operator decision. Do not substitute a custom receiver path while retaining the stock nested callback or native trust hashes.

## Discover before creating anything

Agree the installation root and selected public repository first. Inspect only that root and native Deck process metadata; do not search unrelated projects or provider homes. Enumerate PID and executable names without dumping all process arguments or environments. A process merely named `app` is not Deck. For a candidate `noise-deck` executable, establish its owned verified release path before inspecting that process's launch arguments, owner, birth and loopback listeners. Command-line text or a version-looking name alone is not installation identity.

An installation record outside the projects directory should name the public repository, released tag and commit, absolute source/binary/config/service-home/projects/tmux-socket paths, binary SHA256 and agreed loopback origin. It must contain no password, cookie, provider credential, session token or full environment. It is a locator for independent checks, not evidence that the running process is correct.

If there is an existing record, source/config/state without a complete installation, a stopped selected backend, a process with unknown bindings, or more than one plausible Deck installation, stop and ask the operator to select or reconcile it. Do not create a second installation to avoid ambiguity, replace its state, restart it, or infer permission to upgrade. A stopped native backend may still have live tmux/provider sessions.

For a selected healthy installation, verify the exact public tag, origin, clean tracked source, current binary hash/version, configuration and service-home bindings, numeric runtime UID, exact native executable and process birth, dedicated socket and loopback listeners. Check `/readyz` and anonymous refusal of protected APIs. Privately compare necessary nonsecret configuration fields; never print a whole configuration or process environment. If it is the requested current release, record the same PID/birth, binary/config hashes and state/socket identities before and after and report a no-op. Do not rebuild, launch, provision, sign in, signal, edit configuration or recreate directories. Older, unhealthy, mismatched or unverifiable installations require a new operator decision.

## Fresh source installation

Use an agreed absent installation root under an existing real user-owned parent. Create owner-only service-home, state, tools and backup directories; use fresh source and projects directories, with neither nested inside the other. Resolve aliases before recording paths. Do not chmod or reuse a foreign, symlinked or existing conflicting root. Keep every path absolute, including the configuration path and dedicated tmux socket. Keep the socket path short enough for macOS Unix-domain sockets; stop on a length error rather than using the default tmux socket.

Clone and bind the selected released tag using the parent skill's public source procedure. From that exact checkout, run `pnpm install --frozen-lockfile` in `web/`, then `NOISEDECK_FONTS=free make build VERSION=X.Y.Z` from the checkout root. `make build` stages the production UI into the backend; a plain `go build` is not equivalent. Verify the result's Mach-O arm64 architecture, source commit, clean tracked source and exact non-local version. Build `./cmd/noisedeck-provision` into the private tools directory using this same source.

Install the release-pinned Noise Tasks CLI from the selected public source into the private prefix, not through the root-oriented Linux package/broker installer. Bind its source to the exact `NOISE_TASKS_REF` and version declared by this Deck release, and verify it is clean. The native installation needs the `noise` host, `noise-tasks` plugin and Deck plugin dispatch so `noise tasks` and `noise deck preview run` work from an agent session. Preserve the Tasks CLI's fixed libexec-root contract when building into a private prefix. Do not silently fetch another Tasks release, install a setuid broker or advertise Linux-only worktree/confinement support. Verify actual `noise tasks version`, context and a synthetic project's init/add/read/status before counting the tutorial as supported. A missing or unsupported Tasks path is a first-project tutorial blocker, not an optional skip.

Before any Tasks clone, agree an anonymously readable source: the repository named by the selected release or an operator-selected trusted public mirror at the same exact pinned commit and version. A repository URL in the Dockerfile does not prove public availability; a release may still name a private repository. Record the selected literal `OWNER/REPO` up front and apply the parent skill's anonymous metadata, HTTPS/no-rewrite/no-redirect and exact-commit checks to it. If no reachable public source is selected, stop for an operator decision; never request a token, use a Docker build secret, infer a mirror from the environment or switch sources after a failed clone. After checkout proof, these are the private-prefix build commands, run from the Tasks checkout. Replace `PINNED_TASKS_VERSION` and absolute paths with the release's actual declared version and agreed locations; do not leave placeholders in executed commands:

```sh
CGO_ENABLED=0 go build -trimpath \
  -ldflags '-X github.com/noisefloor-oss/tasks/internal/buildinfo.Version=PINNED_TASKS_VERSION -X github.com/noisefloor-oss/tasks/internal/libexec.Root=/absolute/install/libexec/noise' \
  -o /absolute/install/tools/noise ./cmd/noise
CGO_ENABLED=0 go build -trimpath \
  -ldflags '-X github.com/noisefloor-oss/tasks/internal/buildinfo.Version=PINNED_TASKS_VERSION -X github.com/noisefloor-oss/tasks/internal/libexec.Root=/absolute/install/libexec/noise' \
  -o /absolute/install/libexec/noise/noise-tasks ./cmd/noise-tasks
```

Create the private destination directories before building, then install a copy of this exact Deck build as `/absolute/install/libexec/noise/noise-deck`. The host refuses a plugin symlink escaping its fixed libexec root, so linking it to `source/build/noise-deck` is not equivalent. Verify `noise version`, `noise tasks version` and `noise deck version`, including native architectures. The first two report the Tasks release; the last reports the Deck release. No `noise-setup`, package staging, setuid helper or global installation is needed for this unconfined native prefix.

Run the verified private `noisedeck-provision` executable with no arguments and `HOME` set to the fresh service home. For Codex, make `CODEX_HOME` that same home's `.codex` directory; provisioning writes there regardless of a different `CODEX_HOME`. Do not point it at a person's existing provider home or replace existing settings. Stock hook bytes and the provider's own hook-trust decisions must agree. An unexpected hook-trust modal is a provisioning failure to report, not a question the installer should answer automatically.

Write an owner-only configuration outside source control, substituting the agreed **actual absolute paths and port**:

```yaml
server:
  bind: "127.0.0.1:18082"
  allowed_origins: ["http://127.0.0.1:18082"]
auth:
  mode: "password"
database:
  path: "/absolute/install/state/control.db"
tmux:
  socket_path: "/absolute/install/state/tmux.sock"
  session_prefix: "deck-native-"
projects:
  allowed_roots: ["/absolute/projects"]
taskmaster:
  executable: "/absolute/install/tools/noise"
providers:
  codex:
    executable: "/absolute/native/codex"
    hook_config: "/absolute/install/home/.codex/hooks.json"
```

Darwin selects native Tasks execution automatically; there is no native-Tasks enable flag. The absolute `taskmaster.executable` setting above selects the private Noise CLI. Basic task creation/read/status uses it; PRD model generation is a separate unsupported native operation, not a reason to disable Tasks.

Use the recorded service home, aligned Codex home, private tools/provider paths, valid UTF-8 locale and canonical temporary directory for provisioning, frontend/Go builds, backend start, backup and version probes. Use a clean explicit environment: do not inherit deployment-specific `NOISEDECK_*`, `GOFLAGS`, `GOPROXY`, `GOENV`, `GIT_CONFIG_*`, `GIT_SSL_*`, `NODE_OPTIONS`, `npm_config_*`, API keys or another provider home. Public registry and module downloads declared by frozen lockfiles and `go.sum` are permitted build downloads under the parent skill; do not use private registries, credentials or weaker TLS settings. The same recorded runtime environment must reach tmux and newly launched sessions. Do not change the user's global shell environment. Record a reproducible foreground launch command with these explicit bindings and `noise-deck serve -config /absolute/install/config.yaml`; do not invent an unreviewed background supervisor or install a launch daemon implicitly.

The human starts the foreground process and reads its one-time bootstrap password locally. Do not retain startup logs or retrieve the password through agent tools. An operator-authorized isolated QA harness may handle it privately in memory, but that exception is not part of a normal installer agent's authority. Verify the actual listener belongs to that exact native backend PID, `/readyz` succeeds and unauthenticated protected APIs refuse access. A response on the chosen port is not proof that a newly launched process owns it.

Have the human sign in, save their Git identity, follow the first-project tutorial, authenticate the native provider and complete a harmless task. Verify the resulting file and task state, not an assistant's success statement. Normal native project trust and a one-command approval are distinct from disabling sandbox/approval policy. Do not enable yolo to get a passing result. Keep provider-specific sign-in guidance with its supported contract; this procedure does not certify every provider merely because it is discoverable.

## Maintenance and optional features

Use the selected release's [backup procedure](../../../docs/backup-restore.md): `noise-deck backup -config /absolute/install/config.yaml -dest /absolute/private/backup.db`. Run with the same service environment while the backend is live. Require a new destination and preserve the owner-only credential-sensitive artifact outside projects. Copying only a live SQLite database file is not a WAL-safe backup. Separately preserve configuration and service-home state privately; do not enumerate or print provider credentials.

Only an explicit restart/upgrade request permits signaling the selected backend after verifying its PID/birth. Send SIGTERM to that process, wait for its actual exit, then start the same binary/config/environment. On native macOS, stopping only Deck leaves its tmux/provider and dev-server processes alive. Verify their real PID/birth and session identity before/after, sign in normally and do a second distinct task. Do not send kill-server, terminate providers, reset authentication or restore the database as a restart shortcut. A machine reboot or explicit tmux stop is a different lifecycle. The documented restore command deliberately fences tmux and ends workloads; it is not a no-op or ordinary restart.

For the optional native browser service, use the selected release's frozen `web/` dependencies for both client and server. After dependency installation, run that checkout's `pnpm exec playwright install chromium` from `web/` with an agreed private `PLAYWRIGHT_BROWSERS_PATH`; this downloads the browser revision matching the lockfile. This optional setup permits the pinned Playwright package's browser downloads from `cdn.playwright.dev` and `playwright.download.prss.microsoft.com`, with TLS verification and no custom download-host overrides; otherwise the operator must supply a matching native browser cache. Do not replace a different installed Playwright or browser. Stage an unchanged copy of `deploy/browser-server.mjs` into a fresh private service directory outside projects, and link that directory's `node_modules` to this exact checkout's `web/node_modules` so the script's module lookup finds the pinned client. Check TCP3000 is unused before starting this script with native Node and the same private browser-cache binding. Verify its actual native child executable and loopback-only `127.0.0.1:3000` listener, then connect with the matching client at `ws://127.0.0.1:3000/`. Set `NOISE_BROWSER_WS` to that endpoint in the recorded backend environment before creating sessions; existing sessions do not acquire new environment values. This service is a Playwright endpoint, not a provider browser MCP tool. Stop on startup or connection failure; do not silently switch to a Linux sidecar or another browser installation.

For two-app loopback previews, read [the native configuration](../../../docs/project-app-preview-operations.md#loopback-install). macOS needs operator-provisioned lo0 aliases before binding preview slot addresses. Keep metadata and dev-server ports private; declare project-owned dev commands and strict port binding. Verify access from the actual Mac browser, anonymous refusal, cookie/origin isolation, logout revocation, both apps and native restart behavior. Do not treat an inside-process probe as real ingress proof.

PRD model generation, Linux confinement, setuid worktree brokering and encryption/host-state protection are not certified by this native procedure. State the selected release's actual support or refusal for each optional feature rather than implying parity. Basic Tasks and the first-project tutorial are not in this optional category. Stop on unsupported required behavior and report the exact failing boundary; never replace the native run with Docker or waive a failed gate.

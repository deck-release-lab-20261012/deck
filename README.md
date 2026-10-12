# Noisefloor Deck

Deck is a browser console for running coding agents: it runs unmodified
agent CLIs — Claude Code, Codex, Kimi and others — in tmux sessions on a
Linux host or in Linux containers on a Mac you control, and adds project
organization, durable session
attachment, task boards and recovery controls around them.

**Status: experimental.** Interfaces, file formats and behavior may change
between releases. Releases ship a source archive and Linux binaries with
checksums; there is no published container image — the image is built
locally from this source tree.

Deck is part of [Noisefloor](https://noisefloor.sh). The public repository
is [github.com/noisefloor-oss/deck](https://github.com/noisefloor-oss/deck).
Bugs go to [Issues](https://github.com/noisefloor-oss/deck/issues),
security reports to [SECURITY.md](SECURITY.md). The development model is in
[DEVELOPMENT.md](DEVELOPMENT.md); the license is [MIT](LICENSE).

## What Deck is and is not

Deck is a thin wrapper over the real agent CLIs. A session is a real
interactive CLI running in a tmux pane; the CLI keeps its own conversation
state, rendering, approvals, slash commands and native history. Deck
transports terminal I/O between the browser and tmux, records control
state in SQLite, and observes process continuity — it does not
reimplement the agent.

Deck is for **one operator**. There is no user database, no roles and no
multi-tenancy; authentication protects the single operator's browser
access.

Deck is **not a sandbox**. The Docker Compose deployment is a shared,
unconfined workspace: every session shares one provider home and native
history, the mounted host GitHub CLI configuration, one Unix identity,
one PID/network environment and one tmux namespace. An agent can read
sibling projects, dotfiles and private environments beneath the projects
mount, and may use ambient remote credentials outside its selected
project. A project directory, a session or a container does not isolate
agents from one another.

Deck is also not a hosted service. You run it on hardware you control,
and agent accounts authenticate through each CLI's own native login.

## Requirements

- A Linux host, or an Apple Silicon Mac with a local Linux ARM64 Docker VM,
  with Docker and the Compose plugin (`docker compose`),
  with BuildKit for the local image build.
- An AVX2-class x86-64 CPU, or arm64. The agent CLIs installed into the
  image target AVX2-class x86-64 hosts.
- A host identity file at `/etc/machine-id` (standard on systemd-based
  Linux). The durable data volume binds to that host identity on first
  boot. On a Mac, use the actual IOPlatformUUID in a stable private file
  outside checkout/projects, readable through approved Docker file sharing;
  never invent an identity. Follow the
  [installer skill](skills/install-deck/SKILL.md) for the private capture,
  explicit local Docker context and mount checks.
  `NOISEDECK_HOST_ID_PATH` selects the file's location on hosts that
  store it elsewhere; it is not a way to invent a replacement identity.
- Accounts or subscriptions for the agent CLIs you intend to use,
  authenticated through each CLI's own login flow.

Apple Silicon macOS with Colima has public-source build and browser diagnostics,
not final end-to-end release qualification. Deck still runs as Linux containers;
this evidence does not qualify Docker Desktop, Intel Macs, or native macOS
Deck/provider hook behavior. macOS preview overlays additionally need their
loopback aliases configured by the operator before use.

For a from-source binary build without Docker, see
[Building from source](#building-from-source-without-docker).

## Quick start with Docker Compose

**Installing with a coding agent?** Give it this prompt — it points the
agent at the install skill in this repository:

> Install Noisefloor Deck from its latest release, following
> <https://github.com/noisefloor-oss/deck/blob/main/skills/install-deck/SKILL.md>.

The agent runs the checks and the build; you keep every privileged
decision, including reading the one-time password.

The image builds from pinned public Noisefloor Tasks, SDLC and Visual Diff
sources. No GitHub token is needed.

The minimal commands below assume the Linux defaults fit the host. On macOS,
follow the [installer skill](skills/install-deck/SKILL.md) first for the
private identity file, local Docker context and exact environment-file prefix.
From a source checkout:

```sh
docker compose up --build -d
docker compose ps
docker compose logs app
```

The image is built locally from this tree's Dockerfile; no prebuilt Deck
image is pulled or published. The build downloads its digest-pinned base
images, the version-pinned agent CLIs, and the pinned Noisefloor Tasks,
SDLC and Visual Diff sources named by the `NOISE_*_REPO` build arguments
in the Dockerfile.

The deployment publishes on loopback only. On a new installation the
first boot prints a one-time bootstrap password in its startup output —
read it from `docker compose logs app` and save it — then open
`http://127.0.0.1:18082` and sign in. See [First sign-in](#first-sign-in)
below.

Choose the installation settings before the first build; the checked-in
defaults do not adapt to your host:

- `NOISEDECK_RUNTIME_UID` / `NOISEDECK_RUNTIME_GID` (default `1026:100`):
  the numeric Unix identity shared by the image build, the container
  process, the named-volume seed and the tmpfs mounts. Set both to the
  owner of the host directories mounted below. Choose them before first
  boot: persisted volume ownership and the host-binding receipt make a
  later change a data migration, not an environment-variable flip.
- `NOISEDECK_PROJECTS_HOST_PATH` (default: the checkout itself): the host
  directory mounted as `/workspace`, the projects root. The project
  picker lists only immediate non-dot directories, but agent CLIs can
  read everything accessible beneath the mount, including dotfiles and
  sibling projects. Point it at exactly what you intend to share.
- `NOISEDECK_GH_CONFIG_HOST_PATH` (default `~/.config/gh`): the host
  GitHub CLI configuration, mounted read-write into the shared provider
  home. Sessions inherit this GitHub authentication, and a token refresh
  or `gh auth login` inside a session writes back to the host directory.
  Prepare it writable by the chosen runtime identity.

The Compose file also forwards `ANTHROPIC_API_KEY` into the shared
runtime for task generation when it is set in the invoking shell or
environment file. With no key, task generation falls back to the bundled,
authenticated `claude` CLI. Leave the key unset unless you intend every
session to have that access; exported shell values override the
environment file.

The production-profile example is
[deploy/compose.env.example](deploy/compose.env.example). A local loopback
install needs no environment file if the defaults above fit the host;
keep `NOISEDECK_PUBLIC_ORIGIN` unset. To customize settings, create a
private environment file containing only the overrides you need, rather
than copying the production profile verbatim. Pass it on every command —
`docker compose --env-file <path> up --build -d`. Merely naming a file
`deploy/compose.env` does not make Compose read it, and an environment
file holding credentials belongs outside source control.

Deck, tmux and the agent CLIs run in the same container. Stopping,
replacing or recreating it ends every tmux session and provider process;
the database and provider home persist in the named volumes `deck-data`
and `deck-home`, and project files persist in the host mount, but live
processes do not. Never run `docker compose down -v` unless you intend to
delete those volumes.

Optional variants compose with the base file: a slim image carrying only
Claude Code and Codex (`-f compose.slim.yaml`), an optional Chromium
sidecar for browser automation (`-f compose.browser.yaml`), and derived
images that add project toolchains such as Go or Rust — see
[image variants and derived images](docs/image-variants.md). Every
variant is built locally; none is published as an image.

## First sign-in

Password authentication is the default. On a new installation Deck
stores only an adaptive password hash and an independent session-signing
secret, and discloses the generated password exactly once in startup
output. Save it then: Deck never stores or reprints the plaintext, but
Docker's retained container logs can replay that output, so protect
access to the bootstrap logs. There is no built-in password-change or
recovery flow.

`NOISEDECK_AUTH_MODE` selects `password` (default), `oidc` (sole-operator
Google OpenID Connect), `trusted_proxy` (an authenticating reverse proxy
owns login) or `none` (unauthenticated, admitted only when every declared
browser origin is loopback). There is no fallback between modes:
incomplete configuration of a protected mode fails startup. The base
Compose file does not forward the trusted-proxy settings or a pinned
password hash; those require an operator-written Compose overlay. The
full model — sessions, cookies, CSRF, origin checks and the durable
auth-mode receipt — is documented in
[docs/decisions/authentication-deployment-model.md](docs/decisions/authentication-deployment-model.md).

The tutorial opens on first load. Its **Get started** lessons set up a
first project; **Explore Deck** introduces the other features. Closing
the tutorial saves your place; reopen it with **Show tutorial** in the
global three-dot menu.

To connect GitHub, choose **Connect GitHub** during Git identity setup or
**GitHub connection…** in the global menu. Deck runs the installed GitHub
CLI inside its own runtime — your browser computer does not need it — and
the import flow can browse and search the connected account's
repositories. Git author identity is configured separately. See
[Connect GitHub](docs/github-connection.md). Provider subscription
sign-in remains each CLI's native flow; Deck cannot bypass enterprise
account policy.

## Serving beyond loopback

A deployment reached from other machines goes through your reverse proxy
at its public origin, set explicitly as `NOISEDECK_PUBLIC_ORIGIN`. Deck
never infers trusted origins from forwarded headers; the public origin
becomes the only trusted browser and WebSocket origin and, in OIDC mode,
the base of the exact callback to register with the identity provider
(`<public-origin>/auth/callback`). Cookie security follows the origin:
HTTPS selects Secure `__Host-` cookies, while any HTTP origin selects
non-Secure cookies — use HTTPS beyond loopback. The base Compose file
publishes the port on `127.0.0.1` only; publishing on other addresses
belongs to a deployment overlay you write yourself.

## Fonts

The interface type is a build-time choice. Public builds use the bundled
OFL set — Jost, EB Garamond and IBM Plex Mono — selected by
`NOISEDECK_FONTS=free`, and by the default `auto` when no licensed set is
supplied. An externally supplied licensed set is used only when complete;
licensed and bundled faces are never mixed, and a licensed build, its
images and its caches must stay private. Fonts are compiled into the
image at build time; runtime environment variables cannot change them.
The bundled font licenses ship in
[web/public/fonts/free](web/public/fonts/free); see
[docs/fonts.md](docs/fonts.md) for the filename list and build details.

## Updating

Update the source checkout (`git pull`, or a newer source snapshot) and
rebuild with the same commands and the same environment settings:

```sh
docker compose up --build -d
```

Keep the same runtime UID/GID, host identity and volume bindings — they
are the installation's identity. The control database migrates
automatically at startup, and startup refuses a database it cannot
reconcile. Take a backup before updating (next section).

## Backup and restore

[Backup and restore](docs/backup-restore.md) describes the
operator-tested procedure. Backups are online — the service and every
agent session keep running — and contain control metadata only: projects,
sessions, lifecycle and audit records. Terminal contents, prompts and
transcripts are never stored by Deck, so a backup cannot contain them.
Backups are still credential-sensitive and are written owner-only; keep
them outside project workspaces and source control. Moving to another
host is a cold cutover: stop, back up, and restore on the new host.

## Uninstall and what data remains

`docker compose down` stops and removes the container and the network.
Afterwards, what remains:

- The named volumes `deck-data` — the SQLite control database, the
  password hash, the session-signing secret and the host-binding
  receipt — and `deck-home` — the provider home: agent CLI credentials
  and native session history, hooks and container-local GitHub CLI state.
  Delete them with `docker compose down -v`, or individually with
  `docker volume rm`.
- The host directories you mounted — the projects root and the GitHub CLI
  configuration — which Deck never deletes.
- The locally built images (`deck:local` by default), removed with
  `docker rmi`.

Nothing else is written outside those volumes and mounts.

## Building from source without Docker

```sh
cd web
pnpm install --frozen-lockfile
cd ..
NOISEDECK_FONTS=free make build
./build/noise-deck serve -config configs/config.example.yaml
```

`make build` compiles the production browser UI and embeds it in the
backend binary; a plain `go build` serves a `503` at `/` until the UI has
been staged. The build needs Go with cgo and a C toolchain, Node, pnpm
and Make; check [configs/config.example.yaml](configs/config.example.yaml)
against your local paths before starting. Running the binary also
requires tmux and the agent CLIs themselves on the host — the binary
installs neither.

For frontend development, `make dev` runs the backend and the
hot-reloading UI together; open `http://127.0.0.1:8837/__dev/` through
the backend. Its default local mode has no sign-in and admits only
declared loopback origins — do not expose it as a public server. Use
`NOISEDECK_AUTH_MODE=password make dev` to develop against authenticated
mode: sign in at `/`, then open `/__dev/`.

## Project app previews

For a loopback install, run
`docker compose -f compose.yaml -f compose.previews.yaml up -d` to enable
private project previews without DNS or TLS. Enable a preview in the project
menu, start its declared dev server with `noise deck preview run`, then choose
**Open preview**. Each app opens on its own loopback address, such as
`http://127.0.0.2:8840`, with support for assets, routes, APIs and WebSocket hot
reload. Use a browser on the same machine; Linux supports the addresses by
default, while macOS needs loopback aliases.

Hosted installs need one-time operator configuration of a separate preview
domain, HTTPS ingress and local app endpoints; see
[Private previews of project apps](docs/project-app-preview-operations.md).
Dev servers remain part of the unconfined workspace — previews do not
sandbox them.

## Project tasks

Task boards are driven by the bundled Tasks engine, not by Deck itself.
The image pins Tasks v2.7.0 at commit
`eb6581096fa21d5ad40aaa326cfeff2e4fab7fc5` and uses `noise tasks` as its
canonical CLI. Deck discovers each project's task state through the
engine's versioned, read-only `noise tasks context --json` schema 5
contract, and the only task-state authority is the repository-family
SQLite store at `<git-common-dir>/noise-tasks/tasks.sqlite` — linked
worktrees of one repository share current revisions and claims, and no
file inside a worktree is task state. A task family whose one-way
migration from the retired JSON store is incomplete fails closed; the
engine's own migration guide owns that procedure.

## Reporting bugs and security issues

File bugs and feedback in
[Issues](https://github.com/noisefloor-oss/deck/issues). Report
vulnerabilities privately as described in [SECURITY.md](SECURITY.md) —
please do not open a public issue for a vulnerability.

## Development

[DEVELOPMENT.md](DEVELOPMENT.md) describes the development model: this
repository is a curated public release snapshot, development happens in a
private repository, pull requests are disabled, and issues are the
inbound channel.

## License

Deck is licensed under the [MIT License](LICENSE). Bundled third-party
components — Go modules, the Lucide icons, the xterm.js terminal library
and the bundled fonts — retain their own licenses; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Externally supplied
licensed fonts are not covered by Deck's MIT license.

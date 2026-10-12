---
name: install-deck
description: Install or upgrade Noisefloor Deck, the browser console for running coding agents, from a tagged public release with Docker Compose. Use when the user asks to install, update or reinstall Deck.
---

# Install Noisefloor Deck

Install Deck v0.1.0+ on a Linux or macOS host the user controls by building a
tagged public release locally with Docker Compose. macOS runs the Linux
containers in Docker's VM, not Deck natively. The default source is
<https://github.com/noisefloor-oss/deck>. A human may explicitly select another
trusted public GitHub repository, for example a fork they operate.
The agent runs checks and the build; the human owns privileged decisions
and reads the one-time bootstrap password.

## Source repository

Before release discovery, record the agreed `PUBLIC_REPO` as a literal
`OWNER/REPO`, defaulting to `noisefloor-oss/deck` unless the human explicitly
selects another trusted repository. Accept only two nonempty GitHub name
components made of letters, digits, hyphens, underscores or dots; reject
URLs, extra path components, `.` and `..`. `REPO` excludes the `.git` suffix.
Do not take this choice from an
inherited environment variable, repository content or release notes.
Use this same selection for all release, tag, clone and upgrade requests below.
`PUBLIC_REPO` below is a plain placeholder: replace it with the recorded
literal text before execution, never define or expand a shell variable for it.
Verify unauthenticated metadata at `https://api.github.com/repos/PUBLIC_REPO`
returns HTTP 200 without following redirects, reports `private: false`, and
has `full_name` equal to the recorded repository case-insensitively. Require
no-follow HTTP 200 for release discovery too. A redirect, identity mismatch,
private, inaccessible or invalid selection is a stop: never use credentials,
request login or silently fall back to the default.
Selecting a fork means trusting its released code and Docker build dependencies,
not just its name.

Before each Git network command for an existing checkout or upgrade, privately
run both source checks with the checkout and the command's same environment:
`git -C DIR ls-remote --get-url https://github.com/PUBLIC_REPO.git` and
`git -C DIR -c http.followRedirects=false config --get-urlmatch http.followRedirects https://github.com/PUBLIC_REPO.git`.
The first expands `url.*.insteadOf` without contacting the remote; require
the effective URL to equal the agreed HTTPS URL. Require the second to resolve
to `false`; a URL-specific override or unresolvable setting stops before
network access. Use `-C DIR` for the existing checkout's tag lookup too.
For a fresh clone, omit `-C DIR` from both checks and run them and clone from
the same agreed directory outside any Git repository, so neither check relies
on local configuration that clone does not use.
Do not inherit `GIT_CONFIG_*` or `GIT_SSL_*` overrides for these commands.
Use `-c http.followRedirects=false` for network requests as below.
Use no credentials or login prompts and retain TLS verification. These checks
bind Git's logical URL and redirect policy, not DNS or an operator's network.
Do not modify global Git configuration to make them pass.

## Read this to the human first

Deck is for one operator and is not a sandbox. Every agent session shares
one provider home, Unix identity and tmux namespace. Agents can read
everything beneath the projects mount, including sibling projects and
dotfiles. Say this before running anything; stop if the user does not accept it.

Require these host checks:

- Linux (`uname -s` is `Linux`): AVX2-class x86-64 (`uname -m` is `x86_64`
  and `grep -qw avx2 /proc/cpuinfo` succeeds), or arm64 (`aarch64`).
- macOS (`uname -s` is `Darwin`): Apple Silicon (`uname -m` is `arm64`)
  and a Linux ARM64 Docker server. Do not silently select amd64 emulation;
  STOP on other Mac architectures until separately qualified. Other OSes: stop.
- The user's explicitly selected Docker context `CONTEXT`, pointing at the
  intended host. Use `docker --context CONTEXT` for every Docker command,
  including discovery, build, health, backups and upgrade. Never change the
  global default context. This skill supports only a local engine or a
  local Docker VM. Check
  `docker --context CONTEXT context inspect CONTEXT --format '{{.Endpoints.docker.Host}}'`:
  require an agreed local Unix socket. For `ssh://`, `tcp://` or another
  remote endpoint, stop and run the skill on the daemon's actual host;
  local UUIDs and bind paths must not identify a different machine.
  `docker --context CONTEXT version`, `docker --context CONTEXT compose version`
  and `docker --context CONTEXT buildx version` must answer. Otherwise stop
  and refer the user to Docker's instructions; never install or start Docker.
  Check server OS/architecture with
  `docker --context CONTEXT info --format '{{.OSType}} {{.Architecture}}'`:
  require `linux` and the matching architecture (`aarch64`/`arm64` on arm64
  Linux or Apple Silicon; `x86_64`/`amd64` on x86-64 Linux).
- Linux: a readable nonempty `/etc/machine-id`. If absent, stop; never
  invent one. `NOISEDECK_HOST_ID_PATH` may select an existing real host
  identity stored elsewhere.
- macOS: agree a stable private `HOST_ID_PATH` outside checkout/projects,
  with an existing parent and access agreed by the user. Defer capture until
  a public checkout is bound to the selected tag; a raw `SKILL.md` download
  does not supply local helpers. The
  [helper](scripts/macos-host-id.sh) uses stock macOS tools, prints no UUID,
  requires exactly one valid UUID, creates an absent file exclusively with
  mode 600, and privately compares an existing file without replacing it.
  It refuses symlinks, nonregular files, foreign ownership or nonprivate
  existing permissions; do not change them to bypass refusal.
  If the selected tag lacks this helper, stop: that release does not support
  this Mac installation procedure. Never fetch an unpinned default-branch
  script to fill the gap. Set `NOISEDECK_HOST_ID_PATH` to the agreed file. It must
  be readable by the chosen runtime UID/GID through Docker's approved file
  sharing. If not, stop for the user to resolve that path; do not use sudo,
  widen sharing, change unrelated permissions or substitute another identity.
  Preserve it across upgrades and Docker VM restarts.

## Never

- Run `sudo` or pass a password anywhere.
- Read, store or repeat the bootstrap password through tools: their output
  is retained in transcripts. Give the human the exact logs command instead.
- Dump full container environments, Compose configuration or provider homes;
  these may contain credentials. Inspect only necessary labels, mounts,
  image, user, health, port and nonsecret settings/version fields.
- Run `make package` on the host. The approved packaging path is the Docker build.
- Run `docker --context CONTEXT compose down -v`, delete/reset/change ownership
  of/hand-edit `deck-data`, `deck-home`, or the host directories Deck mounts.
- Widen the loopback bind, set `NOISEDECK_PUBLIC_ORIGIN`, change
  `NOISEDECK_AUTH_MODE`, runtime UID/GID, host identity or volume bindings
  of an existing installation.
- Make network calls beyond the agreed `PUBLIC_REPO` public repository/release endpoints,
  image-build downloads and loopback status probe; bypass a failed check;
  or fall back to another tag, commit or artifact.

## Discover and select

1. **Find existing Deck installations before cloning.** In `CONTEXT`, search
   all Compose projects, including stopped containers:
   `docker --context CONTEXT volume ls --filter label=com.docker.compose.volume=deck-data --format '{{.Name}} {{.Label "com.docker.compose.project"}}'`
   and the same for `deck-home`; then
   `docker --context CONTEXT ps -a --filter label=com.docker.compose.service=app --format '{{.ID}} {{.Label "com.docker.compose.project"}}'`.
   Group Deck-labelled volumes by project. A candidate app must have the
   same project label and mount that project's `deck-data` at `/data` and
   `deck-home` at `/home/agent`. Inspect mounts without environment output:
   `docker --context CONTEXT inspect --format '{{json .Mounts}}' APP_ID`.
   An unrelated `service=app` container with
   neither Deck volume is not an installation or ambiguity; ignore it even
   if stopped. A Deck volume without its partner, missing project labels,
   no matching app or mismatched mounts means a partial installation:
   stop and reconcile with the user, never create replacement volumes.
   Multiple Deck projects require the user to select one. For a complete
   match, record container IDs and recover its checkout, private environment
   file, project name and ordered overlays with the user. Continue with
   Existing installation; do not build, restart or upgrade yet.
2. **Pick the release.** Use the latest published stable `vX.Y.Z` from the
   selected repository's `https://github.com/PUBLIC_REPO/releases` page or
   `https://api.github.com/repos/PUBLIC_REPO/releases/latest`.
   Ignore drafts/prereleases and read the notes. A newer release does not
   itself authorize upgrading an existing installation.
3. **Bind the public tag to its exact commit.** Release `target_commitish`
   may name a branch, not the released commit. Query
   `git -c http.followRedirects=false ls-remote https://github.com/PUBLIC_REPO.git 'refs/tags/vX.Y.Z' 'refs/tags/vX.Y.Z^{}'`.
   Prefer the annotated tag's `^{}` line, otherwise the lightweight tag line.
   Require one nonempty 40-character commit SHA; the checkout's
   `git -C DIR rev-parse HEAD` must equal it. Mismatch: stop.

## Fresh install

Proceed only when discovery found no Deck installation or partial Deck volumes.

1. **Agree an absolute fresh checkout directory `DIR`**, never inside an existing project.
   The checkout defaults to the projects mount, so its location matters.
   `git -c http.followRedirects=false clone --branch vX.Y.Z --depth 1 https://github.com/PUBLIC_REPO.git DIR`.
   Repeat the tag binding and Origin checks below there before building or
   running helpers. On macOS, only after that proof, run
   `sh DIR/skills/install-deck/scripts/macos-host-id.sh HOST_ID_PATH` before
   creating the environment file or building. Require the helper to exist
   in this selected-tag checkout; if absent, stop as unsupported for Mac.
2. **Agree settings once before first boot.** Changing them later is a
   migration, not an edit. Use an absolute private environment-file path
   `ABS_ENVFILE` outside checkout and source control.
   Set `NOISEDECK_RUNTIME_UID` / `NOISEDECK_RUNTIME_GID`
   from actual mounted-directory ownership and Docker sharing behavior;
   do not assume the image default `1026:100` suits the host. Set
   `NOISEDECK_PROJECTS_HOST_PATH` to exactly what agents may read, and
   `NOISEDECK_GH_CONFIG_HOST_PATH` to the agreed GitHub CLI directory;
   sessions inherit that login and write back to it. Set
   `NOISEDECK_BUILD_VERSION=X.Y.Z` and `NOISEDECK_IMAGE_TAG=X.Y.Z` (no `v`)
   rather than reporting version `local`; set `NOISEDECK_HOST_ID_PATH` on
   macOS. Record `NOISEDECK_HOST_PORT` if using a port other than the default
   `18082`; preserve it in every probe and existing-install comparison.
   Leave `ANTHROPIC_API_KEY` unset unless all sessions should receive it,
   and `NOISEDECK_PUBLIC_ORIGIN` unset.
3. **Preserve the exact location-independent Compose prefix:**
   `docker --context CONTEXT compose --project-directory DIR --env-file ABS_ENVFILE -p PROJECT -f DIR/compose.yaml [-f ABS_OVERLAY ...]`.
   `DIR`, `ABS_ENVFILE` and every overlay path must be absolute; quote paths
   containing whitespace. Never assume a `cd` persists between tool calls.
   `PROJECT` is the matched/agreed project name (`deck` by default); preserve
   overlay order. Every Compose operation, including human log retrieval,
   uses this prefix, called `PREFIX` below. A different prefix can select
   different volumes or silently render defaults. Optional
   `compose.slim.yaml`, `compose.browser.yaml`, `compose.previews.yaml` are
   the user's choice; see [docs/image-variants.md](../../docs/image-variants.md).
   Previews publish 127.0.0.2–9:8840; macOS needs all those loopback aliases
   first. If absent, ask the user to configure them separately or omit
   previews; this skill does not authorize privileged network changes.
4. **Build and start:** `PREFIX up --build -d`. This builds the release's
   pinned public sources/dependencies; no GitHub token is needed for the
   public source build and no prebuilt Deck image is pulled. Wait for
   `PREFIX ps` to report app healthy, then check
   `PREFIX exec -T app /usr/local/bin/noisedeck version` equals `X.Y.Z`.
   Health/version checks are not proof that a real provider task succeeded.
5. **Hand over first sign-in.** Give the human `PREFIX logs app` to run
   themselves and read the one-time bootstrap password. Never retrieve
   startup logs through your tools. They open the recorded loopback port
   (default `http://127.0.0.1:18082`) and sign in. You may confirm HTTP status
   without credentials using
   `curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:PORT/`.
   Retained Docker logs can replay bootstrap output. Do not promise password
   recovery/change features beyond the selected release's documentation.
6. **Before first use**, have the human review README Quick start settings
   and walk the tutorial's Get started lessons. Provider authentication
   remains in each real CLI. Serving beyond loopback requires a deliberate
   operator deployment behind a reverse proxy, outside this skill.

## Existing installation

Resolve the selected repository's latest stable public tag and commit without
changing the existing checkout or deployment. Establish its exact checkout, private environment
file, Docker context, project name and ordered overlays; never infer these
from a generic `app` label. Require the checkout's origin to identify the
agreed public repository using Origin checks below; an unknown or different origin is a stop, not
permission to change it or switch source repositories. Use the same
location-independent `PREFIX` above,
with the existing absolute checkout, environment-file and overlay paths for
every read-only check, human logs command and authorized upgrade.
Require HEAD to match the tag and tracked files
to be clean. Privately read only the agreed environment file's nonsecret
installation fields: build/image version, runtime UID/GID, host identity path,
projects/GitHub paths and host port. Account for same-named shell overrides
without printing their values. On macOS require the existing identity file
to be a readable regular file, then privately compare it using
`sh DIR/skills/install-deck/scripts/macos-host-id.sh HOST_ID_PATH` from this
tag-bound checkout. A missing helper means this release's Mac procedure is
unsupported; a missing identity file is a stop, never a no-op creation.
Linux no-op checks require no Mac helper. Compare against actual container mounts and
runtime user/port bindings using these fixed, credential-free selections:

```
docker --context CONTEXT inspect --format '{{json .Mounts}}' APP_ID
docker --context CONTEXT inspect --format '{{json .Config.User}} {{json .HostConfig.PortBindings}}' APP_ID
docker --context CONTEXT inspect --format '{{range .Config.Env}}{{if eq (index (split . "=") 0) "NOISEDECK_AUTH_MODE"}}{{println .}}{{else if eq (index (split . "=") 0) "NOISEDECK_SERVER_ALLOWED_ORIGINS"}}{{println .}}{{else if eq (index (split . "=") 0) "NOISEDECK_PROJECTS_ALLOWED_ROOTS"}}{{println .}}{{end}}{{end}}' APP_ID
```

Require the exact Deck volume pair, `/workspace` and GitHub bind paths, the
read-only host identity bind, agreed UID/GID and loopback host port to match.
Require exactly one line for each of the three selected environment keys.
Compare their resolved values with this tag's Compose app environment under
the exact prefix and agreed overrides, including defaults; an absent override
is not an absent runtime setting. Do not compare literal `${...}` interpolation
text against resolved values or invent a replacement extraction template.
Require stock password mode and the agreed loopback origins and project roots;
missing/mismatched fields stop, never authorize altering settings. Verify the ordered Compose
files belong to the tag and recover the original prefix from the user if it
is not known. Do not emit the environment file, full `docker inspect` or
rendered `PREFIX config`; this comparison needs no jq or host Python.

When everything matches, `PREFIX ps` reports app healthy and
`PREFIX exec -T app /usr/local/bin/noisedeck version` returns exactly `X.Y.Z`,
confirm the loopback page answers, recheck that the recorded container IDs
are unchanged and report an existing-current-release no-op. Do not run `up`, `build`,
`pull`, `restart`, `down`, provisioning or provider sign-in. Image tags and
release metadata alone are not running-version evidence. `/api/build` requires
authentication in password mode; do not retrieve credentials/logs to query it.

Older release, unhealthy installation, mismatched evidence or unknown
prefix/settings: report the finding and stop for the user's decision.
An install request does not implicitly authorize upgrading, restarting,
reinstalling or migrating an existing installation.

### Origin checks

Perform the `-C DIR` source checks above before any tag lookup or fetch.
Privately read both `git -C DIR config --get-all remote.origin.url` (raw)
and `git -C DIR remote get-url --all origin` (effective, expands `insteadOf`).
Require exactly one of each, in the form `https://github.com/OWNER/REPO`
with optional trailing `.git`, matching the agreed host and repository
case-insensitively. No userinfo, query, fragment or extra path is accepted;
SSH and other non-HTTPS forms are not accepted. Never print raw/effective
values: a rejected origin may contain credentials. A match binds the
configured origin, not what a prior
clone downloaded; release metadata, no-redirect Git requests and exact tag/HEAD
proof remain required. Never rewrite an origin to satisfy these checks.

## Explicit upgrade

Only after the user's go-ahead, use the existing clean checkout and select
the new public tag from the same agreed repository after both `-C DIR` source
checks above, including before the repeated tag lookup
(`git -C DIR -c http.followRedirects=false fetch https://github.com/PUBLIC_REPO.git tag vX.Y.Z`,
then `git -C DIR checkout vX.Y.Z` and
repeat tag binding). Preserve the context, environment file, project name,
ordered overlays and all installation identity/mount settings. On macOS,
repeat Existing installation's private identity comparison using the helper
from the new tag before building; absent helper or identity file is a stop,
never permission to regenerate an existing installation's identity. Update only
`NOISEDECK_BUILD_VERSION` and `NOISEDECK_IMAGE_TAG` in the environment file.
Take a backup using README's Backup and restore guidance with the same
Docker context and installation bindings. Let the human choose the moment:
container recreation ends live tmux/provider processes; persistent volumes
are not a promise of uninterrupted sessions. Then use the same build/start,
health/version and human sign-in checks. Never delete volumes to recover.

## If anything fails

Stop and report the failing check without secrets or startup logs. Do not
weaken loopback binding/authentication, invent identity, change unrelated
Docker resources or silently choose another artifact to get past it.
An incorrectly constructed read-only probe (for example, a relative Compose
path in another tool's working directory) may be corrected to the verified
absolute prefix and rechecked. This fixes the invocation, not a failed host,
settings, health or version prerequisite; those failures still require a stop.

# Noisefloor production deployment

Noisefloor production is one indivisible capability profile: a Go-derived
image over the MemPalace image, the durable palace bind, the Chromium sidecar,
Google OIDC, the production host fingerprint, and the reviewed publish address. The
canonical operator entry point is `deploy/production-compose.sh`; direct
`docker compose` commands are diagnostic only.

The command always renders these files in this order:

1. `compose.yaml`
2. `compose.mempalace.yaml`
3. `compose.go.yaml`
4. `compose.go-mempalace.yaml`
5. `compose.browser.yaml`
6. `compose.production.yaml`

The final overlay requires every production value and labels the resulting
container as `production-v1`. A preflight rejects password authentication, a
Go layer not rooted in this deployment's build-ordered MemPalace target, a
missing palace bind, a detached Chromium network namespace, an empty host
fingerprint, or an inexact OIDC callback before any container is changed.

Production `/tmp` is a required disk-backed bind mount. Provision the path in
`NOISEDECK_TMP_HOST_PATH` before running the command; it must already exist,
must not be on tmpfs or ramfs, and must permit writes and execution by the
configured runtime identity. The Noisefloor host uses a dedicated 32 GiB disk
filesystem mounted at that path. Preflight fails before mutation if the path is
missing, RAM-backed, read-only, or mounted `noexec`; runtime certification also
creates and executes a probe inside the container.

Keep the owner-only `deploy/compose.env` populated from
`deploy/compose.env.example`. Production requires all OIDC values and
`NOISEDECK_PUBLISH_ADDRESS`; the latter is the address reached by the reverse
proxy, not a value inferred from the public origin. The pinned tooling sources
are public; the production Compose build needs no GitHub token.

For licensed fonts, set `NOISEDECK_FONTS=licensed` in the private env file
so a missing asset set fails instead of silently using free fonts. Export
`NOISEDECK_LICENSED_FONTS_DIR=/absolute/private/fonts` in the operator shell
for every wrapper invocation. The directory must contain the complete
licensed asset set described in [Fonts](fonts.md), outside the checkout.
The wrapper then appends `compose.licensed-fonts.yaml` and
`compose.go-licensed-fonts.yaml`, supplying the private build context to
both `app` and `go-base`. Setting the directory in the env file alone does
not select these overlays; it must be exported to the wrapper. Keep the
resulting image and build cache private. With no directory exported, the
six-file build graph is unchanged.

Validate the effective profile without changing the stack or printing its
secret-bearing rendered environment:

```sh
deploy/production-compose.sh deploy/compose.env config
```

Build the complete image and browser sidecar without recreating production.
The wrapper supplies the MemPalace service build directly to the Go
Dockerfile as a named context, so both are resolved by one builder graph and
no intermediate local image is required:

```sh
BUILDX_BUILDER=noisefloor-builder \
  deploy/production-compose.sh deploy/compose.env build
```

Deploy and certify in one command. Name every BuildKit builder used by the
build; cache cleanup is unreachable until certification succeeds:

```sh
BUILDX_BUILDER=noisefloor-builder \
  deploy/production-compose.sh deploy/compose.env deploy \
  default noisefloor-builder
```

Before building, the command tags the running image with a timestamped
`deck:rollback-pre-production-*` name. It then builds the full profile,
recreates `app` and `chromium` together, waits for health, and verifies:

- the running production profile label and Chromium network namespace;
- a writable, executable, non-RAM-backed production `/tmp`;
- MemPalace 3.10.0, its durable writable store, MCP response, and the Claude,
  Codex, Kimi, OpenCode, Pi, and OMP integration surfaces;
- Go 1.26.9 at `/usr/local/go/bin/go`, reachable through a login shell,
  locked to the local toolchain, non-writable by sessions, with a C compiler;
- a real Playwright connection and rendered Google sign-in page with no
  password field; and
- public OIDC session and Google redirect behavior.

Only after all checks pass does it invoke the scoped BuildKit cache cleanup.
On any failure it retains cache evidence, returns nonzero, and does not claim
certification. `apply` is available for an already-built, explicitly tagged
image and performs the same recreation and certification; `verify` is a
non-mutating recertification of the running stack.

## Optional external relay

`NOISEDECK_RELAY_MODE` defaults to `local`. `external` suppresses only the
relay server on 8766, never the private memory server on 8765. It requires
`NOISEDECK_RELAY_TOKEN` and an authenticated MemPalace 3.10.0 initialization
before Deck starts. An unavailable external relay never starts a local writer.
The existing client URL and owner-only bearer file remain unchanged.

For the production wrapper, export `NOISEDECK_RELAY_SSH_DIR` pointing to a
root-owned mode-0700 directory outside all app mounts. It must contain
owner-only `config`, `known_hosts`, and `id_ed25519` files. The wrapper appends
`compose.relay-tunnel.yaml`, selecting external mode, and recreates the tunnel
with every app replacement. Setting this directory only in compose.env does
not select the overlay. Retain the export for every subsequent deployment.

The SSH config defines `Host relay`, its `HostName`, `User`, and optional
`Port`. Pin the host key from a separately authenticated channel; never use
automatic host-key acceptance. Authorize a dedicated forwarding-only key on
that account: use `restrict,port-forwarding,permitopen="127.0.0.1:18766",command="/usr/bin/false"`
to deny commands, PTY, agent forwarding, X11 and other local-forward destinations.
Prefer a dedicated account with server-side `AllowTcpForwarding local`: the
authorized-key restrictions alone do not deny reverse forwarding. On a shared
account, reverse forwarding remains subject to that host's SSH policy; do not
claim the key has a stronger boundary. Do not reuse an operator's key.
The key is mounted only into the restricted SSH sidecar, not Deck. SSH uses
keepalives and exits on failure; Docker restarts it. A host restart must also
restart the remote container/VM and the SSH service.

The remote relay must run the same MemPalace version with the same bearer,
its own durable relay-only directory, and a host publication on
`127.0.0.1:18766` only. It must never receive the private palace, provider
homes, or `.a2a/host-key`. Keep that key on Deck. Within Deck's network
namespace the tunnel listens on 8766 on the container interface so the existing
host-loopback publication and filtered peer sync proxy keep working. This
requires bearer authentication at the remote server; publish neither 8766
nor 18766 on a public or LAN interface. The private memory server is never
forwarded. Remote reachability to existing relay peers must be tested too.

Cutover is an operator procedure, not automatic failover:

1. Test the remote service and tunnel using a disposable relay and synthetic
   events. Prove correct-token access, wrong/missing-token refusal, tunnel
   reconnect, and no shell/unauthorized forwarding with the dedicated key.
2. Build and review the exact release, record both image digests, and back up
   operator configuration. Stop the source app through the deployment's
   maintenance procedure; stopping only its relay child is insufficient
   because bootstrap restarts it. Confirm the source writer is gone.
3. Back up and copy only the stopped relay directory, preserving permissions
   and comparing checksums without printing content. Start exactly one remote
   writer. Keep the source copy frozen. Preserve peer settings and verify the
   remote host can reach their approved endpoints; do not disable peer sync
   silently. Historical unsealed data, if present, stays private to the owner.
4. Apply with the SSH-directory export and the normal production wrapper.
   Verify authenticated MCP, the sidecar's current app namespace, peer sync,
   a synthetic a2a round trip and the private memory endpoint. Confirm no local
   relay process exists. Inspect no real chat bodies to perform these checks.
5. Observe source CPU/temperature after cutover and record the outcome.

Rollback: stop Deck and the tunnel, stop the remote writer, then copy its
latest stopped state back if any writes occurred. Restore the local-mode
configuration, explicitly retire the stopped tunnel, and apply the retained
image through the wrapper. Never restart the stale source while the remote
writer is active. A network outage leaves chat unavailable, not split-brain.

## Optional private preview ingress

For a deployment using the Cloudflare preview connector, also export
`NOISEDECK_PREVIEW_TUNNEL_TOKEN_FILE` to its protected absolute host path for
every wrapper invocation. This adds `compose.preview-tunnel.yaml`, recreates
the connector with the app, and verifies its namespace attachment. Keep any
licensed-font opt-in exported too. A token path only in `compose.env` does not
select the overlay. Omitting it while a connector exists refuses deployment,
including when the app is stopped or absent.

DNS credentials stay on the host, outside all app mounts. Exact-record setup,
the reconciler timer, public HTTPS verification and explicit connector retirement
are documented in [Cloudflare preview operations](project-preview-cloudflare.md).

## Sidecar DNS on SELinux hosts

Chromium and the optional preview connector mount the non-secret
`deploy/sidecar-resolv.conf` read-only, with a shared SELinux file label (`z`).
Their process labels remain separate. This avoids Docker's generated app resolver:
`docker cp` can relabel that shared file privately for the app, causing sidecar
DNS to fail with permission denied even though the network namespace is correct.
Do not disable SELinux, share process labels, or relabel project data to fix DNS.

The checked-in file uses [Docker's embedded resolver](https://docs.docker.com/engine/network/#dns-services), `127.0.0.11`, for Compose's
user-defined network. It retains Docker's upstream forwarding and container-name
resolution, rather than bypassing the host's DNS with a public resolver. It is
not a configuration for host networking or the legacy default bridge. If an
installation overrides that topology or needs custom search domains/options,
provide a dedicated non-secret resolver file through a Compose override while
retaining the read-only bind, `create_host_path: false` and shared `z` label.
Never point that bind at the app's Docker-managed resolver. The host preflight
rejects a missing, symlinked or non-world-readable resolver before recreation.

On SELinux hosts, provision the file's actual `container_file_t:s0` label
before preflight. [Compose issue 13396](https://github.com/docker/compose/issues/13396)
means `create_host_path: false` can send the mount through an API that ignores
`selinux: z`. Preflight therefore checks the host label, not just the YAML.
For each immutable release, register only its non-secret resolver path with
`semanage fcontext -a -t container_file_t '<escaped-absolute-resolver-path>'`,
then run `restorecon -v <absolute-resolver-path>`. The first argument is an
SELinux path regex: escape metacharacters (including the dot in `resolv.conf`)
and do not use a broad directory rule. If an exact rule already exists, inspect
it before updating it with `-m`. This requires host administrator authority;
the wrapper never relabels files itself. Repeat provisioning for each new
release path, and do not relabel the application resolver or any private data.

The normal production verifier now navigates to the public OIDC login from
Chromium using its own DNS and TLS validation, as well as testing local browser
connectivity. Before qualifying this fix on an enforcing SELinux host, build the
normal browser image and run:

```sh
sudo python3 deploy/sidecar-dns-acceptance.py --image noise-browser:1.62.1
```

This creates only disposable containers, a network and synthetic files. It
reproduces the old failure, then verifies DNS after repeated `docker cp`, exec,
health checks and full recreation. Separate SELinux process labels and refusal
of an unrelated container's read of a private test file are checked as well.
It refuses a non-enforcing host rather than reporting a skipped pass. No
application volumes, credentials or user projects are mounted into the probe.

That disposable probe exercises Docker's volume API, not Compose's Mount API;
it does not certify Compose's automatic labeling. Complete qualification with
the actual production wrapper and the host-file preflight above. The live
browser must load the public login through ordinary DNS and verified TLS.
Repeat after a metadata-only `docker cp` from the app and a fresh health check;
confirm the resolver retains `container_file_t:s0` and process labels remain
distinct. No IP override or proxy workaround qualifies that check. The login
probe waits for visible sign-in UI because DOMContentLoaded precedes hydration.

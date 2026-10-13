# Private previews of project apps

An agent runs `noise deck preview run` to start the project's declared dev server. Choose **Open preview** in that
project's menu to open it in a separate tab. Edits and hot reload go directly
through the dev server; they do not require rebuilding Deck.

This feature protects browser access. Server processes still share the
unconfined workspace and must be trusted. It does not restrict their filesystem
or network access. Use a separately isolated host environment for hostile
server processes. The `unconfined: true` setting acknowledges this boundary.

## Loopback install

For Deck opened at `http://127.0.0.1:<port>` or `http://localhost:<port>`,
enable previews without DNS, TLS or a reverse proxy. Satisfy the host
prerequisites below before starting the Docker overlay. With Docker:

```sh
docker compose -f compose.yaml -f compose.previews.yaml up -d
```

The overlay publishes eight gateway slots on `127.0.0.2` through `127.0.0.9`,
all on port 8840. It does not publish dev-server ports. Linux routes these
addresses to loopback by default; macOS needs an alias on `lo0` for each
slot address. With Colima, also satisfy the
[forwarding prerequisite](#macos-with-colima-forwarding-prerequisite); aliases
alone do not prove Docker VM forwarding. If overriding the port pool, keep
its size equal to the number of published slots.

For a native installation, set these four keys and restart Deck:

```yaml
project_previews:
  loopback: true
  unconfined: true
  port_min: 15000
  port_max: 15007
```

Leave `bind` and `deck_origin` empty; `loopback_port` defaults to 8840.
Deck listens on each slot address directly. All `server.allowed_origins`
must be loopback HTTP origins, authentication must be enabled, and this mode
cannot be combined with `base_domain`, `hostname_prefix` or static `targets`.

Open the project's menu, choose **Preview…**, then **Enable preview**.
Declare the project's dev command and configure its server to consume the
assignment as described in [Project-owned dev command](#project-owned-dev-command).
From a Deck session in that project directory, start it with:

```sh
noise deck preview run
```

Choose **Open preview** in the project menu. The address looks like
`http://127.0.0.2:8840`; each project gets a distinct loopback address so its
cookies stay separate from Deck and other previews. Open it in a browser on
the Docker host or native Deck machine: loopback addresses in a remote browser
point to that browser's own machine. See the
[loopback design](project-app-preview-loopback.md) for the browser cookie and
origin rules.

The sections following the Colima loopback prerequisite describe the hosted
(domain) setup. The project-owned dev command and Vite example also work
with loopback previews.

## macOS with Colima: forwarding prerequisite

Mac `lo0` aliases are necessary but may not be sufficient for Docker VM
forwarding. With Colima 0.10.3 / Lima 2.2.0, the default
`network.hostAddresses: false` left the preview aliases unreachable from the
Mac even though Docker published all eight exact addresses and the gateway
answered inside the VM. This is a host/VM prerequisite failure, not proof of
an authentication failure. Other providers, including Docker Desktop, need
their own real-host checks; this procedure does not qualify them.

For a dedicated, explicitly selected Colima profile, the supported repair is
`network.hostAddresses: true` with `network.address: false`. Have the operator
configure the required `lo0` aliases **before** starting that profile with
host-address forwarding enabled. Alias creation is a separate privileged
host-network operation; enabling this Colima setting does not require Mac
`sudo`. Check each alias/port for collisions before proceeding.

The operator must approve and coordinate a VM restart: it interrupts **all**
containers and processes in the selected profile, not just Deck. Recheck
active work before stopping it, and recheck container health and application
readiness afterward. Do not touch other profiles. For an existing profile whose
`network.address` is false, `portForwarder` is `ssh`, and `autoActivate`
is false, preserve those settings and all other configuration:

```sh
colima stop --profile PROFILE
colima start --profile PROFILE --network-host-addresses
```

Replace the literal `PROFILE` placeholder with the operator-selected
dedicated profile. Do not use bare default-profile commands, `sudo colima`,
`--activate`, or change the global Docker context. Use that profile's
explicit Docker context for subsequent Compose operations. A running
`colima start` is not a substitute for stop/start. Do not hand-edit generated
Lima configuration, add an ad-hoc forwarder, or replace exact host-loopback
publishing with wildcard/public bindings.

Host-address forwarding enumerates **all host IPv4 addresses**, not only the
preview aliases. It broadens this VM's forwarding eligibility; it is not a
firewall. Verify that applications in the selected profile remain explicitly
loopback-published and that no wildcard/nonloopback application listeners
appear. The container-side gateway bind `0.0.0.0:8840` in the overlay is
not permission to publish that port on the host's `0.0.0.0`.

After restart, verify the selected settings and all eight generated exact TCP
rules: guest IP and host IP must both be each corresponding address from
`127.0.0.2` through `127.0.0.9`. Then check actual published-port ownership
and bindings and probe each address **from the Mac**, not merely from inside
the VM. For example, without cookies, tokens, proxies or redirect following:

```sh
curl --noproxy '*' --connect-timeout 3 --max-time 5 --silent --show-error \
  --output /dev/null --write-out '%{http_code}\n' http://127.0.0.2:8840/
```

Repeat for every published slot using the configured gateway port. An active
registered slot refuses an anonymous request with HTTP 403; an unused slot
returns HTTP 421. Do not require 403 from every slot. A timeout, connection
failure, HTTP 000 or HTTP 503 is not a passing refusal. Also confirm Deck's
ordinary loopback listener still answers. A successful startup or Docker
port listing alone does not prove Mac ingress.

These checks establish forwarding only. Separately verify authenticated
previews, assets/routes/APIs, WebSockets/HMR, cookie and cross-project
boundaries, and logout/disable/restart behavior through the actual Mac browser
before claiming installed-host preview acceptance. If forwarding fails, stop
and report it without widening binds or bypassing authentication.

## One-time host setup

The operator owns DNS, TLS, reverse-proxy and firewall changes. None of these
steps is an instruction to an agent to change the running deployment.

Use a domain dedicated to previews, with a different registrable domain from
Deck. For example, Deck can use `deck.example.com` and your apps can use
`shop.example.net` and `docs.example.net`. `shop.preview.example.com` would
still share Deck's site and is refused. Hostnames remain stable for app OAuth
callback registration. Managed registrations need wildcard DNS/TLS and ingress
for the chosen preview base domain. Static registrations can use exact records.

Route only the selected preview domain to the private gateway. The gateway
refuses hosts that have no active registration. This exact-host Caddy example
is for static registrations on a native installation sharing Deck's network
namespace; managed installations provision the corresponding wildcard route
and certificate once:

```caddyfile
shop.example.net, docs.example.net {
    reverse_proxy 127.0.0.1:8840
}
```

Caddy handles WebSocket upgrades. Leave response caching disabled. If using
another reverse proxy, preserve the incoming Host and support streaming and
WebSocket Upgrade. Reject unknown hosts and keep the ordinary Deck host routed
to Deck's ordinary listener. Do not log request bodies, cookies, authorization
headers or entry tickets. The gateway uses no token-bearing URLs.

The preview listener binds loopback. In Docker, that is the app container's
network namespace, **not the host**. A host reverse proxy cannot reach that
loopback by publishing the container port. Either run the ingress proxy in
the app's namespace or add a small proxy sidecar with
`network_mode: service:app` that forwards only the preview hosts to
`127.0.0.1:8840`. Publish that sidecar's ingress port through the app service
to host loopback, then route host TLS ingress there. Do not mount a container
runtime socket into Deck or expose dev-server ports. DNS, ingress and any
Compose overlay must be reviewed against the actual host before rollout.

## One-time managed preview configuration

For self-service registrations, configure one domain and port pool:

```yaml
project_previews:
  bind: "127.0.0.1:8840"
  deck_origin: "https://deck.example.com"
  unconfined: true
  base_domain: "preview.example.net"
  hostname_prefix: "p-" # optional; this is the default
  port_min: 15000
  port_max: 15100
```

Provide wildcard DNS, TLS and ingress for `*.preview.example.net`, preserving
Host and WebSocket upgrades. Only the gateway's registered hosts receive app
traffic; an unknown hostname is refused. This one-time route replaces manual
per-project DNS/proxy edits. Apply the same private-listener and Docker network
namespace requirements above. Keep the entire dev-server pool private.

Installations sharing a preview domain may choose distinct `hostname_prefix`
values (for example `main-p-` and `alt-p-`). The result remains a single DNS
label: `main-p-<20-character-project-hash>.preview.example.net`. Configure the
prefix before allocating previews; changing it with retained allocations
refuses startup rather than silently moving their origins. Empty preserves
the original `p-` names. Prefixes use lowercase ASCII letters, digits and
hyphens, cannot begin with a hyphen, and are at most 43 characters.
`NOISEDECK_PROJECT_PREVIEWS_HOSTNAME_PREFIX` is the equivalent environment
setting. The standard Compose file forwards it and the managed domain, port
pool and metadata socket settings.

A shared wildcard cannot send different installations to different gateways.
Use exact DNS records and matching ingress routes for their allocated hosts,
or a host-aware ingress router. A prefix alone does not provision either.
Exact records must remain reserved when previews are disabled, so another
installation's wildcard cannot take over their addresses.

Authenticated registration APIs allocate a stable hostname and an unused port,
activate it immediately. The local launcher reads the current assignment on
every invocation. Registration APIs never inspect project contents or accept
arbitrary destinations.
Registration changes require no Deck restart. Choose **Preview…** in a project's
menu, then **Enable preview**. The dialog shows the assigned URL; **Details**
shows its reserved port. **Check connectivity** records whether a TCP listener
accepts connections, not whether the application is healthy. The menu retains
that browser's last observation; settings shows when the check was taken.
Opening settings never starts a check. Use **Preview settings…** to inspect an enabled preview or disable its
browser access. Static registrations remain read-only. See the
[API contract](project-app-preview-api.md) for integration.

The generated hostname and port survive project renames, disable/re-enable
and Deck restarts. Disabling revokes live browser access but leaves the dev
server running, so Deck retains the port reservation instead of recycling it.
This is a Deck reservation, not an OS lock: dev servers still use strict binding.
The pool must contain 1–1024 nonprivileged ports, excluding Deck, the gateway
and any static targets. Exhaustion returns a visible error; expanding the pool
is an operator configuration change. Existing assignments must fit any revised
configuration or startup fails rather than silently moving an app.

Environment additions are `NOISEDECK_PROJECT_PREVIEWS_BASE_DOMAIN`,
`NOISEDECK_PROJECT_PREVIEWS_HOSTNAME_PREFIX`,
`NOISEDECK_PROJECT_PREVIEWS_PORT_MIN` and `NOISEDECK_PROJECT_PREVIEWS_PORT_MAX`.

## One-time local launcher setup

The backend and project sessions share a Unix user, home and network namespace
in the supported unconfined workspace. The default metadata socket is
`$HOME/.local/state/noisedeck/preview.sock`; Deck creates its parent directory
privately and the socket with mode `0600`. No port or HTTP route is added for
metadata. Never publish this socket through ingress or mount it into a preview
browser or an untrusted isolated workload.

For a different filesystem layout, set `project_previews.metadata_socket` or
`NOISEDECK_PROJECT_PREVIEWS_METADATA_SOCKET` to an absolute path in a dedicated
private directory owned by Deck's user. If Deck and existing agent processes
have different mount views, make that directory visible at the selected path in
both; exposing the control database or its containing directory is unnecessary.
New Deck sessions receive the nonsecret socket path automatically. Existing
sessions use the default, the same environment variable or `--socket PATH`.
Multiple Deck installations sharing a home must choose distinct socket paths;
an observed occupied live socket refuses startup. Other processes must not
concurrently replace entries in that directory. Socket cleanup checks catch
already-visible replacements, but the check and unlink are not atomic against
same-UID interference. This is part of the existing unconfined process boundary;
private file modes do not isolate hostile processes sharing Deck's user.

Only the installation needs this setup. Enabling a project and starting its
server require neither infrastructure changes nor a Deck restart. A stopped
backend, disabled registration or unavailable metadata socket refuses a new
launch; a running dev server survives backend shutdown.

## Project-owned dev command

Declare the command once in the project's `.deck/preview.json`:

```json
{"version":1,"command":["npm","run","dev"]}
```

Configure the dev server to consume `DECK_PREVIEW_HOST`, `DECK_PREVIEW_PORT`,
`DECK_PREVIEW_ORIGIN`, `DECK_PREVIEW_HOSTNAME`, `DECK_PREVIEW_SCHEME` and
`DECK_PREVIEW_ORIGIN_PORT`. The scheme is `http` for loopback and `https` for
hosted previews; the origin port is explicit in both modes.
`DECK_PREVIEW_HTTPS_PORT` remains a compatibility alias for the origin port.
The integration is framework-specific once; no prompt is copied or generated
for later launches. For a Vite project, its existing server configuration can
consume the assignment like this:

```js
server: {
  host: process.env.DECK_PREVIEW_HOST,
  port: Number(process.env.DECK_PREVIEW_PORT),
  strictPort: true,
  allowedHosts: [process.env.DECK_PREVIEW_HOSTNAME],
  hmr: {
    protocol: process.env.DECK_PREVIEW_SCHEME === "https" ? "wss" : "ws",
    host: process.env.DECK_PREVIEW_HOSTNAME,
    clientPort: Number(process.env.DECK_PREVIEW_ORIGIN_PORT),
  }
}
```

Vite needs no `allowedHosts` entry for a loopback IP host; the entry above
supports hosted preview names.

Run `noise deck preview run` in that project directory after enabling its
preview. Use `--project-id ID` outside an existing Deck project session and
`--config PATH` when the project keeps its command declaration elsewhere. The
helper executes only the declared argv, with no implicit shell expansion or
source inspection. A project that needs a custom adapter declares that adapter
as its command. Deck does not create or manage a background server process.

The launcher probes the assigned port before exec. This catches an already
running server but cannot eliminate the race before the application's bind;
`strictPort` or the framework's equivalent remains required. A framework that
does not honor the assignment must be adapted, never assumed compatible because
it accepted an environment variable. Stop the server from its launching
session; disabling access in Deck does not stop it or release its reservation.

## Compatibility: static registrations

Obtain project IDs from Deck's authenticated `GET /api/projects` response.
Keep registration in operator-owned configuration, outside project-controlled
files. Add this to the file passed to `noisedeck serve -config`:

```yaml
project_previews:
  bind: "127.0.0.1:8840"
  deck_origin: "https://deck.example.com"
  unconfined: true
  targets:
    - project_id: "replace-with-shop-project-id"
      origin: "https://shop.example.net"
      upstream: "127.0.0.1:5173"
    - project_id: "replace-with-docs-project-id"
      origin: "https://docs.example.net"
      upstream: "127.0.0.1:5174"
```

`deck_origin` must already be in `server.allowed_origins`. Never add preview
origins to that list. Password, OIDC and trusted-proxy authentication work;
unauthenticated Deck mode does not. The gateway has no Google dependency.

Environment equivalents are `NOISEDECK_PROJECT_PREVIEWS_BIND`,
`NOISEDECK_PROJECT_PREVIEWS_DECK_ORIGIN`,
`NOISEDECK_PROJECT_PREVIEWS_UNCONFINED` and
`NOISEDECK_PROJECT_PREVIEWS_TARGETS`. The last is a JSON array with the same
`project_id`, `origin` and `upstream` fields, not a comma-separated list.
Container deployments must explicitly pass these variables to the app or mount
the operator config; setting them in a host shell alone does not configure it.

Registration authorizes an exact port. Deck does not infer process ownership
from a page response, project path or terminal output. Allocate distinct ports
and tell each dev server to fail on collision. Never silently try the next
port. Remove a registration before reusing its port for another service.

Serve assets and API calls with ordinary app-relative paths. The gateway
preserves the whole path; there is no preview path prefix. The app owns SPA
fallbacks and any proxy to its separate API server. Absolute localhost URLs
in client code address the viewer's computer and need normal dev-server
configuration; Deck does not rewrite HTML or JavaScript.

App OAuth uses the app's own client, credentials, state/PKCE and exact preview
callback URL. Deck's login callback remains on Deck. Top-level GET OAuth
callbacks work while the preview session is valid. Cross-site POST callbacks
are not supported. Accepted app response cookies become host-only; unrelated
domain cookies and reserved gateway cookies are refused. Service workers are not supported
in this first version, since they could intercept entry or keep stale apps
running after their server stops.

## Access and shutdown

Open preview requires an authenticated click in Deck. A 60-second, one-use
ticket enters the exact app origin, which receives its own Secure HttpOnly
host-only cookie for at most 30 minutes. It never receives Deck's cookie.
Reopen from Deck when the preview expires. Sharing an app URL does not grant
access. Password/OIDC logout revokes preview access and existing WebSockets.
For external trusted-proxy logout, the 30-minute expiry is the upper bound;
Deck cannot observe an identity provider logout it is not told about.

Stopping a dev server shows an unavailable response. Stopping Deck closes
preview connections and invalidates preview sessions, but does not terminate
the dev servers. To withdraw all preview access, remove the preview ingress
and disable preview configuration. Operator configuration changes require one
Deck restart; managed registration changes and project source edits require none.

## Acceptance and rollout

Run `pnpm test:project-preview` and `pnpm test:project-preview:managed` from
`web/` with the pinned Playwright client.
The probes use synthetic apps, isolated databases and tmux
namespaces, and temporary local HTTPS ingress. They must prove two simultaneous
previews, assets, routes, APIs, HMR without direct fallback, anonymous refusal,
cookie separation, cross-project/Deck API refusal, and clean shutdown.

Local probe results do not verify public DNS, TLS or firewall rules. After the
reviewed release is approved for deployment, repeat the workflow through the
actual ingress, including a fresh unauthenticated browser and a second device
that cannot reach host-private ports. Record those results separately. Do not
enable `experiments.dev_preview`; it previews Deck itself with Deck authority.

## SRE execution checklist

This handoff prepares an operator-approved rollout after the feature has
merged. It does not authorize deployment or changes to DNS, ingress or host
firewall rules. Keep the feature disabled until the following inputs have
been selected for the actual installation:

- The merged release commit and immutable image digest, plus the previous
  image and configuration for rollback.
- Deck's exact HTTPS origin and its existing authentication mode.
- A preview base domain on a different registrable domain from Deck and a
  dedicated loopback port pool. Use two trusted sample project IDs for acceptance;
  their hostnames and ports are returned by the authenticated registration API.
- The gateway loopback port and how ingress reaches that network namespace.
  Check the Docker guidance above before choosing a host port mapping.
- A private metadata socket path visible to Deck and its project sessions under
  the same Unix user; no public listener or broad control credentials.

1. Verify the release contains the merged preview implementation. Run
   `pnpm test:project-preview` and `pnpm test:project-preview:managed` from its
   `web/` directory with the pinned dependencies and the configured browser resolver. Save the pass/fail result
   against that release commit; this proves the local application flow, not
   the production ingress.
2. Back up operator configuration and take a consistent control-database backup
   using the installation's supported procedure, outside project-controlled
   directories.
   Prepare wildcard DNS/TLS for the selected preview base domain, restricted
   ingress and the managed `project_previews` configuration described above.
   Check that only HTTPS ingress is reachable externally: neither dev-server port nor the gateway
   listener may be publicly reachable. Do not expose a wildcard port proxy.
3. With deployment approval, install the selected release and configuration
   using the installation's normal rollout procedure. A Deck restart revokes
   existing previews; coordinate that interruption. Confirm ordinary Deck
   login still works before starting the two trusted sample projects.
4. Enable both sample previews through **Preview…** in their project menus and
   record the returned URL and port. This must work without restarting Deck or
   editing ingress. In each synthetic project, declare `.deck/preview.json`
   and use a dev-server adapter that consumes the documented assignment. Run
   `noise deck preview run --project-id ID` (plus `--socket PATH` if needed).
   No agent instructions or Deck credentials are copied. Check listener
   addresses in the shared network namespace. A second launch on an occupied
   port must fail rather than move to another port. Existing agent sessions
   must be able to use the helper without being relaunched.
5. From a device that cannot reach host-private ports, sign into Deck and use
   **Open preview** for both projects. Verify CSS/images, direct navigation
   to a nested client route, an app-relative API request and a live WebSocket.
   Edit a source file and observe hot reload without rebuilding Deck. Browser
   network tools must show the preview HTTPS/WSS hostname, with no direct
   localhost or dev-port fallback.
6. In a fresh unsigned-in browser, visit both preview URLs and attempt a
   WebSocket connection. Both must refuse access and reveal no app content.
   A direct HTTP check should also return 403:

   ```sh
   curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' \
     https://shop.example.net/
   ```

   Substitute the selected preview hostname. This command intentionally has
   no cookie or token. An unknown hostname must not route to an app.
7. From one authenticated preview page, attempt credentialed fetches to
   Deck's `/api/projects` and the other preview's API, a form POST to Deck,
   and WebSocket connections to Deck and the sibling app. Confirm server-side
   refusal in browser network tools or metadata-only ingress observations;
   a JavaScript CORS error alone does not prove refusal. Verify Deck cookies
   are absent from app requests and gateway cookies are absent from upstream
   requests. Do not record their values or enable body/cookie logging.
8. If the app uses OAuth, test its actual registered GET callback and app
   cookie continuity. Deck's OAuth configuration must not be reused by the
   project. A provider requiring a cross-site POST callback is unsupported.
9. Disable one preview through **Preview settings…**: its tickets and live WebSockets must
   be revoked, its dev server must remain running, and the other preview must
   still work. After stopping its synthetic server, a new helper invocation
   must refuse the disabled assignment before executing the command. Re-enable
   it and confirm the same URL/port with fresh browser
   authentication; old cookies and tickets must remain refused.
10. Stop one sample dev server: its preview must show unavailable while the
   other still works. Sign out of Deck: preview requests must be refused and
   established WebSockets closed. For trusted-proxy logout, check the stated
   absolute expiry instead. In the approved test window, restart Deck and
   verify old preview sessions and unused entry tickets no longer work;
   project dev servers must remain running. Confirm registrations retain their
   URLs and ports across that restart. While Deck is stopped, the helper must
   refuse to launch from stale metadata. After restart, the same already-running
   agent session must read the restored current assignment.

Report the release commit/image digest, configured public origins and ports,
auth mode, network topology, and each test's result. Report local-probe and
real-ingress results separately. Include whether app OAuth was exercised or
not applicable. Keep credentials, entry bodies and cookie values out of the
handoff and logs.

### Rollback

Withdraw the preview ingress routes first to stop new external access. Restore
the previous operator configuration, or remove the entire `project_previews`
block. For environment-based configuration, clear `NOISEDECK_PROJECT_PREVIEWS_BIND`
and `NOISEDECK_PROJECT_PREVIEWS_DECK_ORIGIN`, set
`NOISEDECK_PROJECT_PREVIEWS_TARGETS=[]`, and set
`NOISEDECK_PROJECT_PREVIEWS_UNCONFINED=false`. Also clear
`NOISEDECK_PROJECT_PREVIEWS_BASE_DOMAIN` and
`NOISEDECK_PROJECT_PREVIEWS_HOSTNAME_PREFIX`, and set both
`NOISEDECK_PROJECT_PREVIEWS_PORT_MIN=0` and
`NOISEDECK_PROJECT_PREVIEWS_PORT_MAX=0`. Clear
`NOISEDECK_PROJECT_PREVIEWS_METADATA_SOCKET` as well. Clearing only the bind address
leaves an incomplete configuration and is rejected at startup.

Restart Deck using the approved rollout procedure. This release adds migration
037; an older image refuses a database migrated by a newer binary. The normal
feature rollback therefore keeps this schema-compatible image and disables
previews. A binary downgrade requires a separately approved database recovery
plan and consistent pre-upgrade backup; never edit the migration ledger or
overwrite newer state merely to restore the old image.

Confirm ordinary Deck login works and preview access is refused. Stop only the
sample dev servers this rollout started; Deck does not own unrelated project
processes.

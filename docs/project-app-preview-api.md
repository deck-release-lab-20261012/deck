# Project preview registration API

Backend onboarding to the private project preview gateway.
The installation owner configures loopback previews or a preview domain,
with a port pool. An authenticated operator can then enable project previews
without configuration edits or a Deck restart. Choose **Preview…** in the
project's menu to enable it, then use **Preview settings…** to inspect or disable access and
**Open preview** to enter the app.

## Installation contract

For a loopback HTTP installation:

```yaml
project_previews:
  loopback: true
  unconfined: true
  port_min: 15000
  port_max: 15007
```

The gateway defaults to port 8840 and serves each pool slot on a distinct
address, starting at `http://127.0.0.2:8840`. Native installs leave `bind`
empty; Docker uses [compose.previews.yaml](../compose.previews.yaml) to bind
`0.0.0.0:8840` inside the container and publish only the eight loopback slot
addresses. Dev-server ports remain private. `self_service` is true in this
mode, without a domain. Authentication is required, and all Deck allowed
origins must be loopback HTTP origins. Leave `deck_origin` empty and do not
combine loopback mode with `base_domain`, `hostname_prefix` or static `targets`.
The pool is limited to 254 ports. See the
[loopback contract](project-app-preview-loopback.md) for address allocation
and browser behavior.

For a hosted installation:

```yaml
project_previews:
  bind: "127.0.0.1:8840"
  deck_origin: "https://deck.example.com"
  unconfined: true
  base_domain: "preview.example.net"
  port_min: 15000
  port_max: 15100
```

The domain must have a different registrable domain from every allowed Deck
origin. Wildcard DNS/TLS and ingress for `*.preview.example.net` reach the
loopback gateway in its network namespace; unknown hosts still have no route.
Only HTTPS ingress is public. Neither the gateway nor the dev-server ports
may be exposed publicly. The port pool contains at most 1024 ports, all at
least 1024, and excludes Deck, its gateway and all static target ports.

Environment equivalents add `NOISEDECK_PROJECT_PREVIEWS_BASE_DOMAIN`,
`NOISEDECK_PROJECT_PREVIEWS_HOSTNAME_PREFIX`,
`NOISEDECK_PROJECT_PREVIEWS_PORT_MIN` and `NOISEDECK_PROJECT_PREVIEWS_PORT_MAX`
to the existing preview variables. Legacy `targets` remain supported and can
coexist outside the managed pool. They are read-only through this API.

## Endpoints

All endpoints require the installation's normal Deck authentication. Mutations
use its existing CSRF protection. Preview pages cannot call these endpoints
with Deck authority, including GET. Responses use `Cache-Control: no-store`.

| Method and path | Behavior |
| --- | --- |
| `GET /api/projects/{id}/preview/settings` | Read installation availability and the project's registration. Does not probe the port. |
| `PUT /api/projects/{id}/preview/settings` | Allocate and enable, or return the existing enabled assignment. |
| `DELETE /api/projects/{id}/preview/settings` | Disable access and revoke tickets, sessions and live connections. Retain the assignment. |
| `POST /api/projects/{id}/preview/check` | Observe whether a TCP listener accepts connections on the assigned endpoint, with a two-second timeout. |
| `POST /api/projects/{id}/preview` | Existing one-use authenticated entry flow, unchanged. |

Settings mutations and the check endpoint accept an empty body or `{}`.
They have no caller-selected origin, hostname, destination, port or command.
Unknown fields and trailing JSON are rejected. The API neither reads project
source nor starts processes or sends terminal input.

GET, PUT and DELETE return HTTP 200 with:

```json
{
  "configured": true,
  "self_service": true,
  "enabled": true,
  "source": "managed",
  "origin": "https://p-0123456789abcdefabcd.preview.example.net",
  "port": 15000,
  "upstream": "127.0.0.1:15000"
}
```

`configured` means the preview gateway is configured. `self_service` means a
managed pool is configured with either loopback mode or a preview domain.
An unregistered project has `enabled: false` and omits `source`, `origin`,
`port` and `upstream`. A disabled registration retains those fields. `source`
is `managed` or `static`. Existing static targets report their actual addresses.

The check response is `{ "reachable": true, "checked_at": "<UTC timestamp>" }`.
This observes a TCP listener, not application health, HTTP readiness, process
identity, or ownership. A refusal means unreachable, not necessarily stopped.
Checking a disabled preview returns 409 `preview_disabled`.

Settings errors use `{ "error": { "code": "...", "message": "..." } }`:

| Status/code | Meaning |
| --- | --- |
| 400 `bad_request` | Unsupported request fields or malformed body. |
| 404 `not_found` | Project does not exist or was removed. |
| 409 `preview_unconfigured` | Installation setup is absent or has no managed pool. |
| 409 `preview_static` | A mutation attempted to change an operator-configured static target. |
| 409 `preview_ports_exhausted` | All pool ports are reserved or currently occupied. |
| 500 `internal` | Persistence or runtime update failed; no success is claimed. |

## Persistence and revocation

The SQLite registration binds a project ID to one generated hostname and port.
Names use a bounded hash of the immutable project ID, so project renaming does
not change OAuth callback URLs. First allocation skips occupied ports and
other registrations. Concurrent enables cannot allocate the same port.

A reservation exists in Deck's control state; it is not an operating-system
lock or a claim about the process that later binds the port. The agent must
configure strict binding and fail on collisions. The workspace remains
unconfined and hostile server processes require host isolation.

Disable and project removal revoke browser authority immediately without
stopping the dev server. Assignments remain reserved even after removal:
recycling the port could expose a surviving server as another project.
Re-enable uses the same address and port, with fresh authentication; old
cookies and tickets cannot revive. No port-reclamation endpoint exists.

Restart restores active enabled registrations after validating persisted
assignments against current operator configuration. Domain changes, pool
shrinks that exclude an assignment and static conflicts fail startup rather
than silently move an app. Expanding the pool is supported. Restart never
restores tickets or preview sessions. Removing the whole preview configuration
disables the feature without deleting assignments.

On a failed disable write, runtime access is still revoked and the API returns
an error. The durable enabled flag may remain set; the operator must retry
successfully before assuming that disable survives a restart.

Opening a preview remains an explicit click that opens an isolated tab through
the entry-ticket flow. The UI never composes or sends launch instructions to an
agent. The former `agent_instructions` response field is removed; the local
launcher consumes current structured assignments instead.

## Deterministic local launch

Declare an argv command once in the project's `.deck/preview.json`:

```json
{"version":1,"command":["npm","run","dev"]}
```

From that project's directory, the developer or agent runs:

```sh
noise deck preview run
```

The helper uses `NOISEDECK_PROJECT_ID`, which Deck already gives its sessions.
`--project-id ID` explicitly selects a registered project when running outside
such a session. This is a selector in the unconfined workspace, not proof of
project authority. `--config PATH` selects a different project-owned command
file; the default is `.deck/preview.json` relative to the current directory.
There is no ancestor search, framework detection, shell expansion or command
execution in the Deck server. The invoked command inherits the caller's working
directory and standard streams; Unix exec preserves its process identity,
signals and exit status.

Each invocation queries the backend's dedicated Unix metadata socket, which
calls `Registry.Get` to check both durable registration and live gateway state.
The helper does not read the control database, operator configuration or Deck
login credentials. Missing, disabled or removed registrations, a stopped
backend and malformed replies fail before execution, with no cached fallback.
The check describes state at lookup time; it is not a launch lease. A concurrent
later disable revokes browser access but never stops the local command.

The default socket is `$HOME/.local/state/noisedeck/preview.sock`. Installation
configuration may set `project_previews.metadata_socket` or
`NOISEDECK_PROJECT_PREVIEWS_METADATA_SOCKET`. New and relaunched Deck sessions
receive only that nonsecret socket location. Already-running sessions use the
stable default, the same environment override, or `--socket /absolute/path`;
no session restart is required. The socket parent must be a private directory
owned by the Deck user; the socket is mode `0600`. Startup refuses a live socket,
ordinary file, symlink or foreign-owned socket that it observes at the path.
An owned stale socket can be removed after a second identity check. Shutdown
skips a replacement observed before cleanup. These checks guard accidental path
reuse; checking identity and unlinking are separate filesystem operations.
Other processes must not concurrently rewrite the socket directory. The checks
and file modes do not protect against hostile processes sharing Deck's Unix
identity, which are outside this unconfined feature's isolation boundary.

The helper replaces stale `DECK_PREVIEW_*` variables with:

| Variable | Value |
| --- | --- |
| `DECK_PREVIEW_HOST` | Assigned loopback bind IP, normally `127.0.0.1` |
| `DECK_PREVIEW_PORT` | Reserved dev-server port |
| `DECK_PREVIEW_ORIGIN` | Exact preview origin (HTTP on loopback, HTTPS when hosted) |
| `DECK_PREVIEW_HOSTNAME` | Browser hostname without a port |
| `DECK_PREVIEW_SCHEME` | Browser scheme: `http` or `https` |
| `DECK_PREVIEW_ORIGIN_PORT` | Browser origin port, explicit even for the scheme default |
| `DECK_PREVIEW_HTTPS_PORT` | Compatibility alias for `DECK_PREVIEW_ORIGIN_PORT` |

The project integrates these values into its own framework once. There is no
universal `PORT`/`HOST` convention: allowed-host and HMR settings must consume
the public hostname as well. The helper refuses a port already in use, then
releases its preflight socket before exec. The dev command must still bind
strictly: a later race must fail, never fall back to another port. Deck does not
claim ownership of a listener or hold the port on the application's behalf.

### Local metadata boundary

The socket accepts one bounded JSON request, then a write-half close:
`{"version":1,"project_id":"registered-id"}`. Its sole successful reply is
`{"version":1,"assignment":{"project_id":"registered-id","host":"127.0.0.1","port":15000,"origin":"https://app.example.net"}}`.
Failures carry `version: 1` and an `error` code (`bad_request`, `not_found`,
`preview_disabled` or `unavailable`). Unknown fields and trailing input fail;
requests are capped at 1024 bytes, responses at 4096 bytes in the client, and
connections have a two-second deadline with a bounded worker pool. There is no
HTTP handler, listing, registration mutation, arbitrary destination, entry
ticket or process-launch operation.

The named threats are disclosure of Deck authority to a project helper,
browser access to a control endpoint, and launching with stale disabled state.
Deck owns enforcement through the separate read-only socket and current
registry lookup; malformed, unavailable and revoked states refuse execution.
Tests exercise requests for unsupported actions, extra destinations, malformed
or oversized input, disable persistence failure, removal, restart and real
helper exit/signals. Browser acceptance separately checks authenticated Deck
API refusal and two simultaneous apps.

This is explicitly the unconfined single-tenant profile. Same-UID processes can
read another assignment and can already access shared host resources; socket
permissions are not project confinement. Assignment metadata is nonsecret and
grants no browser access. The helper inherits the caller's ordinary environment;
it does not claim to remove ambient provider or project credentials.

## Verification

The managed browser probe runs with `pnpm test:project-preview:managed` in
`web/`. It exercises real authenticated allocation, both sample apps, assets,
routes, APIs, WebSockets, HMR, browser isolation, revocation and restart.
The static probe remains `pnpm test:project-preview`. Both use synthetic data
and isolated resources. The operator runbook separately verifies actual DNS,
TLS, ingress and firewall behavior; local probes do not attest to host setup.

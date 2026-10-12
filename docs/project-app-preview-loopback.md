# Project previews on a loopback install

A Deck reached at `http://127.0.0.1:<port>` or `http://localhost:<port>` can
offer project previews with no DNS, TLS or reverse proxy. This document is
the contract for that mode. The hosted mode in
[project-app-previews.md](project-app-previews.md) (a separate preview
domain over HTTPS) is unchanged and remains the right choice for a Deck that
is reached over a network.

## The mechanism

Each enabled preview is served from its own loopback address:

    http://127.0.0.2:8840    first slot
    http://127.0.0.3:8840    second slot
    ...

Browsers scope cookies by host and treat each IP literal as its own site.
Two previews, or a preview and Deck itself, therefore have exactly the
isolation the hosted design gets from separate registrable domains:

- the gateway's cookie is host-only and never reaches Deck or another
  preview;
- Deck's session, CSRF and login cookies are never sent to a preview, so the
  gateway's cookie filter is a second line, not the only one;
- a request from a preview page to Deck's API is cross-site, so Deck's
  exact-origin checks apply to it unchanged;
- the WebSocket handshake check against the exact preview origin is unchanged.

The same is **not** true of distinct ports on one address. Cookies ignore
the port, and `127.0.0.1:8841` is the same site as `127.0.0.1:18082`, so an
app served there could read, replace or send Deck's cookies. For that reason
`127.0.0.1` and `localhost` are never preview hosts, and a loopback preview
origin is always an IPv4 loopback literal other than `127.0.0.1`.

## What changes from the hosted mode

**Plain HTTP.** There is no TLS on loopback. Browsers treat `127.0.0.0/8` as
a secure context, but not every browser accepts a `Secure` cookie set over
`http://`, so the loopback gateway issues a cookie named `deck_preview`
instead of `__Host-deck_preview`: HttpOnly, SameSite=Lax, Path=/, no Domain,
no Secure. The `__Host-` prefix exists to stop a parent domain or sibling
host from overwriting a cookie; an IP literal has neither, so a host-only
cookie carries the same guarantee here. Both names are in the reserved set
the gateway strips from forwarded requests and refuses from upstream
responses.

**Deck's origin is a set.** The entry POST must carry one of Deck's own
loopback origins, and a person types two of them (`127.0.0.1` and
`localhost`). In loopback mode the accepted set is every loopback entry of
`server.allowed_origins`; `project_previews.deck_origin` is not used. All of
Deck's allowed origins must be loopback, otherwise loopback previews refuse
to start.

**Addresses come from the port pool.** The dev-server port pool
(`port_min`–`port_max`) already allocates one port per project and persists
it. The preview address is derived from it: pool index `i` (port
`port_min + i`) serves at `http://127.0.0.<2 + i>:<loopback_port>`. Nothing
new is stored, restarts keep each project's address, and the existing
"persisted allocation conflicts with the configured pool" check covers it.
The pool may hold at most 254 ports in this mode, so addresses stay within
`127.0.0.2`–`127.0.0.255`.

**Listeners.** With `bind` empty, Deck listens on every slot address at
`loopback_port` (native installs). With `bind` set to an unspecified address
such as `0.0.0.0:8840`, Deck opens that one listener and the Host header
selects the preview; this is the Docker form, where Compose publishes each
slot address on the host's loopback to the container. Any other `bind`
value in loopback mode is a configuration error.

Everything else is the hosted gateway: the single-use ticket spent by a POST
from Deck's origin, the thirty-minute session, exact Host matching, opaque
proxying to a loopback upstream, the connectivity check, the metadata socket
and `noise deck preview run`.

## Configuration

```yaml
project_previews:
  loopback: true        # 127.0.0.x origins over plain HTTP
  loopback_port: 8840   # default; not Deck's port and not in the pool
  unconfined: true      # the shared-workspace acknowledgement, as before
  port_min: 15000       # dev-server pool; at most 254 ports in this mode
  port_max: 15007
```

Environment equivalents: `NOISEDECK_PROJECT_PREVIEWS_LOOPBACK` and
`NOISEDECK_PROJECT_PREVIEWS_LOOPBACK_PORT`. `loopback` is exclusive with
`base_domain` and with static `targets`. Authentication mode `none` still
cannot enable previews.

Docker: `compose.previews.yaml` sets these variables, sets `bind` to
`0.0.0.0:8840`, and publishes `127.0.0.2:8840` through `127.0.0.9:8840` on
the host to the container's port 8840 (eight slots, matching the default
pool of eight). The host must route the whole `127.0.0.0/8` block to its
loopback interface, which Linux does by default. macOS configures only
`127.0.0.1` and needs an alias per slot address.

## What the dev server sees

`noise deck preview run` exports the assignment as before. In loopback mode
`DECK_PREVIEW_ORIGIN` is `http://127.0.0.<n>:<loopback_port>` and
`DECK_PREVIEW_HOSTNAME` is the address. Two variables are added for both
modes: `DECK_PREVIEW_SCHEME` (`http` or `https`) and
`DECK_PREVIEW_ORIGIN_PORT` (the port in the origin, explicit even when it is
the scheme's default). `DECK_PREVIEW_HTTPS_PORT` keeps its value, the origin
port, so existing project configurations keep working.

Vite needs no `allowedHosts` entry for an IP host; an HMR block that works in
both modes is:

```js
hmr: {
  protocol: process.env.DECK_PREVIEW_SCHEME === "https" ? "wss" : "ws",
  host: process.env.DECK_PREVIEW_HOSTNAME,
  clientPort: Number(process.env.DECK_PREVIEW_ORIGIN_PORT),
}
```

## Boundary

Loopback previews narrow nothing and widen nothing in the workspace
boundary: dev servers already run unconfined and are reachable from inside
the host. The gateway still only decides what a browser may reach, through
an authenticated entry, for an address that is not Deck's own.

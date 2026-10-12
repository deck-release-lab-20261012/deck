# First-release authentication deployment model

**Superseded default (2026-08-12):** ADR-0004 replaces Google OIDC as the
default with generated single-operator password authentication, while keeping
the OIDC boundary below as the authority for `oidc` mode and the deprecated
`builtin` alias.

**Decision (2026-08-10):** The first-release authentication deployment model
is **builtin mode — sole-operator Google OIDC**. It is the maintainer-approved
default: the shipped Compose deployment sets `NOISEDECK_AUTH_MODE: builtin`
(`compose.yaml`), `internal/config/config.go` `Defaults()` sets
`Auth.Mode: "builtin"`, the README documents only the builtin Google OIDC
flow, and `internal/auth/doc.go` defines the builtin boundary (Authorization
Code flow with PKCE S256, scope `openid email` only, fixed Google endpoints,
exactly one allowed email). **trusted_proxy mode remains supported** as the
alternate for deployments where an authenticating reverse proxy owns login
— it is fully implemented and tested, but it is not the
first-release default.

## Threat model

Each item names its enforcing file/function and its failure behavior — what
refuses what.

### Non-loopback binding

`internal/config/config.go` `Validate()` refuses a non-loopback `server.bind`
unless authentication is configured for the selected mode; the bind host must
be an IP literal, so a hostname cannot resolve past the check. `Defaults()`
binds loopback. A non-loopback bind with unconfigured auth fails closed at
config load.

### Cookie and session-secret lifecycle

The session secret and the Google client secret are env-only — there is no
YAML key, and a `session_secret` key in the file is rejected (`config.go`
`Auth.SessionSecret` `yaml:"-"`; `config_test.go`
`TestSessionSecretHasNoYAMLKey`). Sessions are stateless HMAC-SHA256-signed
tokens of the form
`v3:<auth-time>:<expiry>:<login-id>:<issuer>:<subject>:<email>`. The login ID is
32 random bytes encoded as hex; identity fields use unpadded base64url. OIDC
fills them from verified claims, while password logins leave all three empty.
`auth-time` and the login ID survive renewal
(`internal/auth/session.go` `SessionDuration`, `SessionMaxDuration`,
`issueSessionValue`, `verifySessionValue`, `sessionRenewal`). A session in
use slides: the middleware re-issues an aging token on any authenticated
request, so the 30-day `SessionDuration` is an idle bound, and the 90-day
`SessionMaxDuration` — counted from `auth-time` through every renewal — is
the absolute cap that finally requires a fresh login. Legacy `v1:<expiry>:
<random>` tokens verify until their own expiry and renew into v2. Legacy v1/v2
cookies continue to authenticate the existing application, but do not establish
a browser login identity or Google subject; a flow requiring those facts needs
a fresh sign-in. `CurrentLogin` exposes the verified identity after `Require`,
and `OnBrowserLogout` targets revocation to that login without changing the
existing per-operator `Principal` and `OnLogout` contracts. A login identity is
not an encryption unlock grant. A restart does not invalidate stateless login
cookies — expiry and secret rotation do. Cookies are HttpOnly,
SameSite=Lax, and host-only. Config requires all declared browser origins to
use one scheme, derives Secure cookies with the `__Host-` prefix from HTTPS,
and uses plain cookie names only for declared-loopback HTTP development
(`config.go` `normalize`, `session.go` `setSessionCookies`, and the cookie-name
functions). The session secret must be at least 32 bytes — it keys the HMAC
that signs every session.

### CSRF

Builtin mode enforces a session-bound double-submit token on every non-safe
method, compared in constant time (`internal/auth/middleware.go` `checkCSRF`,
`Require`); the token is derived from the session in `session.go` `csrfFor`
and carried in the `X-CSRF-Token` header. The CSRF cookie is deliberately not
HttpOnly so the frontend can read it. Logout is a CSRF-protected POST
(`oidc.go` `handleLogout`). The transport-level origin guard independently
refuses state-changing requests whose `Origin` is not allowlisted
(`internal/server/middleware.go` `originGuard`). In trusted_proxy mode CSRF
rests on that origin guard plus the proxy's own protections
(`internal/auth/doc.go`).

### WebSocket Origin checks

The terminal WebSocket handshake requires an exact-match Origin from
`server.allowed_origins` and refuses handshakes with no Origin header
(`internal/terminal/proxy.go` `originAllowed`, the upgrader `CheckOrigin`).
Config rejects wildcards, trailing slashes, paths, userinfo, and malformed
origins (`config.go` `Validate()` allowed_origins block).

### Proxy source allowlisting

The identity header is honored only from configured IPs/CIDRs
(`internal/auth/middleware.go` `parseTrustedPeers`, `trusted`). Empty
`trusted_proxy.addresses` is refused at config load — an empty list would
accept the identity header from anyone — and invalid header names are refused
(`config.go` `Validate()` trusted_proxy branch, `isHeaderFieldName`).

### Spoofed identity-header stripping

From an untrusted peer the identity header is deleted without being read and
the request is refused with 403; from a trusted peer the header is read,
deleted, and never propagated downstream (`middleware.go` `Require`
trusted_proxy branch; tests `TestUntrustedHeaderStripped`,
`TestTrustedProxyMatrix`).

### Logout and expiry

Login transactions are bounded (256), five-minute TTL, and consume-once
(`internal/auth/txn.go`); every callback failure is a generic 401 with detail
only in logs (`oidc.go` `handleCallback`). Sessions expire after 30 days
idle or 90 days absolute (the sliding window and cap above); logout clears
both cookies and never signs anyone out of Google.
trusted_proxy mode mounts no login/logout routes — identity lifecycle belongs
to the proxy (`oidc.go` `Mount`).

### Provider-home trust

Provider homes and history are runtime state outside the web-auth boundary;
the Compose deployment shares one provider-home volume across sessions, which
is documented as part of the unconfined profile (README "Run the Docker
Compose MVP"). Authentication claims nothing about what a running
provider CLI can read.

### Same-Unix-user boundary

The tmux socket directory must be owned by the runtime user with mode 0700,
verified at startup and on every readiness poll
(`internal/boot/boot.go` `Up` and `readinessChecks`; `internal/tmux`
`VerifySecurity`). Other processes running as the same Unix user can bypass the
console entirely and are explicitly outside the first-release threat boundary
— this is what makes the first-release profile unconfined (ADR-0003, README).

### Wiring

Every API route and the terminal WebSocket mount behind `h.Auth.Require`
(`internal/boot/boot.go`). Only `/livez`, `/readyz`, `/auth/login`,
`/auth/callback`, the static shell, and the one-shot-token hook-capture route
(`POST /api/hooks/capture`) are public, each by design. `/auth/logout` sits
outside `Require` but enforces the same session-bound CSRF check itself — an
unauthenticated POST is refused (`oidc.go` `handleLogout`). `/auth/session`
answers with `Cache-Control: no-store` and an `X-Noisedeck-Auth-Mode` header
(`oidc.go` `Mount`).

## Status

This records the OIDC and trusted-proxy threat models. ADR-0004 is
authoritative for default selection, explicit loopback-only opt-out, and
password mode. The boundary below satisfies Phase 0's "select and threat-model
built-in or trusted-proxy authentication" requirement and is the release-gate
record. trusted_proxy mode without an allowlist, and a non-loopback bind
without configured authentication, both fail closed at config load. The
accepted boundaries are explicit: same-Unix-user processes and provider-home
contents are outside the first-release threat boundary, which is why the
first-release profile is unconfined (ADR-0003).

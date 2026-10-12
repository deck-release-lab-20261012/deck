# ADR-0004: Secure-by-default tiered authentication

- Status: Accepted
- Date: 2026-08-12
- Decision owner: Operator
- Supersedes: the default-mode decision in
  `docs/decisions/authentication-deployment-model.md`
- Amends: authentication defaults, network exposure, credential logging, and
  trusted-proxy compatibility only as described below

## Context

The first-release authentication decision selected sole-operator Google OIDC
as the default. That boundary is sound once configured, but it prevents a clean
checkout from starting: an operator must first create an OAuth client, register
a callback, and supply five authentication values. Disabling authentication
implicitly would make first run easy by turning a console that launches shells
with operator credentials into an unauthenticated remote-code-execution
endpoint.

The product needs progressive disclosure without making the least secure mode
the default. Network bind is not a reliable exposure signal in a container:
the process binds a wildcard address while Compose publishes loopback. The
browser-facing allowed origin is the available operator declaration, not a
network access-control mechanism.

## Decision

### 1. Password authentication is the zero-configuration default

The default mode is `password`, for exactly one operator and no user database,
roles, registration, or password recovery flow. On first boot Deck generates a
high-entropy password and an independent session-signing secret. It persists
only the password hash and signing secret in runtime-private durable state,
never in project state, the control database, a configuration file, an audit
event, or telemetry. An operator-supplied password hash may pin the credential;
plaintext password configuration is not accepted.

The generated plaintext is disclosed exactly once through the initial startup
output and is not retained. This is a narrow exception to the default
ban on authentication material in logs: the event is visibly identified as a
one-time bootstrap credential, is emitted only when new durable auth state is
created, and cannot recur after restart. Deck never logs a supplied password,
a submitted password, a hash, the session secret, or a session token. A failed
or uncertain durable write emits no plaintext and startup fails closed.

Password verification uses a memory-hard or established adaptive password
hash with a versioned encoding and constant-time library verification. Login
has bounded request bodies, per-source and global rate limits, exponential
backoff, and a bounded lockout that survives concurrent requests. Responses do
not distinguish an unknown operator, a wrong password, or a locked account.
Successful login issues the existing identity-free, session-bound cookies and
CSRF token; logout and expiry keep their existing behavior.

### 2. Authentication can be explicitly disabled only for declared loopback

Mode `none` is an explicit opt-out and is never selected by omission. It is
accepted only when every configured browser-facing allowed origin has an HTTP
or HTTPS loopback IP host. A public or non-loopback origin with `none` fails at
startup and names both remedies: choose an authenticated mode or correct the
declared origins.

This check is a declaration heuristic, not containment. It cannot prove how a
container port, reverse proxy, tunnel, or host firewall is exposed. The UI,
health surface, documentation, and effective configuration must call the mode
unauthenticated; Deck must never describe it as safe merely because the
declared origin is loopback. The default Compose port remains loopback-only.

In `none` mode the authentication middleware performs no identity ceremony,
but HTTP mutation Origin checks, strict WebSocket Origin checks, controller
leases, and every other authorization-independent guard remain active.

### 3. OIDC and trusted proxy remain protected deployment modes

Mode `oidc` is the existing sole-operator Google OIDC implementation and threat
model. `builtin` remains a deprecated input alias that normalizes to `oidc`
before the server reports its effective mode, so an existing deployment does
not lock out its operator during upgrade. Mode `trusted_proxy` is unchanged:
only configured proxy source addresses may assert the configured identity
header, and Deck strips the header before downstream handling.

All modes except `none` use one authenticated browser session boundary for HTTP
and WebSocket control. There is no fallback between modes: incomplete password,
OIDC, or trusted-proxy configuration fails startup rather than silently
selecting another mode.

### 4. Cookie security is derived from the declared origins

Deck derives Secure-cookie behavior from the allowed-origin schemes. All
origins in one deployment must use the same scheme. HTTPS selects Secure
`__Host-` cookies; loopback HTTP selects plain host-only cookie names. An
operator cannot independently choose a contradictory cookie setting.

### 5. Installation mode is durable and changes only offline

The normalized authentication mode is recorded in `auth-mode.json` beside the
control database in the durable installation data root. The receipt is a
regular owner-private file, created and replaced atomically, and contains only
a version and one canonical mode. Boot verifies it under the exclusive backend
lock before password-state creation, database migration, provider construction,
or socket binding.

A fresh installation creates the receipt from its validated effective mode;
this preserves the zero-edit password first run. An existing installation with
no receipt is a pre-receipt upgrade and fails closed with the exact offline
`noise deck auth-mode adopt --mode <mode>` remediation. Adoption never changes
an existing receipt. Later changes use
`noise deck auth-mode transition --from <recorded> --to <configured>` while the
backend lock proves Deck is stopped; the exact source must match and the target
must pass its complete configuration validation. Alias input is normalized
before writing, so `builtin` is never durable state.

Password mode rejects residual OIDC-only values. Compose renders a mode
explicitly, preflights it before provisioning, and its healthcheck compares
that rendered value with the mode reported by the live authentication handler.
Those deployment checks diagnose rendering drift; the durable receipt remains
the authoritative cross-redeploy fence.

### 6. Enforcement and verification

The configuration loader owns mode normalization, loopback-only `none`
admission, homogeneous origin schemes, and cookie derivation. The auth package
owns password throttling, lockout, generic refusals, session issuance, and the
no-op `none` middleware. Boot owns create-once durable auth state and must
complete its atomic private write before disclosing a generated password.

Tests must cover default password startup, create-once persistence, file
permissions, restart stability, supplied hashes, no plaintext retention,
concurrent wrong-password attempts, rate limits and lockout expiry, generic
refusals, session/CSRF behavior, explicit loopback `none`, public-origin
refusal, the `builtin` alias, OIDC and proxy regression behavior, cookie
derivation, and a zero-edit Compose first run. They also cover private atomic
receipt creation, malformed and insecure receipt refusal, mismatched-mode
startup before every other side effect, exact-source offline transitions,
rendered/live mode agreement, and a last-released pre-receipt upgrade fixture
whose intended OIDC mode survives only through explicit adoption. An omitted
mode that would otherwise become password must refuse, and release cannot
require remove/re-add or post-start manual configuration repair. Effective-
state acceptance must also prove that Compose publishes loopback by default;
the origin declaration test alone is not a network-boundary claim.

## Consequences

First run has authentication without external identity-provider setup. Public
deployments can opt into OIDC or trusted proxy, and a deliberate local-only
operator can opt out. Existing installations perform one explicit adoption on
the first receipt-aware upgrade; later configuration drift cannot silently
change their authentication boundary. The implementation gains durable
bootstrap-secret, password-throttling, and small receipt code, but each
mechanism closes a named credential, downgrade, or brute-force threat and has
one enforcement owner and fail-closed behavior.

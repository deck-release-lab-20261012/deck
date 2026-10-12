// Package auth implements single-operator authentication for HTTP and
// WebSocket control paths: a generated or pinned sole-operator password,
// sole-operator Google OIDC, or trusted reverse-proxy identity. Network
// location is never treated as authentication.
//
// # Password authentication boundary
//
// Password mode creates a high-entropy bootstrap password and an independent
// signing secret under the runtime state directory. Only the adaptive bcrypt
// hash and signing secret are durable; boot discloses generated plaintext once
// after the create-once private file is synced. Login bodies and password
// length are bounded, and one mutex serializes bounded per-source and global
// exponential backoff and lockout state. Successful login issues the same
// browser-session and CSRF cookies as OIDC, without OIDC identity claims. There are no users, roles,
// registration, recovery, or plaintext configuration paths.
//
// # OIDC authentication boundary
//
// OIDC browser login uses Google OpenID Connect for exactly one operator
// account. There is no fallback between authentication modes. This concerns
// only the ceremony at the web boundary — no users, no roles, no Google data
// access, and no second source of authorization truth.
//
// # The ceremony, and what it refuses
//
//   - Authorization Code flow with PKCE S256, scope `openid email` only.
//     The issuer and endpoints are fixed deployment code, never discovery
//     results or operator-supplied URLs (tests inject fakes through the
//     same fields).
//   - Each login holds independent state, nonce, and verifier values in a
//     bounded, short-lived, consume-once server-side transaction store. The
//     transaction cookie is HttpOnly, SameSite=Lax, host-only, short-lived,
//     and cleared on every callback.
//   - The callback URI is the exact configured value. Request Host,
//     forwarding headers, and callback parameters never determine a
//     redirect target.
//   - A callback succeeds only after a bounded token exchange and RS256
//     validation against Google's JWKS, with strict issuer, audience,
//     authorized-party, expiry, nonce, subject, email_verified, and
//     sole-operator email checks. Every failure is a generic 401; account
//     and token detail goes to logs, never to the response.
//   - Google tokens are never persisted, logged, or rendered. Success
//     issues a HMAC-signed HttpOnly session cookie carrying a stable browser
//     login ID and verified issuer, subject and email, together with its
//     session-bound CSRF cookie; logout is a CSRF-protected
//     POST that clears them and signs nobody out of Google.
//   - Startup and health perform no Google request: provider unavailability
//     affects a login attempt, nothing else.
//
// # Trusted-proxy mode
//
// The identity header is honored only when the peer address is one of the
// configured proxy addresses; from anyone else the request is refused
// without the header ever being read. The header is consumed
// and removed before the request continues. Browser-level CSRF in this
// mode rests on the server's strict origin guard plus the proxy's own
// protections; the token CSRF here is local-session-bound by
// construction.
package auth

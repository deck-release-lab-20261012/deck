# Workspace browser interoperability probe

`web/tools/security-go-probe.mjs` runs the built production UI and Chromium
WebCrypto against the actual Go workspace gateway, registry, proof verifier,
browser grant store, and private Unix proxy. It does not intercept or replace
security API responses. The Go fixture exists only in a `_test.go` file and
starts only when the probe explicitly enables it.

Run from the repository root with the pinned browser sidecar available:

```sh
npm exec --yes --package=pnpm@11.18.0 -- pnpm --dir web build
node web/tools/security-go-probe.mjs
node web/tools/onboarding-go-probe.mjs
```

The probe uses the repository's pinned `browser.mjs` resolver. In the deployed
workspace, set `NOISE_BROWSER_WS`; an unavailable sidecar is a failure, never
a reason to install or launch another browser. CI may use its already
provisioned local Chromium through the same resolver. The probe itself never
installs a browser. It starts an opt-in Go race test on an ephemeral `127.0.0.1` port.
The fixed test origin is `https://localhost:<port>` and the RP ID is `localhost`:
the WebAuthn library correctly refuses an IP address as an RP ID. Chromium
accepts the fixture's self-signed TLS certificate in its isolated test contexts.
This exception applies only to the test certificate, not origin or RP validation.

The only persisted probe artifact is an origin/readiness file under ignored
`run/security-go-*`, removed at shutdown. Browser contexts, temporary control
databases, and downloaded recovery kits are disposable. The probe reads kit
downloads into memory, imports those actual bytes, and deletes each download.
It creates no screenshots, traces, HAR files, cookie exports, or secret logs.

The journeys cover:

- Password enrollment, reload/resume, persisted envelope readback, P-256
  challenge verification in Go, recovery-kit download/import, and native
  completion before browser admission.
- Loss of the Google session during recovery verification: the real gateway
  returns 401, the recovery form disappears, and a new Google sign-in requires
  fresh password proof before creating and checking a new recovery candidate.
- A separate browser's Google session being denied private APIs until it
  verifies an unlock method. Wrong passwords fail; joining a running workspace
  does not initialize, mount, or restart the synthetic native runtime.
- The combined project-preview UI loading synthetic settings through the real
  private Unix proxy. Google alone cannot read these settings; method proof
  permits access. This does not exercise a preview server or issue an entry ticket.
- A preview mutation losing its workspace cookie while Google remains valid:
  the actual proxy's JSON 403 immediately removes private UI even with browser
  timers paused. Fresh method proof restores access without remounting.
- Password and recovery replacement, including failed candidate checks,
  continued old-method availability before activation, and revocation of
  browsers authorized by the removed method. An unrelated browser stays open.
- Protection of the last everyday method, adding another password, checking
  its persisted envelope, enabling it, and removing it with fresh authorization.
- Logout revoking only that browser while the runtime and another authorized
  browser remain available; rejection of a replaced recovery key and admission
  with the downloaded replacement kit.
- Explicit lock revoking grants before private stop preparation. An uncertain
  synthetic stop is observed after reload without repeating the operation;
  even positive storage closure cannot complete an unconfirmed lock operation
  or clear its pending reference. The post-preparation operation must also
  complete before the UI confirms the lock. A later explicit unlock dispatches
  mount/start under a new authorized operation.
- Passive request checks that encryption passwords, recovery keys, and proof
  private keys do not appear in security API payloads. A transient volume secret
  is sent only for explicit initialization and unlock.

Three substitutes are deliberate: a test-only sign-in route issues synthetic
Google session cookies; a synthetic native controller reports mount/process
observations; and an authenticated Unix backend returns synthetic application
data. Secure cookies, CSRF, the enrollment receipt, envelopes, signatures,
registry transactions, revocation, and private proxy admission are real.

This is interoperability evidence, not deployment qualification. Deployment
qualification still requires actual Linux host, gocryptfs/FUSE, rootless
Podman, real agent CLI interruption, Google OAuth, backup/restore, and
ordinary host-reader tests. This probe also does not qualify WebAuthn PRF,
hardware security keys, Bitwarden, 1Password, passkey sync, or any
browser/OS/password-manager combination. Those require the actual intended
authenticator and client environment.

The onboarding probe runs the same production UI against separate fresh Go
fixtures with `optional` and `unavailable` encryption policies. The actual
registry enforces the one-use setup capability, pinned owner and immutable
protection choice. The plain service and private Unix proxy admit the browser
only after setup completes and the native observation reports a running
workspace. No encrypted browser grant is issued or encrypted controller called.
The probe covers a lost start response, reload without replay, separate-browser
sign-out, returning-owner admission, an explicit fresh start after a stopped
runtime, and rejection of a different Google identity. An ineligible test login
before ownership cannot consume setup; choosing the eligible account then
redeems the same private setup handoff. The account-switch action requests
Google's fixed `select_account` prompt, while ordinary sign-in is unchanged.
Its Google, native and application substitutes carry the same qualification
limits described above.

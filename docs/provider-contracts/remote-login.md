# Finish remote harness login

Deck provides shared, authenticated callback handoff while leaving OAuth and
credential storage inside native CLIs. This is a transport feature, not a
replacement sign-in service. It covers the explicitly reviewed flows below;
there is no generic relay for an arbitrary harness or localhost URL.

Exact executable admission follows the shipped Codex and Pi image pins via
`internal/harnesslogin/versions.go`, which the daily updater moves with the
Dockerfile. Pi's nested `pi-ai` package must match its CLI pin. New versions
do not require separate manual qualification. Package identity, process
ownership, callback validation and ordinary compatibility tests still apply.
The support matrix and qualification history below remain historical evidence;
an automatic pin update does not claim a new real-account sign-in test.

## Operator instructions

For Codex:

1. Create a supported Codex session. When no regular `auth.json` is found in
   its effective native home, Deck offers **Codex login helper** after the
   terminal attaches. This metadata-only hint is not an authentication check:
   Deck does not read credentials or establish subscription validity. File presence suppresses this initial guidance, but a later supported native
   browser launch can still raise the helper.
2. Choose your sign-in option in the real Codex terminal inside the helper.
   It is the same session and terminal, with native keyboard interaction;
   Deck does not choose a subscription or send guessed prompt responses.
   API-key and other native options remain available. **Use terminal instead**
   dismisses the helper whenever you prefer the native interface.
3. When Codex declares its supported browser login, select **Open OpenAI
   sign-in**. The helper explains before opening the tab that the eventual
   “localhost refused to connect” page is expected: Codex runs on Deck's host.
   Authenticate directly with OpenAI using the native authorization URL.
4. Copy the entire address from that localhost tab's address bar, including
   the actual port, into **2. Paste the return URL**, then select **Finish
   sign-in**. Do not paste it into terminal input. Deck does not read your
   clipboard automatically.
5. Only verified native completion produces **Native login completed** and
   **Continue to Codex**. A disappearing pending attempt is not success.

Codex may use `127.0.0.1` rather than `localhost` in its return URL. Both
spellings are supported on ports 1455 and 1457, but the submitted URL must
preserve the exact host and port from that native login attempt. Do not replace
one spelling with the other or with Deck's hostname.

For Pi, start `/login anthropic` or `/login openai-codex` in the native terminal
and choose account login. For Anthropic, also choose **Browser login (default)**
when Pi asks for the login method. Open its native authorization link and
authenticate with the provider. Deck raises the shared completion dialog for a supported
pending attempt; select the attempt you started if several are waiting. Paste
its complete localhost return address into **Localhost callback URL** and choose
**Deliver callback**. **Callback delivered** confirms transport only, because
Pi exchanges tokens after its HTTP response; check the CLI for the result.
Working browser, device, API-key and native manual-input flows remain available.

An attempt expires five minutes after its native browser launch. The backend
retains at most 1,024 attempt registrations per incarnation; reaching that limit
disables new handoffs until the backend restarts. A submitted
handoff is consumed before transport and never automatically retried. A
malformed URL can be corrected without consuming it. **Use terminal instead**
(Codex), **Not now** (Pi), the close button and Escape from dialog controls
hide the helper without ending native login. Escape inside the embedded Codex
terminal remains native input. Dismissal suppresses automatic reopening;
Codex also remembers a dismissal before any attempt exists for the current
mounted session. Use the visible **Open login helper** action in the connected
Codex session, **More → Finish harness login**, or the terminal context menu to
resume. Pi retains its contextual **Finish login** action and **Cancel login**,
which ends only its Deck handoff. Codex cancellation stays in the native terminal.
A callback already in flight may have arrived; after an uncertain result, check
the CLI before starting another login.
The original callback URL may remain in browser history or the clipboard.
Deck clears its input, but does not promise to erase browser or extension memory.

An empty list means no supported, live attempt was registered for that session.
Possible causes include an unsupported flow/version, a custom browser/PATH,
missing installed opener, expiry, native CLI exit, or a session launched before
this feature was available. Continue with native login options or explicitly
start a new session/login. Deck does not restart or cancel a CLI to find a login.

The [pending-dialog contract and visual references](remote-login-ui.md) describe
automatic presentation, dismissal and controller-loss behavior.

## Deployment boundary and configuration

The supported topology is **one Deck instance per operator**, with the backend
and its native CLIs in the same Linux PID/network environment. Operator
instances need separate runtime users/provider homes, private control state,
tmux namespaces and network environments. A submitted container ID, project ID,
port or URL never selects a destination. Different backend incarnations have
different in-memory attempts and handles.

The first-release Deck workload remains **unconfined and single-tenant**.
This feature does not isolate hostile agents sharing a UID or provider home,
and is disabled with `auth.mode: none`. A shared instance routing across
per-user containers needs an enforced operator-to-runtime mapping and a
runtime-owned connection capability; that topology is not implemented here.
Neither the process checks nor this document establish container isolation.

The shipped image installs a native browser opener at
`/usr/local/libexec/noisedeck-login/xdg-open`. At boot Deck checks the declared
CLI's exact `--version` output, then supplies launch-only PATH/BROWSER additions
for admitted harnesses. Admission is checked again before each new/recovered
launch. Pi also requires the supported npm layout and `pi-ai` package metadata
matching the shipped Pi version: its CLI uses a caret dependency, so the CLI version alone is not
enough to qualify OAuth. Only packaged code manifests are read, not account
or session files. Custom BROWSER or descriptor PATH/BROWSER configuration
keeps the native flow and disables handoff. Existing panes are not rewritten.
The original native browser opener still runs where one was available. No
provider home configuration or credential file is edited by Deck.

`harness_login.enabled` defaults to true; set
`NOISEDECK_HARNESS_LOGIN_ENABLED=false` to disable it. In `trusted_proxy` mode,
set `harness_login.trusted_proxy_identity` (or
`NOISEDECK_HARNESS_LOGIN_TRUSTED_PROXY_IDENTITY`) to the exact identity asserted
for this instance's sole operator. Missing identity disables handoff; a different
verified proxy identity cannot list, claim or submit its native attempts.
Configure the proxy to admit only that operator to the whole instance; this
setting restricts handoff, not other Deck endpoints. Password and Google OIDC
already authenticate one configured operator.

Use HTTPS and list the exact public origin in `server.allowed_origins`.
All state changes require an authenticated JSON POST, a matching Origin and a
per-operator handoff CSRF header. Password/OIDC also require Deck's normal
session-bound CSRF header. The browser supplies both. There is no callback GET,
query-string submission, cookie forwarding, automatic redirect or public native
listener endpoint.

### Reverse proxy requirements

DNS/nginx cannot intercept localhost on the user's computer. Front only Deck's
protected endpoint, never port 1455, 1457 or 53692. Request-body capture, request
mirroring, body analytics, WAF payload logs and replay/debug middleware must be
disabled for `/api/harness-login`. Do not persist its POST body to disk.

For nginx, copy the deployment's existing authenticated proxy rules into an
exact `/api/harness-login` location, then add these directives. Keep its fixed
Deck upstream, `auth_request` and identity-header stripping/assertion rules.
An exact location does not inherit a sibling `/` location: omitting those
rules could let a caller spoof the trusted operator identity.

```nginx
# Inside the existing authenticated Deck proxy location for this endpoint:
client_max_body_size 10k;
client_body_buffer_size 16k;
client_body_in_file_only off;
proxy_request_buffering off;
proxy_buffering off;
proxy_no_cache 1;
proxy_cache_bypass 1;
access_log off;
```

See nginx's [request buffering](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_request_buffering)
and [client body buffers](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_body_buffer_size).
This is an operator configuration example, not an applied production change.
Deck cannot enforce an external proxy's logging or storage policy. Verify the
actual proxy with synthetic canaries before allowing real callback submissions.
Do not use real authorization codes in diagnostics, screenshots or recordings.

## Harness support matrix

Pins below are the original implementation's historical baseline, not today's
image pins; current Codex/Pi admission is recorded above. **Implemented** means
Deck has an explicit transport contract, not that an account round-trip passed.
**Unsupported** means no callback is forwarded for that flow; it does not disable
native authentication. Device/polling flows do not need localhost handoff.

| Harness | Pin | Native authentication evidence | Callback and completion evidence | Deck handoff disposition |
| --- | --- | --- | --- | --- |
| Claude | 2.1.269 | Current native documentation: browser account login, manual code fallback, API/cloud credentials | Docs describe local callback and manual fallback. Exact pinned listener ownership, path, lifetime and responses unmeasured | Unsupported; preserve native flow |
| Codex | 0.154.0 | Version-tagged login source: browser OAuth with state/PKCE; official docs also describe device auth and API authentication | `127.0.0.1:1455`, registered fallback port, `/auth/callback`; native token exchange and credential persistence precede success redirect. Local success requires another request; redirect can contain an ID token. See below | Implemented for native localhost:1455 and localhost:1457 browser flows. Pinned native launch, browser opener, listener/accepted-peer ownership and state rejection probes passed. Account round-trip remains unverified |
| Kimi | 0.42.0 | Exact npm artifact: native Kimi login opens a device verification URL and polls the token endpoint | That account flow does not depend on a browser-to-localhost callback. Other callback code in the bundle belongs to MCP and does not prove harness-login support | Preserve native device flow; no callback relay for that flow |
| OpenCode | 1.18.30 | Current provider docs describe provider-specific connection flows; exact package metadata inspected | Exact pin's provider-by-provider listeners and completion sequences unmeasured | Unsupported; qualification must name the selected auth provider |
| Command Code | 1.53.1 | Exact bundled docs: `/connect`, native account login, ChatGPT subscription and Copilot device login, BYOK | ChatGPT provider package installs on demand; CLI pin alone does not pin that flow. Callback ownership and responses unmeasured | Unsupported; include provider package identity in any future qualification |
| Cline | 3.0.61 | Exact installed package README: explicit `cline auth`, Cline, ChatGPT and OCA OAuth; API credentials | Exact bundled core 0.0.82 binds `localhost:1455/auth/callback`, validates state, returns static 200 and closes connections before exchanging tokens. Hostname resolution may select IPv6. Cline account code defaults to device auth. Library lifecycle callbacks are not CLI hooks | Unsupported: native browser-opener integration, address family and complete response delivery are not qualified |
| Kilo | 7.6.2 | Exact package README names `kilo auth` | Exact pin's provider-specific callback, ownership and completion contracts unmeasured | Unsupported |
| Qwen | 0.23.3 | Exact npm artifact: Qwen OAuth device-code grant and polling token endpoint | Native Qwen account flow does not need localhost callback. MCP callback code in other chunks is a separate concern | Preserve native device flow; no callback relay for that flow |
| MiMo | 0.1.14 | Exact installed README: Xiaomi OAuth, Codex OAuth, existing-credential import option | Bundled native executable's callback ownership and completion unmeasured | Unsupported; credential import is excluded from this feature |
| Qoder | 1.1.50 | Exact npm README names native login; current docs describe browser and PAT methods | Docs acknowledge local callback failures; exact pinned port, attempt binding and completion unmeasured | Unsupported; printing an auth link alone does not solve a remote callback |
| Cursor | 2026.09.10-fd3934a | Current CLI docs describe browser login and API credentials | Exact pinned callback versus server-polling behavior, ownership and completion unmeasured | Unsupported; do not infer a localhost flow from "browser login" |
| Devin | 3000.10.21 | Current native docs describe `devin auth login` with Devin and legacy Windsurf enterprise account choices | Native credential storage is documented; exact pinned callback/polling behavior, ownership and completion unmeasured | Unsupported; preserve account/admin restrictions and exclude credential copying |
| Grok | 1.0.30 | Exact npm README describes browser login and API credentials; current official reference also documents device auth | Exact pinned callback, ownership and completion unmeasured | Unsupported; preserve working native methods |
| OMP | 18.1.18 | Exact npm artifact contains native OAuth/manual-input integrations for multiple providers | Callback paths and device-grant implementations vary by auth provider. Their presence in a bundle is not a measured CLI contract | Unsupported per provider; no SDK or auth-broker integration |
| Pi | 0.85.1; pi-ai 0.85.1 | Exact installed artifact: provider-specific OAuth, device auth and native manual redirect/code input | OpenAI uses localhost:1455/auth/callback; Anthropic uses localhost:53692/callback. Both check state and return static 200 before native token exchange. OpenRouter uses a random port/path | Implemented for ChatGPT and Anthropic. Both pinned native CLI launch, opener, listener ownership, accepted connection and state rejection probes passed. Full account sign-in unverified. Other Pi auth providers unsupported |
| Shell | system shell | No harness account authentication | Programs invoked inside a shell have no declared harness-login contract | Unsupported as a generic callback destination |

The image also pins Crush 0.94.1, but it has no Deck provider descriptor at this
baseline. Its operator-invoked flows require separate investigation; installing
it does not make it a supported Deck callback destination.

## Transport and verification

The native browser opener registers an authorization launch over a private
0600 Unix socket. Linux `SO_PEERCRED` supplies its PID; Deck checks ancestry
against a reconciled pane PID/start time and session generation. Pi's listener must belong to that exact pane process. Codex's reviewed npm
launcher starts a direct native child: Deck additionally resolves the pinned
platform package, checks the binary version, and requires its kernel executable
identity. A direct native Codex launch is also supported. No arbitrary
listener-owning descendant can register. The URL is validated
in memory. For Codex, Deck retains the original authorization URL in backend
memory so an authenticated, session-bound, CSRF-protected action can retrieve it
for an explicit browser click. Responses are no-store and navigation sends no
referrer. It is not logged or persisted, and is cleared on submission,
cancellation, replacement or observed expiry; expiry cleanup is lazy. Pi keeps
only its state hash and fixed callback contract. No terminal text, provider
transcript, auth database or credential-file contents are read. The optional
fresh-Codex-session hint checks only file metadata, using the same effective
HOME/CODEX_HOME and override precedence as the explicit native launch environment.

Explicit callback submission (or Pi cancellation) claims a random, one-use
handle bound to the
operator, native attempt, session generation, PID/start time, network namespace
and listener socket inode. Before writing callback bytes, Deck connects only to
the approved numeric loopback address and verifies that the accepted server-side
socket is owned by that same native process. It repeats the check for Codex's
second request. Caller-supplied URLs never control DNS, routing or request headers.
Expiry, process/listener replacement, restart and replay fail closed.

A claimed handle ends in exactly one of three ways. Submission consumes it
before transport and never retries, and a malformed callback URL is corrected
without consuming it. Explicit cancellation is terminal: the attempt is never
offered again through Deck, while the native login keeps its own behavior.
Dismissal is the non-destructive release: the same native attempt returns to
the pending list only while the identical process, listener socket, session
generation and network namespace are still live, the registration is unexpired,
and the requesting operator is the one that claimed it. The attempt stays bound
to the operator that first claimed it: a reopened selector from that operator
claims it through a fresh handle, and no other operator can claim the released
attempt. A released handle stays consumed and can never be submitted, cancelled
or dismissed again. An expired, exited, replaced or restarted attempt fails
closed for dismissal and never reappears.

Only the captured HTTP authority/path, one `code`, the matching native `state`
and optional `scope` are accepted. Fragments, userinfo, encoded paths, duplicate
or unknown query keys, control characters and error-description payloads are
rejected. Native state/PKCE and provider account/workspace restrictions remain
in force. Deck does not exchange tokens, use an SDK, copy `auth.json` or offer
credential import.

Native response reads are bounded to 64 KiB and the operation to the shorter of
20 seconds and the handoff's remaining lifetime. Bodies, response cookies,
transport errors and redirect query strings never reach the browser or logs.
Codex's local 302 may contain an ID token: Deck discards that query, privately
requests the fixed `/success` path, and requires its 200 response. Hosted or
unknown redirects fail closed. Pi's reviewed 200 response establishes delivery
only. All HTTP/UI results use a fixed status vocabulary.

Verification performed:

- Codex helper fixtures cover initial metadata hints, the same live xterm and
  controller through dismissal/reopening, native keyboard input, session changes
  and controller loss, immediate opener notifications, callback privacy and
  no-referrer browser navigation. Desktop and phone geometry checks pass with
  both licensed and OFL fonts. These use synthetic accounts/responses and do
  not establish a real account round-trip.
- Go transport/HTTP tests with synthetic native responses cover success,
  malformed URLs/SSRF, authentication, both CSRF checks, configured proxy
  operator restrictions, cross-operator/session/instance bindings, expiry,
  cancellation, dismissal and re-claim of a released attempt, refusal of a
  released attempt to another operator including under a simultaneous
  dismiss/begin race, replay,
  concurrent submissions, simultaneous submission/dismissal and duplicate
  dismissal races, CLI exit/replacement and secret-bearing bodies, headers,
  redirects and transport errors.
- Real Linux subprocess/socket tests use ephemeral ports, prove accepted-peer
  ownership, and observe **zero bytes** when another process accepts the socket
  or a listener-owning tool descendant tries to register through its own opener.
  These are process tests, not hostile cross-container isolation tests.
- The real-browser terminal menu probe drives the built app with mocked APIs
  and terminal transport on desktop and phone layouts. It checks explicit POST,
  cleared input during delivery, sanitized errors/results, both CSRF headers,
  no URL/storage persistence and no callback bytes in terminal input frames.
- The opt-in `TestNativePiBrowserRegistration` drives the unmodified
  Pi 0.85.1 through both native login dialogs. Run it with
  `NOISEDECK_TEST_PI_EXECUTABLE` set to the absolute pinned executable path,
  `TMPDIR=/tmp`, and `go test -v -run TestNativePiBrowserRegistration ./internal/harnesslogin`. It drains terminal
  output without inspection/storage, proves native opener and listener/accepted
  socket ownership, and observes native rejection of incorrect state. It uses
  isolated Pi state and no account credentials or valid authorization codes.
  The corresponding `TestNativeCodexBrowserRegistration` uses
  `NOISEDECK_TEST_CODEX_EXECUTABLE` and provides the same observations for
  Codex 0.154.0 with an isolated native home. Neither probe completes OAuth.

Remaining qualification limits:

- No authorized provider-account round-trip, successful token persistence or
  account/workspace restriction rejection was exercised. Mocked completion
  responses do not establish those native outcomes.
- Codex 0.154.0 was inspected at its exact source tag. The installed CLI is
  0.153.4 and is not admitted. A separate unmodified 0.154.0 binary was fetched
  into the task build directory with its npm integrity verified. Its native
  launch/opener/ownership/state-rejection probe passed both directly and through
  the integrity-verified npm launcher. The test reserves both
  native ports and skips if either is occupied. It releases only its own
  default-port listener after proving the cancellation connection belongs to
  the test CLI; the pinned retry loop never sends a second cancellation. No
  existing operator listener is contacted. Successful `/success` completion
  and the 1457 fallback are still source/mock qualified, not account tested.
- Other installed-version mismatches include Kimi 0.41.0, OpenCode 1.18.29,
  Command Code 1.49.1, Kilo 7.5.14, Qwen 0.23.0, Qoder 1.1.45 and Grok 1.0.13.
  Package/documentation inspection is labeled separately in the matrix.
- IPv6-only listeners, other auth providers/plugins, custom issuers and
  CLI versions different from the shipped pins are not forwarded. The updater
  moves executable admission with those pins; tests check that they stay aligned.
- No production proxy, TLS/DNS, OAuth configuration or deployment was changed.
  Production proxy secret-handling and actual operator-instance isolation still
  require deployment-level verification.

## Evidence sources

- [Deck principles](../PRINCIPLES.md),
  [provider inventory](README.md), and
  [project authority](../adr/0003-project-security-domains.md).
- [Codex native login server at the pinned tag](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/login/src/server.rs),
  [native success handling](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/login/src/success_page.rs), and
  [official remote authentication guidance](https://learn.chatgpt.com/docs/auth#login-on-headless-devices).
- Exact npm artifacts, inspected in memory without installation: Kimi 0.42.0,
  Command Code 1.53.1, Qwen 0.23.3, OMP 18.1.18, OpenCode 1.18.30,
  Kilo 7.6.2, Qoder 1.1.50 and Grok 1.0.30. Metadata and tarballs were fetched
  from `registry.npmjs.org`; no runtime auth qualification follows from these
  static inspections.
- Installed Cline 3.0.61 README and bundled `@cline/core` 0.0.82 auth code/type
  declarations; Pi 0.85.1 bundled `pi-ai/dist/auth/oauth` implementations;
  MiMo 0.1.14 README. These are package source, not operator state files.
- Current vendor documentation (not pinned executable measurements):
  [Claude](https://code.claude.com/docs/en/team),
  [OpenCode](https://opencode.ai/docs/providers),
  [Cursor](https://docs.cursor.com/en/cli/reference/authentication),
  [Qoder](https://docs.qoder.com/cli/authentication),
  [Qoder callback troubleshooting](https://docs.qoder.com/cli/troubleshoot-auth),
  [Grok](https://docs.x.ai/build/cli/reference),
  [Devin](https://docs.devin.ai/cli/enterprise/devin-auth) and
  [legacy Windsurf](https://docs.devin.ai/cli/enterprise/windsurf-auth).

# Workspace security design reference

Generic setup and optional encryption use the [workspace onboarding design](workspace-onboarding-design.md).

The accepted workspace security export defines the layout and screen inventory
for browser enrollment, unlock, lock, recovery and method management. Its
remaining functional and copy corrections are recorded here. Further design
exports are not a prerequisite for implementation.

The canvas and interactive flow are design references. Their example keys,
passwords, credential prompts and simulated server completions are not production
behavior or evidence that encrypted storage works.

## Source and corrected export

The uploaded archive is `Deck.zip`, SHA-256
`7973c5b24ae2c735cc38a34f142d07a551e5a9c9a87778d5cb1ad98f9c4ca22f`.
It contains `Workspace Security.dc.html` and
`Workspace Security Flow.dc.html`, with the `security-r3` revision notes.
The files' embedded revision labels predate those notes; identify this source by
its content hash.

The corrected archive is `Deck-security-corrected.zip`, SHA-256
`36aa1475013121942ae41d7d5742add704179d61d5b28d73b396799bce271435`.
Only the two security HTML files and `REVISIONS.md` differ. Both security files
declare `security-implementation-1`. Raw archives, extracted design assets and
captures remain local, ignored reference material.

| Corrected member | SHA-256 |
| --- | --- |
| `Workspace Security.dc.html` | `898b061f697fc9be6d1c107489ae646e9f4be89787c8fec8e689ca8b70075328` |
| `Workspace Security Flow.dc.html` | `0051270795119d4237545b47204de7f9a4dad8b4ad797f42346ab538cf764ddd` |

## Run the prototype probe

Extract the corrected archive into a project-local ignored directory. Cache the
exact `REACT_URL`, `REACT_DOM_URL` and `BABEL_URL` dependencies declared in its
`support.js` as `deps/react.js`, `deps/react_dom.js` and `deps/babel.js`, respectively.
The probe verifies each cached file against the corresponding SHA-384 integrity
declaration. It serves the export on an ephemeral loopback port and fulfills
those three dependency requests from the verified cache; other external requests
are blocked.

With the browser overlay enabled and `NOISE_BROWSER_WS` set, run from the checkout:

```sh
pnpm --dir web install --frozen-lockfile
node web/tools/security-design-probe.mjs <corrected-export-directory>
```

The probe uses this checkout's pinned Playwright resolver and requires the
sidecar. Desktop/mobile screenshots, example kits and the report go under
`.visual-diff/security-design-probe/`. This verifies prototype behavior, not
production encryption, WebAuthn, storage isolation or runtime locking.

## Behavior and copy corrections

- Google signs the owner in. An unlock method separately authorizes this
  browser. When storage is closed, unlocking starts the workspace; when it is
  already running, verification connects the browser without restarting it.
  Password and passkey alternatives retain that context.
- A recovery key remains usable until a replacement **recovery key** has been
  saved and checked. Adding a passkey or password does not consume it.
- The recovery kit says: “If you lose this key and every unlock method, nobody
  can recover your locked data.” Other enrolled methods can still open storage.
- Host boundary copy says: “Deck gives the host no override for unlocking or
  recovering your workspace.” Keep the disclosure about deliberate inspection
  of a running workspace. Do not promise privacy from a malicious host.
- A browser may have saved a passkey that cannot perform encryption here.
  Such a method is “Not enabled,” rather than “Not saved.” A successful check
  establishes that it worked in this browser, without promising compatibility
  with every browser or password manager.
- An expired or used invitation cannot reset an existing workspace. The screen
  must not claim that nothing was set up from a previously used link.
- “Key copied” follows fulfilled clipboard access, including a successful
  fallback result. Failure remains visible. Download initiation says “Download
  requested”; JavaScript cannot establish that a file was saved to disk.
- Import opens a real file chooser and reads the selected example kit. Invalid
  files show an error. Example-key and provisional-format labels remain visible;
  the prototype's key is not the production encoding specification.

Production success states must follow the corresponding credential or server
result. No timer, demonstration button or preview state can authorize access,
enable a method, or report that storage is locked.

The enrollment renderer uses the implemented minimum of 15 password characters.
Before storage initialization, a method has only passed its saved-envelope
unlock check: the screen says “Passkey checked” or “Password checked,” not that
storage opened. The completion screen follows confirmed initialization; its
credential rows describe the checks separately. An interrupted setup says the
recovery key was not **checked**, since Deck cannot know whether a copy was saved.

## Enrollment renderer and visual checks

`web/src/app/security/enrollment.ts` renders typed enrollment state.
`enrollment-actions.ts` forwards explicit gestures and validates password entry;
the coordinator supplies the credential and server operations. Rendering a
success state does not grant access.

`web/src/app/security/coordinator.ts` gates the production entry before
`LiveWorkspace` is constructed or any private workspace request is made. The
recognized legacy authentication service retains its existing behavior only
when the security protocol marker is absent. An unknown marker or unavailable
security state fails closed. For a sealed workspace, admission requires all of
`ready`, a current browser grant, observed open storage and a running runtime.
Revocation, session expiry and loss of state observation dispose private views
and connections. Signing out revokes browser access without locking storage;
locking requires a fresh method proof and waits for positive native closure.

The invitation fragment is removed before navigation. An exact-origin handoff
puts its bearer in the gateway's short-lived HttpOnly cookie; Google redirects
carry no invitation token. Passwords, PRF results and recovery secrets stay in
browser memory. Copy, file export, printing and import use the same production
recovery key. Import parses locally and verifies the saved envelope. Printed
kit frames are disposed with the controller's secret lifetime.

The request client, envelope ceremonies and kit parser live under
`web/src/security/`. A saved-method check fetches persisted ciphertext again;
initialization requires separately checked everyday and recovery methods plus
a fresh everyday proof. Native requests reserve a public operation ID before
submission. After a lost response, reconnection observes that ID; it never
replays the mutation. Only public instance/operation hints enter session storage.
Interrupted initialization in a new Google session requires fresh proof of the
original saved method before continuing the same server-owned operation.

`node web/tools/security-coordinator-probe.mjs` exercises the production entry
and browser cryptography against an isolated HTTP protocol fixture. It covers
enrollment/resume, actual recovery-file round trips, admission, already-running
browser authorization, revocation, sign-out and uncertain lock observation.
It uses the shared pinned browser resolver and requires a current `web/dist` build. Its simulated
Google and native observations do not qualify a deployed runtime or a real
password manager's passkey support.

The 20 enrollment references use `preview.html?security=<figure>` with synthetic
values isolated in `web/src/preview/security-preview.ts`. Embedded production
builds exclude this entry. The phone states use 393 × 852 without OS bands.
The only excluded pixels are the native credential picker in figure 2b; Deck
renders its waiting/cancel state and never imitates that picker.

The pinned importer accepts at most 13 figures per HTML file, with uniform
dimensions inside each file. The local `security-import-adapter` derivative
partitions the accepted figures without changing their rendered markup and
bundles the three SRI-verified dependencies. Its `import-map.json` binds source
figure hashes to importer IDs. The offline partitioned archive has SHA-256
`b4be9064703aaf35d2dd9dd0391c014340d44f0d750cd835331d3ae89e4ace1c`.

The enrollment helper applies the factual copy corrections above to that
derivative. Generate its subset for inspection:

```sh
python3 web/tools/security-enrollment-reference.py <security-partitioned-offline.zip>
node web/tools/security-enrollment-probe.mjs
```

The correction tool checks its input hash and writes member hashes and exact
copy substitutions beside the derived archive. It never alters either accepted
source archive. It also records all 20 source/derived figure hashes and applies
the interface sentence-case rule without CSS small caps. It applies
the export's supplied `data-viewport="narrow"` scope to its five phone artboards.
The exported `full-width` attribute is corrected to the existing Button's
`block` prop so the annotated full-width controls actually render. These resolve
the export's desktop-canvas context; production uses its real media queries.

The adapter emits one figure per document with body padding removed and its
outer annotation hidden, so each artboard starts at 0,0 before rendering. The
canvas's fractional artboard coordinates otherwise change text rasterization
when the importer crops them. Intrinsic frame markup, styles and dimensions stay
unchanged. The context CSS hash and each generated document hash are recorded in
the derivative provenance. Production and preview receive no pixel shifts.

The pinned importer records a 1502 × 818 canvas viewport even for smaller
artboards. Its documented `clip` contract compares the delivered screen element
dimensions, so the capture uses `.enrollment` at the actual 1120 × 720/900 or
393 × 852 browser viewport. No provenance record is edited. A reference refresh
invalidates earlier measurements. The
browser probe uses the shared pinned browser resolver and verifies render states, labels and
gesture validation; it does not prove production enrollment or runtime locking.

## Runtime and recovery screens

The production renderer in `web/src/app/security/runtime.ts` accepts observed
state and actions from `WorkspaceSecurity`. It covers signed-out, locked,
already-running browser authorization, password and recovery proof, interrupted
setup, unavailable or incompatible unlock, locking, confirmed lock, and unknown
outcomes. Help separates reaching the host from decrypting storage. Lost-method
copy is conditional; it offers existing navigation instead of pretending to
provision or delete a workspace.

The gateway currently supplies aggregate storage/runtime state. Production does
not invent session names, stop counters, restart/lock timestamps, account email,
last-contact time, or an operator contact destination. Optional typed observations
let the shared renderer represent those layouts when evidence exists. Synthetic
values are isolated in `web/src/preview/security-runtime-preview.ts`; their
appearance in a capture does not claim that the gateway supplies them today.

`security-runtime-reference.py` adds 23 runtime/recovery figures to the 20
unchanged enrollment references. It verifies the same partitioned archive hash,
records every source/derived figure and document hash, applies the supplied narrow
mobile scope and sentence-case rule, and records factual copy corrections. Those
corrections remove unsupported diagnoses, automatic lock retry/re-entry claims,
private breadcrumbs behind a locked gate, and nonfunctional contact/provisioning
actions. Source archives stay unchanged. Generate this subset for inspection:

```sh
python3 web/tools/security-runtime-reference.py <security-partitioned-offline.zip>
node web/tools/security-runtime-probe.mjs
```

The runtime probe checks all 23 shared-renderer layouts, desktop/mobile geometry,
labels, sentence case, 44px mobile targets, and help navigation. Native lifecycle,
real Google authentication, real password-manager passkeys, and browser-to-Go
registry interoperability require separate qualification. Protocol fixtures and
pixel comparisons do not establish those boundaries.

The earlier runtime capture `20260921-024901-a0a0be` compared all 43 then-configured
enrollment/runtime states after refreshing references. All passed at the existing
0.5% threshold; the maximum difference was 0.2586%. Runtime differences were:

| Figures | Difference |
| --- | --- |
| 4a, 4b, 4e, 4f, 4g, 4h, 4i, 4j, 4m, 5b, 5d, 7c | 0% |
| 4c | 0.0047% |
| 4k, 4l | 0.0016% each |
| 4n | 0.1429% |
| 5c | 0.0165% |
| 5e | 0.0390% |
| 5f | 0.0765% |
| 5m | 0.1491% |
| 7a | 0.2081% |
| 7d | 0.0473% |
| 7m | 0.2586% |

No runtime masks were added. The schematic terminal lines behind the mobile lock
sheet remain counted as differences. The tool flagged equal 50-pixel residuals
for 4k and 4l; the image hashes differ, and the browser probe independently checks
that only 4l has the wrong-password alert and “Try again” action. The existing
2b native-credential-picker mask remains the sole exclusion. Measurements and
provenance are local ignored artifacts under `.visual-diff/`; a new reference
import invalidates these results.

## Unlock method management

`web/src/app/security/management-controller.ts` mounts through the production
coordinator's management callback. The method list, saved-method checks,
password changes, replacement and removal use the gateway's method registry.
Preparation starts with the current browser grant; activation or removal uses
a fresh active-method proof bound to the exact candidate and replacement.
The old method stays active until the replacement envelope is stored, fetched
again, checked, and activated. Active **Test** runs the same saved-envelope
check without remounting storage or rotating the browser grant.

The browser creates password, PRF and recovery envelopes. Management requests
send ciphertext, public credential fields and proofs; they never send the
workspace secret. Cancellation aborts candidate preparation, upload and readback, and disposes
opened envelopes and print frames.
An accepted operation is observed before the UI claims completion. Lost
responses retain their public operation ID in the current view and permit
observation or return to workspace reconciliation, never automatic replay.
Replacing the method that issued this browser's grant returns to the
coordinator's authorization gate.

Figure 7b is shown after recovery authorization, before constructing the private
workspace. It uses active registry methods and recorded checks, with no invented
current-browser badge or assumption about which methods are lost. Reviewing
methods returns to this checklist; **Open workspace** explicitly continues.
The used recovery key remains valid until a checked replacement is activated.

The preview has seven additional deterministic routes: 6a–6e, 6m and 7b.
`security-management-probe.mjs` checks the real renderer and gesture binder,
including labels, phone touch targets, keyboard focus containment, cancellation
and the last-method refusal. `security-coordinator-probe.mjs` additionally runs
password and recovery replacement through the production entry using real
browser cryptography against its isolated HTTP fixture. It observes revocation
of the browser authorized by the replaced method and verifies management causes
no native initialization or unlock. These checks do not qualify a password
manager, Google service or native storage deployment.

`security-management-reference.py` derives these seven figures from the same
hash-checked partitioned source. It records exact copy substitutions and member
hashes alongside the output. Corrections describe method-bound browser
revocation, saved-envelope verification, actual check timestamps and active
method counts. They remove unsupported current-browser badges and leave both
accepted source archives intact. The replacement dialog retains a Close
control so cancellation is available on phones as well as through Escape.
There are no additional masks, shifted production captures or new comps.

The management context CSS has SHA-256
`594e7cb9e424633e73970a25f8777ab9243b1c142bb0db7e71c9a235ee323315`.
The security portion of the tracked configuration contains 50 states. Other
feature states remain in the same file; a complete refresh must preserve their
references too. `security-suite-reference.py` generates the runtime
(including enrollment) and management derivatives, verifies each archive against
its provenance, requires identical bytes for duplicate asset names, and combines
unchanged members into one archive. Its provenance records all 50 figure IDs,
input archive and provenance hashes, and every output member hash. Run from the
checkout, with the browser overlay enabled in a deployed workspace:

```sh
python3 web/tools/security-suite-reference.py <security-partitioned-offline.zip>
noise visual-diff import --refresh --browser ws <complete-reference-archive.zip>
pnpm --dir web build
noise visual-diff capture --serve web/dist --browser ws
noise visual-diff compare --json
node web/tools/security-enrollment-probe.mjs
node web/tools/security-runtime-probe.mjs
node web/tools/security-management-probe.mjs
node web/tools/security-coordinator-probe.mjs
```

The browser probes use the shared pinned resolver: this deployment supplies the
sidecar through `NOISE_BROWSER_WS`; CI supplies its provisioned local Chromium.
A configured sidecar connection failure never falls back to another browser.

The shared configuration currently contains 98 states: these 50 security states
plus 48 project-preview states. The project-preview archive supplies 42
references; its six static/loading states stay explicitly capture-only. Combine
the two accepted derivative archives for the complete reference import, retaining
every member's bytes and refusing conflicting duplicate names. The combined
archive must contain exactly 92 reference documents. Keep the existing capture
setup scripts, crop selectors, thresholds and sole native-picker mask unchanged.
The source hashes and preparation rules for the other archive are in
[`project-app-preview-design.md`](../project-app-preview-design.md).

The combined archive has SHA-256
`2c1eeba2be0a1f48ca8e8d1e1d7f4eca2dab12cb53ef3381bec1167310ecdf89`.
After refreshing all references, capture `20260921-030145-3bde41` passed all 50
states at the unchanged 0.5% threshold, with no skipped states or new masks.
The largest difference was 0.4755% in mobile method management (6m). Management
differences were 6a 0.0260%, 6b 0.0339%, 6c 0.0762%, 6d 0.0156%, 6e 0.0033%,
6m 0.4755%, and 7b 0%. Enrollment and runtime differences matched the preceding
43-state capture. The two existing warnings remain: equal residual counts for
the visually distinct 4k/4l states, and the OS-owned picker mask in 2b.

This run used a serialized Vite preview server on fixed loopback port 8899.
Before and after capture, all 85 served files were independently hashed against
`web/dist`; both comparisons matched tree hash
`97f7ec9f0631d8b12af8f2310829c8a3fa352e005fa0cc6cdf1bb02ac5da8a87`.
Those supplemental manifests establish served/build equality; the CLI's
`--serve` dist-hash field was not used for this fixed-port run. The complete
comparison, references, derivative provenance, captures, and served manifests
are preserved as ignored verification artifacts.

After integrating project-preview changes, the complete reference archive
`6b77acd5a8a3cbb27d4d61939b32d8a63f52b33c243c5833b2839ac0d29640ba`
was imported and all 98 states were recaptured in
`20260921-033329-5fed5f`. All 92 reference comparisons passed at the unchanged
0.5% threshold; the six declared capture-only states were excluded from
comparison, not reported as converged. Every measured difference matched its
preceding feature-specific run. The maximum was 0.499741% in the desktop
unconfigured project menu. No mask, crop, setup script or threshold changed.
The four equal-score warnings name distinct captured images; the existing
native-picker warning remains. All 85 served files matched the current build
before and after capture, with tree hash
`cae959249977412138abd07667ef28c603b91f54dbb0661b70ac7eb4a6bb1ba0`.
The integrated build also passed 940 unit tests and all 36 browser regression
probes. This visual and fixture evidence does not replace native qualification.

## Capture contract

Use the pinned `noise visual-diff` tool to import the corrected canvas and map
its generated manifest IDs to production-renderer preview states. The tool's
manifest owns the exact imported IDs; the labels below identify source figures.
Reimporting invalidates earlier measurements. Serialize captures and verify the
served build with the tool or exact served-file hashes before reporting a comparison.

The canvas has 52 figures: one desktop invitation at 1120 × 900, 41 desktop
states at 1120 × 720, and ten phone states at 393 × 852. The interactive flow is
1180 × 760 on desktop and 393 × 852 on mobile. Do not reuse the existing
393 × 864 phone frame or its OS-band masks.

Native credential-picker pixels in 2b belong to the browser or password
manager. Production invokes WebAuthn and renders Deck's waiting/cancel state;
it must not imitate a credential picker. Terminal output in 4d and 5a belongs
to the real CLI. Figures 4d and 5a are integration acceptance references: the
production browser probe checks admission and the actual workspace menu, lock,
and sign-out actions. They are not whole-terminal pixel targets, and no terminal
mask or full-figure convergence is claimed. Other security states compare their
copy, status, dialogs, and Deck chrome.

| Figure | Source label | Width × height |
| --- | --- | --- |
| 1a | Invitation | 1120 × 900 |
| 1b | Boundary detail | 1120 × 720 |
| 1c | Invitation expired | 1120 × 720 |
| 1d | Setup interrupted | 1120 × 720 |
| 1m | Invitation on mobile | 393 × 852 |
| 2a | Choose unlock method | 1120 × 720 |
| 2b | Browser passkey prompt | 1120 × 720 |
| 2c | Checking it unlocks | 1120 × 720 |
| 2d | Passkey cannot unlock | 1120 × 720 |
| 2e | Encryption password | 1120 × 720 |
| 2f | Unlock method ready | 1120 × 720 |
| 2m | Choose unlock on mobile | 393 × 852 |
| 2n | Incompatible on mobile | 393 × 852 |
| 3a | Recovery key | 1120 × 720 |
| 3b | Verify recovery key | 1120 × 720 |
| 3c | Key not recognised | 1120 × 720 |
| 3d | Transcription error | 1120 × 720 |
| 3e | Setup complete | 1120 × 720 |
| 3m | Recovery key on mobile | 393 × 852 |
| 3n | Verify on mobile | 393 × 852 |
| 4a | Signed out | 1120 × 720 |
| 4b | Signed in but locked | 1120 × 720 |
| 4c | Unlocking | 1120 × 720 |
| 4d | Running | 1120 × 720 |
| 4e | Unlock cancelled | 1120 × 720 |
| 4f | Browser cannot unlock | 1120 × 720 |
| 4g | Server unavailable | 1120 × 720 |
| 4h | Unlock failed | 1120 × 720 |
| 4i | Restarted, locked again | 1120 × 720 |
| 4j | Running, new browser | 1120 × 720 |
| 4k | Unlock with password | 1120 × 720 |
| 4l | Wrong password | 1120 × 720 |
| 4m | Locked on mobile | 393 × 852 |
| 4n | Unlock failed on mobile | 393 × 852 |
| 5a | Sign out and lock are different | 1120 × 720 |
| 5b | Lock confirmation | 1120 × 720 |
| 5c | Locking | 1120 × 720 |
| 5d | Locked, confirmed | 1120 × 720 |
| 5e | Lock failed | 1120 × 720 |
| 5f | Lock unconfirmed | 1120 × 720 |
| 5m | Lock sheet on mobile | 393 × 852 |
| 6a | Unlock methods | 1120 × 720 |
| 6b | Add and test a passkey | 1120 × 720 |
| 6c | Replace a method | 1120 × 720 |
| 6d | Last method | 1120 × 720 |
| 6e | Change encryption password | 1120 × 720 |
| 6m | Methods on mobile | 393 × 852 |
| 7a | Recover with the key | 1120 × 720 |
| 7b | Replacement method | 1120 × 720 |
| 7c | Two kinds of help | 1120 × 720 |
| 7d | Nothing left | 1120 × 720 |
| 7m | Recover on mobile | 393 × 852 |

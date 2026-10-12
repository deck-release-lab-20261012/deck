# Workspace onboarding design

The accepted `onboarding-r1` export adds generic workspace setup with an explicit
installation policy: encryption is optional, required, or unavailable. This
renderer leaf does not change admission, invitation redemption, storage setup,
or the existing cryptographic controller. Production coordination is a dependent
change; preview navigation is not evidence that setup or encryption succeeded.

## Source and references

`Deck.zip` SHA-256:
`c8a5b5705e60f7bcbbeec26a0a6665c84ab570e9427cdff000832d6d23eafba1`.
The `Workspace Onboarding Flow.dc.html` member SHA-256 is
`ce8192d72e21560bf1c252c135b1c6f534c76fa6a91165b1a185fe83b5df742b`.
The original archive is retained outside Git and never rewritten.

Generate references with the pinned helper:

```sh
python3 web/tools/onboarding-reference.py /path/to/Deck.zip /path/to/deps
noise visual-diff import --refresh .visual-diff/onboarding-reference/onboarding-references.zip
```

`deps` must contain `react.js`, `react_dom.js`, and `babel.js` matching the exact
URLs and SHA-384 integrity declarations in the supplied `support.js`. The helper
verifies those bytes before replacing only their URL constants with local paths.
It namespaces every copied design asset, pins the archive and member hashes,
freezes explicit component states, and records every resulting member hash in
`.visual-diff/onboarding-reference/provenance.json`. It copies only the design
system, icons, fonts, brand lockup, support code and verified dependencies.

The source is a dynamic prototype, not a figure canvas. Each derived document
contains one labelled frame at an integer origin, with the prototype navigation
and outcome selectors removed. Desktop frames use 1180×760; mobile frames use
393×852. The mock-device border and radius are framing, not app chrome. Interface
copy uses sentence case and the existing interface optical font cut below 28px.
The reference includes the canonical mobile overscroll suppression rule so both
surfaces retain the same scroll behavior and Chromium text compositing.
No mask or relaxed threshold is introduced.

The tracked visual config keeps the previous 98 states intact and adds 29
reference-backed generic onboarding states. Re-import invalidates prior scores;
final integration must capture the combined set after all references are ready.
Use the pinned resolver and one serialized visual lane. `noise visual-diff capture
--serve web/dist` serves the specified build on a temporary loopback port and
records its content hash; it does not depend on a possibly stale external server.

## State coverage and reuse

The preview catalog is deliberately finite: 39 states, with policy/plaintext
branches and seven representative mobile layouts rather than every combination.
`preview.html?onboarding=<id>` is isolated from other fixture axes.

| Source states | Implementation and acceptance |
| --- | --- |
| `welcome`, `needlink`, `expired`, `used`, `notowner`, `unreachable`, `interrupted`, `resume` | Generic entry, ownership, observation and resume renderer; desktop references plus representative mobile layouts. |
| `encryption` | Optional, required, unavailable and expanded privacy disclosure; each policy has desktop/mobile coverage. |
| `choose`, `create`, `check`, `incompatible`, `setpassword`, `ready`, `key`, `verify` | Existing enrollment renderer and action binder, with the generic journey’s progress labels. Existing security references remain authoritative for these shared forms; the onboarding probe exercises their reuse. |
| `finishing`, `unconfirmed`, `failed`, `done` | Supplied observed progress and explicit outcomes, including encrypted and unencrypted branches. No timeout or click can manufacture success. |
| `signin` | Existing-workspace entry, with encryption-dependent explanatory copy. |
| `newbrowser` | Existing runtime `4j` browser-authorization surface; existing security reference retained. |
| `google` | Deck’s navigation boundary to real Google sign-in. No imitated Google account chooser. Functional coverage only. |
| `arrival` | Integration with the actual workspace and its existing empty-project state. The schematic canvas is not a replacement terminal or a whole-workspace pixel target. |

The derivative records narrow factual corrections: saved-method proof before
resume; selected encryption distinguished from initialized storage; policy
unavailability distinguished from connection failure; observe-only uncertainty;
fresh proof before retrying setup; ownership eligibility; no unlock-method claim
while unencrypted setup finishes; and truthful return
and completion copy. The exported clock glyph uses the existing warning icon.
No additional design handoff is required for these corrections.

The reused password form keeps the existing 15-character minimum and repeat
field. Recovery generation, normalization, verification, clipboard/download
outcomes and JSON kit schema stay in the existing security implementation. `DK1`
is a key encoding version; it is not the kit’s numeric schema version. Synthetic
example keys appear only in the preview module and remain visibly marked.

## Renderer integration contract

`app/security/onboarding.ts` exports `OnboardingView`, `OnboardingScreen`, and
`onboardingHtml(view)`. The caller supplies the workspace identity, installation
policy, observed progress rows, and optional real owner metadata. Missing email,
time or method facts are omitted. The `done` state is only for a confirmed result;
`finishing.encrypted: false` omits the encrypted-resume hint for plain setup;
`unconfirmed` offers observation, and `failed` offers a fresh proof before safely
continuing. Neither renderer nor browser storage is authoritative.

`bindOnboardingActions(root, {run, error})` dispatches explicit gestures and
returns a disposer. Existing encrypted forms dispatch the same `EnrollmentAction`
values and use the same validation. Generic gestures are `switch-account`,
`resume-setup`, `enable-encryption` and `continue-unencrypted`, alongside sign-in,
observation, disclosure and workspace entry. Dispose before replacing a view;
late errors from the previous view are fenced. The caller must enforce policy,
owner eligibility, request cancellation, cryptographic proof and actual admission.

`EnrollmentView.setupProgress` changes only an explicit generic-setup context;
existing security routes retain their established labels. `onboarding: true`
corrects the pre-initialization incompatible-passkey copy without claiming that
storage has already been locked or initialized.

## Verification

`web/tools/onboarding-probe.mjs` uses the pinned browser resolver, serves a local
production build, and checks all 39 preview states, touch targets, policy-specific
actions, disclosure, existing password validation, saved-method resume and
uncertainty. It does not perform enrollment or attest storage/runtime behavior.
The focused unit tests cover escaping, omitted facts, policy choices, truthful
unknown states and strict preview parsing. Production journey and real backend
qualification remain part of the integration leaf.

# Native login helper and pending callback dialog

**Codex login helper** runs over the same live terminal. For a fresh,
supported Codex launch, a metadata-only check for a regular native `auth.json`
provides an optional initial-guidance hint. It uses the exact effective launch
HOME/CODEX_HOME, never reads credential contents and never establishes whether
an account or subscription is valid. The hint is transient, not persisted login
state. The helper waits until the real terminal attaches, deferring around an
occupied dialog or menu. Native sign-in selection remains in Codex.

The existing xterm host moves into the helper beneath its instructions; there
is no second terminal, connection or controller. While embedded, wheel and
trackpad gestures over that terminal are captured and dropped — the helper
shows its live output. The terminal's own wheel handling resumes when
its host is restored. Dismissal, session changes and controller loss restore
that host. Native keys, including Escape, remain terminal input when the
terminal has focus. The dialog body contains its overscroll and scrolls
independently of its footer on small screens.

A supported native opener supplies the pending attempt. An authenticated,
session-scoped EventSource sends only a `pending` invalidation event, never a
URL or OAuth state; the client immediately refreshes the listing, including
when another listing is in flight. Reconnection triggers a refresh. The existing
visible-page/controller polling remains catchup; an open waiting helper also
has a fallback refresh while the helper remains open and waiting; while it
waits, the Codex footer offers **Check for login** (Pi keeps its body-level
**Check for a waiting login** row). Terminal output is never parsed for login state.

One genuine attempt selects directly; several present a picker. Selection does
not claim a server handle: Begin waits for explicit submission or cancellation.
For Codex, **Open OpenAI sign-in** retrieves the original validated native URL
through an authenticated, session-bound, CSRF-protected no-store response and
opens it without a referrer. The backend retains that URL only in memory until
submission, cancellation, replacement or observed expiry. Listings and SSE do
not carry it. A blocked popup does not fetch it. The helper explains the expected
localhost error before navigation, then asks for the entire return address in
**2. Paste the return URL**. **Finish sign-in** submits the callback only through
the protected handoff endpoint, never terminal input. No clipboard auto-read or
native prompt guessing is involved.

**Use terminal instead**, the close button and Escape from dialog controls
dismiss Codex guidance. A pre-attempt dismissal suppresses further automatic
presentation in that mounted session; a visible **Open login helper** action
allows reopening while connected and controlling it. More and the terminal
context menu also retain **Finish harness login**. Only verified native
completion clears the guidance and offers **Continue to Codex**; absence of a
pending attempt is not success. Codex cancellation uses its native terminal.

Pi preserves its pending-only shared callback form, **Localhost callback URL**,
**Deliver callback**, **Not now**, contextual **Finish login** and **Cancel
login**. Cancel ends the Deck handoff without claiming to stop Pi. **Callback
delivered** does not establish token-exchange success; check the CLI. Its result
surface retains **Close**.

Both flows clear callback input on submission, closure, expiry and controller
loss. A late Begin response releases its handle; a late invalid submission does
the same. Uncertain delivery is never retried. Session changes and controller
loss abort listings and fence late responses, including return to the same
session. Pending listings exclude another operator's claimed or dismissed
registrations. The browser stores only opaque attempt/session IDs and expiry
times for attempt-scoped dismissal in session storage. Suppression is bounded
by the backend's 1,024-registration limit and prunes expiry; it is a presentation
preference, never authoritative login state. Storage denial loses persistence
across reload while in-page suppression remains.

## Design references

The original reference source is `Deck.zip` SHA-256
`f4d1ce37c57fcbbd2065850ccba58291f7edd15e306a9edba843f581ac229acd`.
Desktop uses the r52 pending dialog in `Workspace 6 Desktop Polish.dc.html`;
mobile uses the r9 invalid example, frame 16, in `Workspace 5 Mobile.dc.html`.

`web/tools/harness-login-reference.py` produces four source-derived references.
It selects the desktop pending state, annotates the complete dialogs for cropping,
and bundles the export's dependencies after checking their declared integrity.
The OFL copies overlay the complete `free.css`: font faces for the application's
Jost, IBM Plex Mono and EB Garamond set, typography variables, tracking, word
spacing and body rules, with the font URLs pointing at the bundled files. The
`html:root` selector takes precedence over the export runtime's default type
set. Layout, copy, controls and example input remain the uploaded design.
Generated archive provenance records the source hashes and transformations. No
implementation markup or screenshot becomes a reference.

The Codex login helper treats these original callback comps as design shape,
not current Codex copy or an exact helper baseline. The expanded helper
includes the actual terminal and two-step sign-in/return layout. Full live
fixture captures verify desktop and phone geometry with licensed and OFL
fonts; no unrelated baseline was replaced.

The live dialog and `preview.html?harness-login=<state>` share markup, flow copy
and result messages. States are pending, submitting, completed, delivered,
invalid, expired, unavailable, uncertain and pi. Preview forms never send data.

Generate into a fresh directory, then import the combined four-reference archive:

```sh
python3 web/tools/harness-login-reference.py /path/to/Deck.zip \
  /path/to/integrity-verified-dependencies .visual-diff/harness-login-reference
noise visual-diff import --browser ws --refresh \
  .visual-diff/harness-login-reference/references.zip
```

The dependency directory contains `react.js`, `react_dom.js` and `babel.js` at
the exact versions and SHA-384 integrity values in the uploaded `support.js`.
Preserve the existing visual configuration when adding these states. Reimport
invalidates earlier scores. Import/capture must use the coordinated visual slot.

Build with `NOISEDECK_LICENSED_FONTS_DIR` and capture/compare the two
`harness-login-*-licensed` states. Build with `NOISEDECK_FONTS=free` and use the
corresponding `*-ofl` states. `capture --serve web/dist` records the exact served
build. Set `NOISEDECK_CAPTURE_FONT="Euclid Flex"` or `NOISEDECK_CAPTURE_FONT=Jost`
to verify the computed family during capture. The capture helper encloses the
whole dialog in integer coordinates to
avoid fractional crop truncation, without moving the dialog or masking pixels.
Other result states are capture-only because no matching supplied comp exists.

Raw comparisons intentionally retain the design's incorrect machine-wide scope,
fixed-port placeholder and sample callback. The implementation instead names the
selected session, mentions company SSO, keeps the field empty, and distinguishes
Pi cancellation from dismissal. Codex instead offers Use terminal instead
and keeps native cancellation in its terminal. It also retains the no-terminal privacy hint. These
comparisons are measured differences, not a claim of pixel convergence or a
replacement baseline. The mobile source includes a device bezel; Deck fills the
actual viewport. No masks hide either difference.

## Release boundary

Credential-free fixtures cover lifecycle, controller fencing, late responses,
keyboard focus, mobile sizing, HTTP authorization teardown and callback privacy,
including the same live xterm/controller and SSE refresh with timers paused.
They do not establish real account authentication. Native-account qualification
remains an independent release gate; cleanup follows that gate.

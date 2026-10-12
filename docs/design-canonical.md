# Noisefloor Deck — canonical design (v1)

Derived from the maintainer's workspace explorations and the
design-system bundle (reference material kept outside the repo) and the product's honesty invariants.
The explorations are raw material; this document is the decision of
record for what the first release LOOKS like. Realized as Tailwind v4
`@theme` tokens in `web/src/styles/app.css` — components use utilities,
never `.bp-*` classes and never literal hex values.

## 1. Layout (from explorations 1f + 1g + 2a)

One workspace frame, three regions, compact density:

```
┌──────────────────────────────────────────────────────────┐
│ ┌───────────┬──────────────────────────┬───────────────┐ │
│ │  sidebar  │ main (session header ·   │ right panel   │ │
│ │ projects  │ terminal)                │ (Files / Tasks│ │
│ │ + their   │                          │ docked)       │ │
│ │ sessions  │                          │               │ │
│ └───────────┴──────────────────────────┴───────────────┘ │
│  info bar                                                │
└──────────────────────────────────────────────────────────┘
```

- The shell is `height:100vh; overflow:hidden`, a column flex. Its first
  row is `[sidebar | main | right panel]`; its last row is the info bar.
  Four chrome bars share one class (`chrome`, at `--chrome-h`, 48 standard):
  the sidebar header (`border-bottom:0`), the session header
  (`gap --space-4`), the Tasks/Files panel headers, and the info bar
  (`chrome-bottom` at 26px). Panel titles take their 13px medium from the
  chrome class (`chrome-title`), never from the call site.
- `data-theme="dark"` rides on `<html>`, never on a container: Blueprint's
  composite tokens (`--hairline`, `--ring`, `--ring-overlay`, `--ring-accent`)
  are substituted where they are defined, so on an inner element they freeze
  against the light ramp (white hairlines on navy). Same for
  `[data-surface="ink"]`.
- The terminal owns its pixels; chrome sits beside it, never over it.
  The terminal follows the workspace theme (v2: light chrome means a
  warm light console; the toggle flips it).
- **Status facts live in the info bar** (43.3): the quiet-ledger strip is
  gone, replaced by the app's single explanation channel — the hovered
  control's hint, or ambient session status when nothing is hovered.
  Per-write outcomes render in the session header, and they say only what
  tmux acknowledged — sent, never accepted or acted on. Recovery
  controls keep their explicit confirmation gates.
- The tasks panel is a right dock beside the terminal, never over it —
  the terminal is dominant, and neither the sidebar nor this panel
  overlays it when open. Read-only, our `TaskmasterPanel`.
- The terminal is the only input surface; there is no composer or
  outbox (43.5). Chrome speaks the UI voice; the CLI owns its pixels.
- Sidebar rows follow the operator's v2 design export: per project a
  collapsible header (name + session count · path), then per session a
  single line — status dot (with accessible name), provider glyph, name,
  generation. Last-output time joins the row when the backend field
  exists.

## 2. The honesty grammar (from the explorations' "I know / I don't")

Color encodes EVIDENCE STATE, not decoration:

| State | Treatment | Token |
|---|---|---|
| Verified good | whisper — plain text, secondary color | `--color-text-secondary` |
| Verified bad | loud but factual — error tint, plain words ("dead is a fact, not an alarm") | `--color-error` + `--color-error-tint` |
| Unknown | hollow — never dressed as good OR bad; dashed/hollow treatment | `--color-text-tertiary` |
| Assumed (operator's) | attributed, not verified ("by you, 09:07") | plain text + attribution |

Two hues carry meaning and nothing else does:

- **accent = interactive** (cobalt `--color-accent`). Clickable things
  and nothing else.
- **signal orange = evidence** (`--color-evidence`). Facts that came
  from a source: proof strings, the sent-delivery arrow, write
  verification. Never for decoration, never for clickable things.

Delivery semantics: a sent write gets the arrow `→` and the word
"sent". A checkmark only ever means a VERIFIED fact. Sent ≠ arrived —
"write verified · arrival is not".

Resolved/history states (injected, assumed_delivered, skipped,
retry_linked, cancelled) recede: collapsed, plain text, no color.

## 3. Tokens (Tailwind v4 `@theme`)

Values follow the operator's v2 design export: a warm light palette
at the root and the cobalt dark ramp under `data-theme="dark"`; the
default theme is dark. Hex lives only in the theme block.

- **Color**: the full semantic alias set — `surface`, `surface-muted`,
  `surface-sunken`, `surface-card`, `text-primary/secondary/tertiary`,
  `border` / `border-strong` / `border-focus`, `accent` (+hover,
  pressed, tint, border, on-tint), `evidence` (+tint, border,
  on-tint), `success`, `warning`, `error` (+tints, on-tints),
  `wash-hover`, `wash-pressed`, `wash-selected`.
- **Spacing**: Tailwind's default 4px grid IS the Blueprint grid; no
  override. Compact density for chrome: control heights 24/30/38px.
- **Radius by role** (not size): `mark` 6, `control-sm` 8, `control`
  10, `card` 14, `panel` 20, `pill` 999, `circle` 50%. Radius is not
  elevation.
- **Elevation**: no drop shadows, ever. Depth = hairline first,
  surface tint second, scrim for overlays (`flat` / `raised` /
  `overlay`).
- **Type voices**: `font-ui` (interface: chrome, labels, data),
  `font-display` (titles at 28px and up), `font-prose` (reading
  surfaces), `font-mono` (machine voice only: terminal, paths, hashes).
  Status text, counts, badges and control labels use the interface face.
  Sizes `body` 15, `body-sm` 13, `caption` 12,
  `micro` 11. Labels use small caps with +0.055em tracking
  (`font-variant-caps: all-small-caps`).
- **Two type sets, chosen at build time** (`web/vite.config.ts` resolves
  `@fonts` to one of `web/src/styles/fonts/{licensed,free}.css`). The
  ramp above is the licensed set's own tuning: Euclid Flex (WebS for the
  interface, WebXL for display), Baskerville 10 Pro, Operator Mono SSm —
  webfonts licensed to Noisefloor, not redistributable, and
  supplied outside Git at build time. An installation without them builds the
  free set: Jost for both Euclid cuts, EB Garamond for Baskerville,
  IBM Plex Mono for Operator, all OFL and vendored under
  `web/public/fonts/free`. Each free `@font-face` carries `size-adjust`
  and the ascent/descent/line-gap overrides that put its x-height,
  `line-height: normal` and baseline where the licensed face's were (the
  mono is anchored on advance instead, so its cell is the licensed cell
  exactly at every size and device pixel ratio, with no tracking), so
  every line box, row height and baseline computes identically and the pixel
  gate sees glyph shape and advance rather than layout (desktop states
  land 0.3–0.8 points above the licensed build). Advances still differ
  by a few percent per face, so a measure tuned to a licensed face can
  wrap or truncate differently. What descriptors cannot express — the
  mono weight, tracking and cursive rule, and the `ss12` glyph composite
  the free faces lack — free.css re-states from measurement, never by
  scaling a licensed value. `NOISEDECK_FONTS=auto` (the default) selects
  the complete installation-supplied licensed set, otherwise the bundled
  OFL set. Explicit `free` and `licensed` modes remain available; incomplete
  supplied sets fail in auto/licensed mode. See [fonts.md](fonts.md) for
  local inputs, Docker build contexts, and visual verification.
- **Terminal pane** (follows the workspace theme): the terminal
  tokens flip with the theme — warm cream console in light mode, the
  near-black navy in dark (app.css `--color-terminal-*`,
  `--color-console-*`). Evidence inside the pane follows the same
  flip. The pane is still the CLI's own surface.
- **Layout measures**: `sidebar-w` 272px (the reference frame's
  sidebar), `control-h-badge` 18px (compact status pills). Chrome bars
  take their height from `--chrome-h` (48 standard / 40 compact / 56
  comfortable), and the info bar is a fixed 26px (`--bottom`).
- **Motion**: controls and action feedback only (dialog rise, toast).
  Desktop layout changes remain immediate.
  The phone Sessions sheet uses the 180ms base duration for its vertical
  entrance/dismissal and backdrop fade, without resizing the terminal.
  Row swipes follow the finger directly and settle with that same duration.
  Reduced motion removes sheet, backdrop and swipe-settling transitions.
  No decorative motion.

Markup consumes ONLY these tokens (theme utilities or `x-(--token)`
references). Arbitrary values — `w-[272px]`, `h-[72px]`, `text-[#…]` —
are forbidden in components: if a measure or color is needed and no
token fits, the token is added HERE first, then used.

## 4. Component mapping

| Component | Reference basis | Notes |
|---|---|---|
| Sidebar | v2 design export | collapsible project header (name + count · path, activity dot); session rows: status dot, provider glyph, name, generation |
| Status surface | Info bar (43.3) | the ledger strip is gone; the info bar is the single explanation channel — hover hint, or ambient session status when nothing is hovered; per-write outcomes render in the session header |
| Session status | Info bar (43.3) | recovery controls keep their explicit confirmation gates |
| Taskmaster panel | 1g tasks drawer | read-only mirror; tags as sections; status badges |
| Takeover / force-stop | 1h / 1i | confirm states its limits; "no tick until the process table agrees" |

## 5. Non-negotiables

- Terminal follows the theme, chrome never overlays it.
- No shadows; hairlines only.
- Accent = clickable, signal = evidence; no third hue with meaning.
- Status colors encode evidence state (§2), not vibes.
- No hardcoded hex outside the `@theme` block; no `.bp-*` classes.
- A checkmark means verified; "sent" gets an arrow. Never merge them.

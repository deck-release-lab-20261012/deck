# Global menu visual gate

This gate adds desktop and mobile global-menu states for both installed font
sets. The existing 138 states, masks, and thresholds remain unchanged. The
new states use the existing 0.5% threshold and have no masks.

## Reference source

`web/tools/global-menu-reference.py` reads the approved desktop-r52/mobile-r9
export (`Deck.zip`, SHA-256
`f4d1ce37c57fcbbd2065850ccba58291f7edd15e306a9edba843f581ac229acd`).
It checks the source hash, the exact desktop property/menu bindings, the
selected mobile frame, and the runtime dependency integrity declarations.
It emits a deterministic ZIP and member-level provenance. Reference pixels
come from the supplied design, never from Deck screenshots.

The accepted design decision is: “Preserve current controls; use comps as
design shape.” The adapter composes Show tutorial, Finish harness login,
GitHub connection, and the remaining accepted controls from the supplied
menu and row primitives. Show tutorial becomes an action rather than a
preference toggle. The mobile account suffix is removed from its exact
sign-out row; preference fixtures use Yolo off and close confirmation on.

The three desktop shortcut fixtures use Linux labels. The selected mobile
hardware wrapper becomes its declared 393px application viewport, without
hardware border or corner clipping, translated as one whole viewport to the
document origin. Runtime checks preserve every visible descendant rectangle
relative to that viewport. Its Noisefloor swatches use the accepted current
background fixture; product theme colors are unchanged. Numeric settings and stepper labels use
interface type under the UI-copy rule. These adaptations are explicit in
archive provenance; the original export remains immutable.

The export's typography tokens define `--type-title-3-size: 17px` at root with a
`max-width: 1800px` override to 16px, so the supplied mobile export renders the
settings title at 16px. The accepted Deck contract keeps the shared phone heading at
17px/500, so the adaptation holds that size and weight while tracking, word spacing,
and line height follow the export's inherited body recipe. Source-derived button
typography is converged the same way: buttons inside the menu inherit the menu's
`text-rendering` instead of the UA reset, matching the export text recipe without
changing fonts or global tokens.

Reference framing normalizes the whole mobile viewport to the integer document
origin by relative `left`/`top` positioning, not a transform. A fractional
compositor translate was measured as a pure composition artifact: identical layout
and every visible child rectangle exactly unchanged, while the rasterized ring and
rounded edge sampled a half-texel off. The helper waits for finite source animations
to settle (fonts and hydration first, infinite spinners skipped) and guards exact
visible-child relative geometry around the positioning change, failing closed with
a diagnostic instead of publishing a wrong frame.

Both source and product crops enclose their independently measured border
boxes with floor/ceil integer frames. Reference framing follows importer
viewport resizing and source layout movement; it does not change the menu
surface or its layout. Symmetric mouse-away drives keep both sides unhovered
and make the pinned importer wait for the completed reference frame.
OFL references apply the repository's OFL typography stylesheet (font faces,
metric tokens, tracking, and word spacing) and bundle those font files; licensed references retain the export
fonts. The OFL stylesheet is inserted once at the verified outer document head;
embedded mock HTML files keep their original bytes. Neither licensed assets nor
generated reference images belong in Git.

```sh
python3 web/tools/global-menu-reference.py /path/to/Deck.zip \
  /path/to/verified-export-deps build/global-menu-reference
noise visual-diff import --browser ws --refresh \
  build/global-menu-reference/references.zip
```

Adding these states changes the global config hash. A menu-only import is
useful for qualifying the adapter, but does not refresh other namespaces.
Recreate the complete reference set before calling a baseline current.
Existing accepted inputs comprise the project-preview r7 derivative (42
comps), the security-suite derivative (50), onboarding (29), and the tracked
harness-login adapter (4). The new adapter adds four comps. Combine those
inputs without changing their rendered members; preserve each archive's
relative asset paths in its own directory. Record source hashes and verify
coverage of every non-null `comp` in the final config before importing.
For an OFL baseline of previously single-font namespaces, overlay only the
same OFL typography stylesheet and assets; do not compare an OFL build to a
licensed reference and label that an OFL conformance result.

## Capture contract

Build with explicit `NOISEDECK_FONTS=licensed` and an external
`NOISEDECK_LICENSED_FONTS_DIR`, or `NOISEDECK_FONTS=free`. Capture only states
matching that font set, plus existing states without a font suffix. Set
`NOISEDECK_CAPTURE_FONT` to `Euclid Flex` or `Jost` respectively. The menu
capture helper requires that expected face, checks the UI font role, and
verifies a matching FontFace actually loaded.

Use `noise visual-diff capture --browser ws --serve <that-build-directory>`
so the tool serves the exact build being measured. Serialize reference
imports and captures. Preserve complete reports and provenance for each font
run before refreshing the reference set for the other font.

An invisible, inert integer frame encloses the menu border box without
changing its layout. It changes no visible pixels and masks nothing.
These cropped comparisons exclude outer shadows, placement, surrounding
workspace, scrim coverage, and interactions; they are not evidence for those
properties. Overflow from differently sized menu boxes remains a mismatch.

## Design alignment and retained history

The accepted design preserves current controls and uses the supplied design
shape. Product changes are limited to settings-menu typography, row spacing,
controls and framing. The fixed font stylesheets, masks and 0.5% threshold
remain unchanged. Phone controls retain 44px touch targets, with the supplied
40px stepper visual inside them.

The original exact-export failures below remain historical evidence.
The preliminary adapted-reference captures are diagnostics, not a
complete refreshed baseline or a convergence claim. Final full-font results
must identify their exact product build, config and reference archive.

The full refresh also exposes existing harness-login comparison failures.
The harness-login gate recorded source-derived comparisons with contract
differences and **no convergence claim**; its passing browser/layout checks
were not a zero-difference pixel result. Its accepted implementation uses
selected-session scope, enterprise SSO guidance, an empty callback field,
privacy guidance, and explicit cancellation rather than the export's sample
account/time/machine-wide explanation. The mobile invalid example also has
different field contents, error text, and button state. The menu gate changes
none of that product code. These are baseline comparison failures, not evidence
that this gate change introduced a login regression.


## Targeted qualification (2026-09-23)

Targeted checks passed all four menu states: licensed desktop
0.161393%, OFL desktop 0.156021%, and both mobile crops at 0%. These are targeted
results, not a full baseline. Complete font runs must retain their frozen
head and input hashes alongside the reports.

## Initial baseline (2026-09-23)

Both runs used product source `c51a2e34990bb9b63db43c83bc6e8ea81293762c`,
visual-diff 0.10.2, the same final config, and separately built/served font sets.
Each captured 138 states with verified determinism and compared all 125
reference-backed states. The other 13 states remain capture-only.

| Font set | Run | Pass / fail | Desktop menu mismatch | Mobile menu mismatch |
| --- | --- | --- | --- | --- |
| Licensed | `20260923-130253-040eef` | 121 / 4 | 10.1324% | 30.3925% |
| OFL | `20260923-131534-72fc4c` | 25 / 100 | 7.4743% | 30.2968% |

Both comparisons returned exit 1 at the unchanged thresholds. All four
licensed failures are the two menu and two harness-login states. OFL failures
span project preview (39), security (36), onboarding (21), harness login (2),
and the menu (2). This establishes a fresh OFL baseline against OFL references;
it does not establish when those differences arose or claim convergence.
Existing mask-coverage and identical-score warnings remain in the reports.
No new masks or threshold overrides were used.

Complete reports, both reference sets, captures, input archive provenance,
and build/config hashes were retained locally outside the public source.
Each preserved font set must stay paired with its own report and capture
provenance.

A representative OFL attribution check inspected the exact “Only people
signed in…” and “Nothing starts…” spans inside the project-preview explainer.
Both sides used a loaded Jost variable face, 13px/400, 19.5px line height,
−0.9px word spacing, and 430px content width. Reference tracking was 0.525px,
inherited from the design dialog consuming `--type-body-sm-ls: .035em` at
15px. App tracking was −0.03px, inherited from the existing
`.project-preview-dialog { letter-spacing: -.002em }` at 15px. The heading
matched at 16px/500, 0.24px tracking, and 21.44px line height. This is a
measured typography-token consumption difference, not a missing Jost font
in that pair. It does not explain or classify every OFL failure, and no
product or reference styling was changed to reduce the score.

## Outer-head reference correction

The original OFL adapters also inserted the stylesheet into a mock
`index.html` template literal later in each export. The menu adapter now
verifies the outer document prologue and head/body boundary, then inserts once
there. The separate harness-login adapter received the same correction. Across
the combined reference set, only the four OFL menu/login HTML members change;
each removes the erroneous second stylesheet while preserving the mock sample
bytes from the approved export. All other members are byte-identical. The menu
archive is deterministic, and malformed outer document boundaries are
rejected.

The licensed result above remains a historical baseline: its actual rendered
inputs and exact product build are unchanged, but it was not re-imported or
recaptured after this correction. Both original full runs remain preserved.
The corrected OFL set is re-imported in full and paired with a complete fresh
capture and comparison under the same config and exact preserved OFL build.
No original score is relabeled as a fresh result.

The corrected OFL run `20260923-141627-4f3ecb` imported all 129 comps,
verified 138 captures, and compared 125 states: **25 pass, 100 fail**, exit 1.
Menu mismatch remains **7.4743% desktop / 30.2968% mobile**. All mismatch rates
and the PNG bytes in this complete reference/capture pair equal the original
OFL run. That observed equality does not assert universal rendering stability:
repeated targeted desktop login crops showed a 21-pixel variation
within both old and corrected renders; the mobile crops were identical.

Import and capture each exited 0. The orchestration wrapper then exited 1
because it read the comparison-created run marker too early. A standalone
comparison used the completed capture without rerendering and exited 1 for
the strict visual failures. Its full report, artifacts, input/member proofs
and exact build provenance were preserved locally outside the public source.
The original evidence was not overwritten.

The corrected combined archive changes four OFL HTML members only. The merged
harness adapter reproduces its supplied reference members exactly. Product
builds remain the recorded `c51a2e34` artifacts, byte-verified after integrating
the later probe and adapter fixes; neither integration changes product pixels,
visual config, masks, thresholds, or the menu capture helper.

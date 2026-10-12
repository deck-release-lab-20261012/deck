# Project preview design verification

The accepted handoff is `Project Preview Flow.dc.html`, revision
`preview-flow-r1`, from the uploaded `Deck.zip` with SHA-256
`453ed450ae984861d9a375ebca6a37329f6956ee30e93051edb85e8af0a79214`.
The comp itself has SHA-256
`9677ceb3370fd1c5fabcc54153066060cbf16b741de0fb091e13c7ab1f31104b`.
The behavior corrections below are part of the accepted design. The original archive,
licensed design assets and generated screenshots stay outside Git.

The UI uses the existing project menu and dialog anatomy. It enables a
registration, opens its authenticated browser entry, shows the assigned URL,
checks TCP connectivity and disables browser access. The project agent starts
the declared dev command through the separate deterministic launcher. No UI
action composes or sends an agent prompt, or starts or stops a server process.

## Reference preparation

`web/tools/project-preview-design-adapter.py` derives references from the
uploaded comp, its own DCLogic runtime and its design-system assets. It never
loads Deck's implementation, styles or rendered screenshots. It verifies the
archive and comp hashes before making these declared changes:

- Correct retained URL/port behavior, including pool exhaustion guidance.
- Describe an unsuccessful enable or disable response as an unconfirmed
  outcome, since the operation may already have changed state.
- Remove the fictional installation/owner identity and unsupported gateway
  error-page promise.
- Distinguish an assignment from a running process or observed connection.
  Add unknown and check-failure states to the original status row and note
  typography. A failed TCP connection does not prove connection refusal.
- Initialize each desktop/mobile demonstration state directly. This avoids
  timing-dependent simulated enable and connectivity transitions.
- Label the complete dialog or menu root for reference cropping. There are no
  text masks, hidden controls or implementation-derived reference images.
- Compose the existing swatch and reorder groups from the same archive's
  `Workspace 6 Desktop Polish.dc.html` (SHA-256
  `4f84aae9de0bac1d7cb313428645d2edd5b965b437c5ca2ef11032823553cf70`)
  before the new preview group, including the source disabled-state styles. The original preview flow omits those working
  controls. Its desktop shortcut anatomy also comes from that workspace
  comp; its mobile sheet remains the preview flow's. The existing
  “Move to top” command, absent from the export, uses the source “Move up”
  row anatomy. The shared synthetic fixture is an uncolored project with neighbors above and below.
  Its existing “Clear color from sessions” action remains visible using the
  source propagation row anatomy and an empty indicator; the older source
  incorrectly hides this action for uncolored projects. The Linux fixture
  uses Ctrl+R. Menu status text keeps the source 13-pixel size but removes
  small caps and caps tracking to meet the repository's sentence-case rule.
- Remove the prototype frame's one-pixel hardware border and outer radius.
  Its 393-pixel phone contains a 391-pixel app because of that bezel; the
  production browser viewport has 393 app pixels and no hardware corner clip.
  Place this unchanged app canvas at viewport coordinate (0, 0). The export's
  surrounding harness otherwise gives it a fractional position: identical
  363.078125-pixel dialogs measured at y=379.375 in the source and y=178.453125
  in the browser, changing raster phase after the importer's rounded crop.
  This removes only harness placement, not the surface's internal layout.
- Replace the runtime's three CDN URLs with local dependency files whose
  SHA-384 values must match the original runtime's SRI declarations. The
  dependencies themselves are unchanged.

The adapter emits a deterministic derived ZIP, a config fragment and a
provenance manifest containing every text replacement, initialized state,
source member hash, dependency rewrite and derived comp hash. It refuses to
overwrite a nonempty output directory. A new accepted export requires an
explicit adapter update and new reference provenance.

Prepare references from the project worktree, using the already verified local
runtime dependencies from the extracted handoff:

```sh
python3 web/tools/project-preview-design-adapter.py \
  /path/to/Deck.zip \
  .visual-diff/project-preview-adapter-r1 \
  --offline-deps /path/to/integrity-verified-dependencies
```

The imported canvases contain only the project preview flow and the declared
source menu composition. Other canvases in the archive are excluded. Shared
Blueprint assets remain byte-identical; the adapter does not convert them
into product code.

## Comparison contract

The pinned `noise visual-diff` 0.13.0 config accepts `clip` for an
implementation selector. It does not accept `cropSelectors` or `compClip`.
The reference crop comes from the comp's `data-screen-label` element, which
the adapter adds to the complete `.bp-dialog` or menu root.

Desktop fixtures use a 1180 × 720 viewport; mobile fixtures use 393 × 852.
Dialog comparisons select `[data-project-preview-dialog]`; menu comparisons
select `[data-project-menu-popover]`. This measures the complete new surface
without demanding that the prototype's surrounding workspace sample replace
Deck's existing workspace. These comparisons do not verify dialog placement,
scrim coverage or responsive workspace behavior; browser acceptance probes
must verify those separately. No masks are needed for these cropped surfaces.

Version 0.13.0 rounds reference crop coordinates and dimensions to CSS pixels,
but leaves implementation bounding boxes fractional. At device scale factor
2, a 523.4375-pixel mobile dialog produces a 1046-pixel screenshot while the
capture check incorrectly expects 1047. `project-preview-design-capture.mjs`
uses the same `Math.round` geometry as the importer for an invisible,
noninteractive capture frame. The product surface is untouched. The helper
checks that its layout did not move and that no visible text or control lies
outside the crop. This is a framing correction, not a mask or a pixel edit.

Source-backed states include enable, enabling, enable failure, exhausted
ports, initial setup, settings, connectivity checking, accepted/unsuccessful
connections, check failure, disable confirmation/failure, disabled access,
unconfigured installation, expanded Details and project menu variants. Static
registrations, static-only installation support and initial settings loading
have no supplied visual reference. Their real browser behavior must still be
tested; a capture of them is not evidence of convergence to a supplied comp.

The generated `config-fragment.json` names every exact comp and state. Merge
those entries into the project's `.visual-diff/visual-diff.json`, preserving its
existing states, then import the derived ZIP using the browser service:

```sh
noise visual-diff import --browser ws --refresh \
  .visual-diff/project-preview-adapter-r1/project-preview-references.zip
noise visual-diff capture --browser ws --serve web/dist
noise visual-diff compare --json
```

Pass repeated `--state` arguments to capture/compare when evaluating only the
project preview states; import accepts repeated `--only` comp names. Capture
and import are serialized across worktrees. `--serve web/dist` makes the tool
serve the build being tested instead of trusting a shared fixed-port server.
Reimporting changes the reference baseline: do not compare new captures with
numbers recorded against an earlier import. Keep the provenance manifest,
tool report and captured images together when reporting the visual gate.

## Public release compatibility

The image builds [Visual Diff 0.13.0](https://github.com/noisefloor-oss/visual-diff/releases/tag/v0.13.0)
from the public snapshot pinned in `Dockerfile`. The existing config schema,
labelled-screen mappings, `import --browser ws --refresh --only`,
`capture --browser ws --serve --state`, and `compare --json --state` remain
supported. The compare JSON fields and exit-code meanings remain unchanged:
0 succeeds, 1 exceeds the threshold, 2 rejects usage or config, 3 rejects
untrusted renders or provenance, and 4 rejects nondeterministic captures.

The [0.11.0 release](https://github.com/noisefloor-oss/visual-diff/releases/tag/v0.11.0)
adds `compTarget` for unlabelled comps, fixes piped JSON truncation, and corrects
reference frames widened by captions or hidden children. Version 0.13.0 also
allows `compTarget` on whole-comp mappings with labelled panels; existing
`comp#screen` mappings need no change. Version 0.12.0 freezes the full `Date`
constructor and suppresses smooth scrolling; 0.12.1 fixes window scroll
suppression. These render changes can affect pixels, so refresh references
and capture again before establishing a new baseline.

The [0.12.1 release](https://github.com/noisefloor-oss/visual-diff/releases/tag/v0.12.1)
also makes a failed font load an import/capture error (`font-load-failed`,
exit 3). Fix missing or invalid font files before retrying; a fallback font
is no longer accepted as a successful render. The public tree has no changelog;
its [README](https://github.com/noisefloor-oss/visual-diff/blob/v0.13.0/README.md)
and release notes describe the supported contract.

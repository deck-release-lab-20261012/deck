# Installation fonts

Font selection is a build-time installation setting in both public and private
source distributions. `NOISEDECK_FONTS=auto` is the default (unset or blank also
means auto): use the complete supplied licensed set, or the bundled OFL set
when no assets are supplied. `free` always selects OFL and ignores licensed
inputs. `licensed` requires the complete licensed set. Auto and licensed reject
incomplete, empty, unreadable or header-invalid supplied sets, listing the affected
files. WOFF2 signature, declared length and basic header fields are checked;
this is not a complete font sanitizer. They never assemble a mixture of licensed and fallback faces.

The bundled OFL set is Jost, EB Garamond and IBM Plex Mono. Their license files
ship in `web/public/fonts/free`. The licensed set is Euclid Flex (WebS and
WebXL), Operator Mono SSm Lig and Baskerville 10 Pro. You must supply your own
licensed webfont files and have permission to serve them to your users.

## Local build or development

Keep licensed binaries **outside the checkout**. Put all 42 WOFF2 files directly
in one directory; retain their original filenames. The complete filename list
is defined by the URLs in `web/src/styles/fonts/licensed.css`. Print it with:

```sh
cd web
node --input-type=module -e 'import {readFileSync} from "node:fs"; import {licensedFiles} from "./src/styles/fonts/select.ts"; console.log(licensedFiles(readFileSync("src/styles/fonts/licensed.css", "utf8")).map(p => p.slice(7)).join("\n"))'
```

Build with an absolute directory path (or use `pnpm dev` with the same setting):

```sh
NOISEDECK_LICENSED_FONTS_DIR=/absolute/private/fonts pnpm build
# Require licensed assets rather than allowing an asset-free installation:
NOISEDECK_FONTS=licensed NOISEDECK_LICENSED_FONTS_DIR=/absolute/private/fonts pnpm build
# Public/distributable build:
NOISEDECK_FONTS=free pnpm build
```

A configured directory that does not exist is an error, not an asset-free
installation. Remove the variable to return to auto/OFL. Rebuild or restart the
dev server after changing assets or settings. The licensed stylesheet and its
metrics are reused unchanged; no fonts are renamed or converted. Outputs contain
fonts at their existing `/fonts/…` URLs. Do not commit or publicly distribute a
licensed build. Existing Git history may still contain the old binaries; their
removal here does not rewrite that history.

## Local Docker image

Supply the external directory as a named build context:

```sh
docker build --target runtime \
  --build-context licensed-fonts=/absolute/private/fonts \
  --build-arg NOISEDECK_FONTS=auto -t deck:licensed-local .
```

Without this context, auto builds use OFL. Explicit licensed still fails without
assets. The default input stage carries only a reserved `.no-licensed-fonts`
marker; do not place this marker in your font directory.

The directory is mounted read-only for the frontend build and never copied into
a source layer. Unlike build secrets, [bind-mounted inputs participate in
BuildKit cache invalidation](https://docs.docker.com/build/cache/invalidation/),
so changing, adding or removing the context changes the selected build. The
compiled licensed assets enter the resulting private image and build cache;
keep the builder, its cache and the image private. Public image builds omit the
context and set `--build-arg NOISEDECK_FONTS=free`.

For the standard Compose build, add the opt-in overlay:

```sh
NOISEDECK_LICENSED_FONTS_DIR=/absolute/private/fonts \
NOISEDECK_IMAGE_TAG=licensed-local \
  docker compose -f compose.yaml -f compose.licensed-fonts.yaml build app
```

If also using `compose.go-mempalace.yaml`, append
`compose.go-licensed-fonts.yaml` as well: `go-base` builds the embedded
frontend independently. The canonical production wrapper selects both
font overlays when `NOISEDECK_LICENSED_FONTS_DIR` is exported in its
environment; see [production deployment](production-deployment.md).
Runtime environment variables cannot change an already compiled font choice.

## Verification

Run `pnpm test` and `pnpm typecheck` from `web`. Exercise real builds and
all licensed dev-server URLs with:

```sh
NOISEDECK_LICENSED_FONTS_DIR=/absolute/private/fonts node tools/font-build-probe.mjs
```

Without the directory, the probe exercises OFL and failure paths only. Compare
pre-change build artifacts against the candidate using the pinned browser:

```sh
node tools/font-visual-probe.mjs /private/baseline-licensed /private/candidate-licensed ../build/visual-licensed
node tools/font-visual-probe.mjs /private/baseline-free /private/candidate-free ../build/visual-free
```

The probe checks every configured state sequentially at DPR 2, with no content
masks, and fails on changed pixels or font loading errors. Outputs are local
validation artifacts; never commit licensed build directories.

Verify auto without inputs and
explicit free against the OSS visual baseline, and auto with supplied inputs
and explicit licensed against the private licensed baseline. Never refresh a
baseline to accept a selection regression. Compare the same source revision,
browser and viewport, wait for `document.fonts.ready`, and check that font
requests succeed. A free output must contain no licensed font binaries or
licensed font-face URLs. Test missing assets in licensed mode and a partial set
in both auto and licensed modes; each must fail before producing a new build.

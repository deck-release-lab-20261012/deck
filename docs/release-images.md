# Pre-cached production images

`Release images` publishes a complete production release set after successful
exact-main `Release acceptance`. It is opt-in and private-repository-only. It
builds the full MemPalace + Go profile, not the disposable acceptance fixtures.
The set contains free and optionally licensed app variants and their matching
browser sidecar. A private catalog binds source SHA, runtime UID/GID, capability
versions, licensed-font fingerprints and immutable image digests.

The catalog tracks the newest **completed, verified** set, not an unbuilt main
tip. A build that passed exact-main acceptance is promoted even if main advances
while it builds, provided it is still on mainline and does not downgrade the
published catalog. Queued runs coalesce on the latest successful main acceptance;
an unaccepted newer tip does not starve a working release. Publication is
serialized. Cached deployment still requires an exact source, UID/GID and font
match; an older cached set is never relabeled as a newer main commit.

## Enable once

Set repository variables:

- `NOISEDECK_RELEASE_IMAGES_ENABLED=true`
- `NOISEDECK_RELEASE_UID` and `NOISEDECK_RELEASE_GID` matching the installation
- `NOISEDECK_RELEASE_FONT_CONTEXT`, when licensed fonts are required: an
  immutable `ghcr.io/<owner>/<private-font-package>@sha256:...` reference
- `NOISEDECK_RELEASE_REQUIRE_LICENSED=true` for an installation requiring both
  variants

The private font input is a `FROM scratch` image containing only the licensed
WOFF2 files at its root. Its `com.noisefloor.deck.font-files` label is a JSON
object mapping filenames to SHA-256 hashes. Use the names required by
`web/src/styles/fonts/licensed.css`. Link the package to the private repository
before initial publication with `org.opencontainers.image.source`. Grant that
repository Actions access; do not expose the input or licensed outputs publicly.
Verify the actual package Actions permission: a source label is not a substitute
for this check. If linkage was not created, add the repository with Read access
under the package's **Manage Actions access** settings.
Registry authentication uses the workflow's `GITHUB_TOKEN`.
The four release packages also need the publishing repository's Actions Admin
permission for version deletion. Workflow publication normally grants it;
verify this under each package's Manage Actions access settings. Retention is
retried even when the exact release set is already published.

Packages must be private. Existing non-private packages are rejected. New GHCR
packages default to private; verify their visibility and access after bootstrap.
Private package visibility alone is not sufficient when making the source
repository public: inherited repository permissions can grant package access.
Before a public cutover, detach paid-font/package access from the public
repository and move licensed publication to private operator automation. This
workflow intentionally does not run in a public repository.

## Host prefetch (no automatic deployment)

Use a root-owned script installed from reviewed source and a protected registry
credential directory outside all Deck mounts. Give the host read access only
to its private image packages. Never put registry credentials in Compose env,
projects, the cache metadata, build arguments or CI artifacts.

Run from a systemd oneshot/timer, for example every three minutes:

```sh
DOCKER_CONFIG=/etc/deck-image-cache/docker \
  python3 /usr/local/lib/deck-image-cache/release-images.py prefetch \
    --registry ghcr.io/your-org --state-dir /srv/deck-image-cache \
    --require-licensed
```

The poll pulls catalog pointers, downloads and probes every image before
atomically replacing `sets.json`, and retains latest plus previous verified
sets. Unchanged complete caches do not re-run probe containers. Failed pulls,
bad versions or partial sets cannot replace admitted host metadata. Prefetch
never restarts Deck or deploys a new commit. Serialize timer execution with the
script's lock; do not run multiple independent publishers for the same package
prefix.

Registry retention touches only `deck-deploy-{free,licensed,browser,catalog}`,
including the child manifests/attestations of retained OCI indexes. It never
deletes the private font-input package. Local eviction touches only obsolete
managed digest references, never forces removal and protects images used by
running or stopped containers. Docker aliases may retain bytes; no blanket
image, volume or system prune runs. A deployment's own rollback tags remain
under operator control.

## Deploy a pre-cached set

Use a clean Git release checkout at the intended source SHA (not a source archive
without Git metadata). Cached admission verifies its actual HEAD and clean tree;
an env-file VERSION alone cannot identify the deployment-policy source.
Keep all existing production
configuration and normal private-font, preview and relay opt-ins. In the env
file, set `NOISEDECK_BUILD_VERSION` to the full source SHA and
`NOISEDECK_FONTS=licensed` or `free` explicitly. Runtime UID/GID must match the
published set. Export:

```sh
export NOISEDECK_RELEASE_REGISTRY=ghcr.io/your-org
export NOISEDECK_RELEASE_CACHE_DIR=/srv/deck-image-cache
deploy/production-compose.sh /protected/compose.env deploy-cached
```

Licensed selection also checks the installation's actual private-font files
against the published fingerprints. Selection probes the digest-pinned app
and browser, then tags those local images for the effective Compose graph.
Missing or mismatched sets fail without a compilation fallback. The canonical
wrapper still checks host files, preserves the previous app image, waits for
health and certifies the live MemPalace/Go/browser/OIDC profile. No BuildKit
cleanup is needed because cached deployment does not build.

For another installation wrapper, generate a protected Compose JSON config,
call `release-images.py select` with the same registry/cache and (for licensed)
font directory and `--checkout` pointing at that exact clean Git checkout,
then use the installation's normal no-build apply and live
verification. Do not print the rendered config; it contains credentials.

Record the source SHA, selected immutable digests, font variant, cache time and
live checks. An image version probe is not evidence of public-ingress health.
Roll back using the retained previous set and a schema-compatible checkout;
image retention never makes an incompatible database downgrade safe. Disable
the host timer and the repository enable variable to withdraw this automation.

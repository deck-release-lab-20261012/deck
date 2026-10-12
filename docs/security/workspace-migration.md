# Migrate an existing workspace into encrypted storage

Use an offline snapshot and a separately enrolled encrypted installation. This
is an operator-assisted migration, not an in-place conversion or a protection
setting toggle. The original deployment and files remain unchanged. The same
public hostname can be retained at cutover.

Do not change the old installation's pinned protection policy or reuse its
control database. The new owner enrolls their own encryption method and recovery
key. SRE does not need either secret to copy into the unlocked volume.

## Before starting

Follow the [gateway installation guide](workspace-gateway.md) and
[native controller qualification](workspace-native-controller.md). Use a
qualified Linux host with local source storage and enough space for the old
files, a private plaintext snapshot, and a new encrypted copy. Source containers
may use local Docker or Podman; the destination uses the existing qualified
rootless Podman profile. A Docker Desktop client's paths are paths inside its
Linux VM, not macOS host paths: run the snapshot command where those files
actually exist. Remote engines are not supported.

Inventory the source's complete Compose project and persistent mounts. This
version supports the standard `/data`, `/home/agent`, `/workspace`, separate
`/home/agent/.config/gh`, and optional `/home/agent/.mempalace` layout. A home-local
GH directory can supply `gh` if no separate mount exists. Unrecognized persistent
mounts refuse export rather than silently disappearing. Stopped sidecars must
also have every persistent mount fully covered by copied stores; mounts spanning
an omitted subtree refuse export. Review shared GH and
MemPalace ownership before copying: the destination becomes a private copy, not
a continuing shared mount. Configuration, source images and host-level secrets
needed to recreate the deployment remain SRE's separate backup responsibility.

Supported file metadata is regular-file bytes, permission bits, nanosecond
modification times, directories and verbatim symlink targets. Absolute links
retain their container paths. Store roots become mode 0700 and all copied
ownership maps to the destination owner. Hard links, ACLs, non-SELinux extended
attributes, capabilities, special permission bits, nested filesystems, FIFOs and
device files refuse export. SELinux labels come from destination host policy;
source labels are not transported. Unix sockets and the old `data/gateway`
process endpoint directory are omitted. The app's `/tmp` is disposable scratch
and is omitted whether backed by tmpfs, a bind mount or a volume, including the
disk-backed mounts in the shipped plain and production profiles. A sidecar's
disk-backed `/tmp` still requires copied-store coverage. Container processes
are not migrated. The private `source-report.json` records source-tree exclusions
and omitted app mount destinations (temporary storage and host identity/state
mounts). Preserve any wanted temporary files separately before taking the snapshot.
Do not remove or flatten unsupported source metadata merely to make the command
pass; assess its meaning and prepare a separately verified conversion if needed.

Stop active sessions through Deck, then stop the entire old Compose workload.
Disable its supervisor and container restart policies. Preserve stopped
containers until snapshot creation finishes so the engine can attest their IDs,
project labels, mounts and stopped state. The command requires restart policy
`no` (or absent), rejects active sidecars and other live containers sharing source
paths, and rechecks state and source bytes after copying. These observations do
not stop host editors, sync services, scheduled jobs or an independent engine:
SRE must quiesce those writers too. Keep the source stopped through acceptance.

## Create the private snapshot

Run `noise deck workspace snapshot --config /absolute/source.json` as a user who
can read every source file. Root may export Docker-owned volumes and assign the
result to the new dedicated owner. A non-root caller must be that owner. The
source configuration must be canonical, caller-owned and mode 0600; the output
parent must already exist, be owner-only, and belong to the destination
owner. The output directory itself must not exist and must not overlap a source.

Example inventory, with installation-specific IDs and paths substituted:

```json
{
  "engine_path": "/usr/bin/docker",
  "engine_socket": "/var/run/docker.sock",
  "home_dir": "/root",
  "runtime_dir": "/run",
  "container_id": "FULL_64_CHARACTER_CONTAINER_ID",
  "compose_project": "old-workspace",
  "output_dir": "/srv/private-migration/snapshot-1",
  "owner_uid": 1100,
  "owner_gid": 1100
}
```

For Podman use its canonical executable path, omit `engine_socket`, and set the
source owner's home and runtime directories. The command forces local engine
access and does not inherit a remote Docker/Podman connection from the shell.
Inspect only the required ID/mount/project fields; avoid dumping container
environments into logs or a handoff.

Successful export prints the manifest SHA-256. It verifies the byte copy before
opening **only the copied** `data/noisedeck.db`, applies this Deck version's frozen
schema migrations, checks SQLite integrity and foreign keys, and records an
intentional stop for every retained session generation. Native provider IDs,
history and project paths stay intact. Unresolved successor recovery slots refuse
export; reconcile those in the old runtime before another snapshot attempt.
No provider transcript or private state format is parsed.

Active confined project-security domains also refuse export: their backing and
approvals need a separate authority-aware restore, not copied approval rows.
This procedure supports the deployed unconfined workspace profile.

An interrupted or refused export leaves its private output for inspection and
never calls it complete. Retry into a new output directory. Do not point a gateway
at a partial export or hand-edit its manifest. Preserve an independent backup;
a successful snapshot is not by itself a restore drill.

## Enroll and import

Prepare a **new** required-encryption installation with its own instance ID,
Compose project, dedicated owner, control directory, empty ciphertext directory
and empty mountpoint. Preserve the original installation and its rollback
configuration. Before first gateway startup or setup-link generation, pin the
snapshot and the printed digest in the new gateway JSON:

```json
{
  "encryption_policy": "required",
  "native": {
    "Migration": {
      "SnapshotDir": "/srv/private-migration/snapshot-1",
      "ManifestSHA256": "EXACT_PRINTED_SHA256"
    }
  }
}
```

This is a fragment: retain all required fields from the gateway configuration
example. `Migration` is installation-owned, fingerprinted configuration. It
cannot be added to an existing journal or changed after initialization. The
snapshot must be outside ciphertext, mount, control and engine-state roots, and
owned by the destination owner. Do not offer an unencrypted setup branch for a
migration explicitly configured to require encryption.

1. Start the new gateway and privately hand off its setup link. The owner signs
   in with Google, creates and verifies an unlock method, and saves and checks
   their recovery kit. They then see **Waiting for your existing data**. Their
   volume is open, but no private application has started and no browser has
   application access. Checking status does not start copying.
2. Stop the **new gateway process only** and disable automatic restart while
   importing. Its normal shutdown preserves the unlocked volume. Do not use
   workspace lock or unmount it during this step.
3. As the dedicated destination owner, with the gateway's normal configuration
   and Google-auth environment available, run:

   ```sh
   noise deck workspace import --config /absolute/new-gateway.json
   ```

   The command takes `gateway.lock` before opening the native journal. It
   requires the recorded successful enrollment, an observed qualifying encrypted
   mount, and an absent destination Compose workload. It opens the mount once
   and copies through that descriptor; a detached pathname cannot redirect
   writes into the plaintext mountpoint.
4. Wait for **Workspace data import verified**. The import copies into a private
   staging directory, verifies all files, then publishes the stores and records
   completion against the manifest and volume configuration. It neither starts
   Deck nor switches the proxy.
5. Restart the gateway. The owner checks import status and proves their saved
   unlock method again. The original enrollment resumes; it does not create
   replacement keys or another volume. Setup finishes only after the actual
   runtime and private ingress pass their existing readiness checks.
6. Validate projects, provider-native history, GitHub configuration and MemPalace
   data with the owner. Existing sessions stay stopped until explicitly reopened.
   Switch the production route only after acceptance. Do not expose a direct
   backend port as a way around the gateway.

If the volume closed or the host rebooted before import, the owner must resume
setup with their saved method to reopen it. The runtime still refuses application
startup until the import finishes. SRE never asks for the password or recovery
key. Existing passkey PRF support restrictions remain unchanged; a software
password manager can retain the encryption password without qualifying its
passkeys for encryption.

## Interruption, rollback and plaintext retention

A cancelled copy can be retried with the same command and pinned manifest. Only
its recorded incomplete staging directory is rebuilt. Interrupted publication
verifies each already-published store before moving the remaining ones. A
mismatching digest, corrupt source, extra destination data or changed published
store refuses the retry. Preserve all evidence and investigate; do not delete a
native operation journal or reinitialize storage to force progress.

If publication finished but the command stopped before its native journal commit,
retry requires the pinned snapshot manifest and re-verifies every published store.
A completion receipt alone does not authorize startup. Keep the snapshot until
the command reports success; missing or corrupt publication refuses recovery.

A completed import never recopies its data, including after gateway restart.
Subsequent owner edits survive repeated import commands. After acceptance, the
plaintext snapshot can be removed under SRE's retention policy; ordinary unlocks
and restarts do not require it. Keep the pinned migration configuration and
native journal even after staging is removed.

Before accepting destination writes, rollback is an explicit ingress/configuration
switch to the preserved old deployment. After destination writes begin, returning
to the old copy loses those newer changes unless they are reconciled first. No
command here starts both deployments, removes the original, or automatically
rolls back traffic.

Old source files, staging, disk snapshots and backups remain plaintext. Retention
and deletion require an explicit operator decision after acceptance. File deletion
does not prove erasure of storage snapshots or backups. Migration makes no new
claim about live RAM, an actively hostile host, or retroactive protection of old
copies.

## Evidence required before cutover

Local tests cover SQLite and opaque-file preservation, source changes and omitted
mounts, hostile manifest paths, corrupt/partial copies, publication interruption,
startup refusal before import, and fresh proof after import. Run the production
browser flow against the Go gateway with:

```sh
cd web
DECK_WORKSPACE_BROWSER_MIGRATION=1 node tools/security-go-probe.mjs
node tools/onboarding-probe.mjs
```

Build this checkout's frontend first. The browser harness uses the pinned
sidecar client and synthetic native observations; it does not qualify FUSE or
Podman. It must observe the waiting state, no application access, read-only
status checks and saved-method resume.

On the prepared destination host, run `deploy/test-workspace-runtime-host.sh`.
It uses disposable data to exercise real encrypted import, controller restart,
source preservation, plaintext-staging removal and lock/unlock persistence.
Exit 77 means missing prerequisites, not a pass. It does not launch Deck. Also
exercise an interrupted import on disposable deployment-sized data, a gateway
restart/reboot before and after import, the real sealed launch, and a restore of
the preserved source. Complete the existing shared-host denial, ingress, swap,
crash-dump and real-CLI qualification before claiming the deployment protected.

# Explicitly unencrypted native runtime

`internal/workspaceplain` controls a fresh installation selected through the
gateway's explicit no-encryption onboarding path. It is separate from
`workspaceruntime`, never a fallback from failed encryption. It makes no claim
against host administrators or readers of disk, backups, logs or process memory.
The shared workspace remains unconfined; this does not enable Continuity.

The caller owns owner authentication, atomic irreversible mode selection and
operation authorization. Controller configuration is fixed by installation;
browser parameters cannot choose commands, paths, UIDs or Compose projects.
Host integration must reject overlap with encrypted cipher/mount directories.
An existing encrypted journal in the shared control directory is not itself
proof that storage was initialized; the gateway registry owns that distinction.

`ValidateConfig` and `Open` never create workload stores or start processes.
Provision empty, private state/control directories and an owner-only Compose
environment file before opening. The controller runs as its configured non-root
UID on Linux. Its Podman home and runtime directory remain outside the workload
root. Commands receive only a fixed environment; their stderr and uncontrolled
output are discarded. OIDC settings remain in the existing Compose env file.

`Start(ctx, operationID)` creates owner-only `data`, `home`, `projects`, `tmp`,
`gh` and `data/gateway` stores. It rejects unrelated preexisting files, including
gocryptfs metadata. The private journal pins the installation configuration and
state-root inode/device; each created store gets its own persisted identity.
The layout marker alone never authorizes adopting an existing directory.

A prepared operation may resume only directories already recorded or still
absent. A crash after mkdir but before recording its identity leaves ambiguity
and refuses automatic adoption. After persisting the dispatch stage, the same
operation ID is permanently observe-only. A new ID cannot bypass an unresolved
operation. Observation may confirm a dispatched start once current processes,
gateway ingress, storage binds, socket and health are verified. A command exit
alone is never success. `Operation` does not launch or repair anything.

`deploy/plain-compose.sh` applies the plain and gateway overlays to rootless
Podman. It uses `up --no-recreate --no-build`: restarting the gateway or asking
to start an already running workspace cannot replace live containers and CLIs.
No workload or relay ports are published; the existing OIDC backend listens on
`StateRoot/data/gateway/backend.sock`. Public traffic must traverse the gateway.
The native observer checks the actual app process, configured project membership,
binds, transport settings and absence of bypass ports. It refuses extra project
containers, host networking and any mount beyond the five managed writable binds,
the read-only machine-identity bind and the `/run/noisedeck` tmpfs. An extra named
volume or tmpfs below a managed bind cannot redirect workspace data outside its
pinned store.

The state reports `configured` only for a complete validated layout, including
when the app is stopped. `runtime` describes the actual configured app and is
`stopped`, `starting`, `running` or `unknown`. There is no storage-lock or
encryption field. Runtime epochs derive from boot, root and process identity.
`Close` releases only the journal; it never stops the workload. Unencrypted mode
has no encryption-unlock or storage-lock action.

The automated tests use synthetic command/process observations and temporary
directories and sockets. They do not qualify real Podman, browser admission,
OIDC or provider continuity. Deployment qualification must use a disposable
instance, verify the actual Unix listener and blocked alternate ports, interrupt
startup, restart the gateway while a real CLI runs, and confirm the same CLI
process and files survive. No production instance should be used as a probe.

SRE can run `deploy/test-workspace-plain-host.sh` with
`NOISEDECK_PLAIN_HOST_CONFIG` naming a `Config` JSON file for empty disposable
state/control directories and a `deck-plain-test-*` project/container. The
opt-in probe starts the real app image, waits for native readiness, checks that
controller restart and same-ID observation preserve its epoch, then removes
only the previously absent test container. It leaves the disposable files for
inspection. It does not exercise a real provider or Google sign-in. The script
exits 77 when native prerequisites are unavailable; default Go tests skip it.

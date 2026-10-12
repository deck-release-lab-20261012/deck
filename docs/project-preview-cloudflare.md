# Exact preview DNS with Cloudflare Tunnel

This optional operator-host integration shares a preview domain across Deck
installations without adding a DNS label. For example `main-p-<hash>.example.net`
and `p-<hash>.example.net` can use separate gateways under a wildcard certificate.
The preview domain must still have a different registrable domain from Deck.
This does not buy certificates or enable a paid Cloudflare service.

Set a distinct managed `hostname_prefix` before allocating previews. Keep each
installation's prefix and port pool stable. Provision a separate Cloudflare
Tunnel whose remote ingress accepts the preview domain, preserves Host and
forwards to `http://127.0.0.1:8840`, with a final HTTP 404 rule. The Deck gateway
admits only its enabled registered hosts. No preview or dev-server port is
published. Do not change another installation's wildcard DNS or tunnel.

The `compose.preview-tunnel.yaml` connector shares the app's network namespace.
For the canonical production wrapper, export
`NOISEDECK_PREVIEW_TUNNEL_TOKEN_FILE=/absolute/private/connector-token` for every
config/build/apply/verify/deploy invocation. Store that path in the protected
operator launch environment, not only `compose.env`: it selects the overlay.
The token file must be readable by container UID 65532; keep its host parent
directory root-only. This is a connector token, **not a DNS administration
token**. The wrapper recreates the connector with the app and verifies their
network namespaces match. Omitting the opt-in while a connector exists refuses
rollout. Check actual HTTPS ingress separately: a running connector is not
proof of a working remote tunnel.

## DNS reconciler

Install the reviewed `deploy/preview-dns.py` on the operator host at
`/opt/deck-preview-dns/preview-dns.py`, root-owned and not writable by Deck or
agent users. Install the supplied systemd service and timer. Python 3 with its
standard SQLite module is sufficient; no dependencies are downloaded.

Resolve the **live** database's host path before creating configuration. The
canonical Compose profile sets `NOISEDECK_DATABASE_PATH=/data/noisedeck.db` and
mounts the `deck-data` named volume at `/data`; it does not create `/srv/deck/state`.
The following read-only probe verifies that layout, resolves Docker's actual
mount source (including a custom Docker data root), checks the file and preview
table, and prints only the resulting host path:

```sh
sudo docker inspect noisefloor-deck | sudo python3 -c '
import json, pathlib, sqlite3, sys
containers = json.load(sys.stdin)
assert len(containers) == 1, "expected one production container"
container = containers[0]
env = dict(value.split("=", 1) for value in container["Config"]["Env"])
assert env.get("NOISEDECK_DATABASE_PATH") == "/data/noisedeck.db", "resolve the custom database path before continuing"
mounts = [m for m in container["Mounts"] if m["Destination"] == "/data"]
assert len(mounts) == 1 and mounts[0]["Type"] in ("volume", "bind"), "expected the data mount"
path = pathlib.Path(mounts[0]["Source"]) / "noisedeck.db"
assert path.is_absolute() and path.is_file(), "database file is absent"
with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as db:
    db.execute("SELECT project_id, origin FROM project_preview_registrations LIMIT 0")
print(path)
'
```

For the default rootful Docker layout and Compose project `deck`, this normally
prints `/var/lib/docker/volumes/deck_deck-data/_data/noisedeck.db`. Use the observed
path, not that assumption. If the container has a custom database path or mount,
resolve that path through its corresponding mount and validate it read-only
instead; do not create an empty database or move the live database for DNS.

Create root-only `/etc/deck-preview-dns/` with this `config.json`, replacing the
database placeholder with the verified path and the other installation values:

```json
{
  "database": "/replace/with/resolved/host/noisedeck.db",
  "token_file": "/etc/deck-preview-dns/dns-token",
  "zone_id": "replace-with-zone-id",
  "base_domain": "example.net",
  "hostname_prefix": "main-p-",
  "tunnel_id": "replace-with-tunnel-uuid"
}
```

Use a zone-scoped token with DNS edit and zone read access, in an owner-only
file. Keep it outside all agent/app mounts. The service reads only project IDs
and retained origins from `project_preview_registrations` through a read-only
SQLite connection. It does not read project contents, credentials, sessions or
private histories, and never modifies the database. The host path must be
readable under the service's systemd restrictions; the supplied unit permits
the canonical `/var/lib/docker` layout or state under `/srv`, but hides home
directories. A rootless Docker data root under a home directory requires a
reviewed unit adjustment before use. Root is used to read an existing
operator-owned database; it does not run any project code.

Run without `--apply` first to check namespace, zone and existing-record
ownership. Then run with `--apply` and enable `preview-dns.timer`. A new preview
normally receives its exact proxied CNAME within 30 seconds plus DNS propagation.
The result reports counts only. Inspect service failures with `systemctl status
preview-dns.service`; API error bodies and credentials are not logged.

The reconciler validates the full registration set before any writes and
refuses records outside its exact prefix/hash/domain namespace. It creates
missing records with an ownership comment; it never patches or deletes records,
adopts unowned records, or changes a wildcard. Disable/removal retains DNS because
Deck retains the origin reservation: the gateway refuses access immediately,
and another installation's wildcard cannot take the address. An interrupted
create is reconciled by reading remote state on the next run. The service is
serialized by systemd; do not run concurrent manual instances.

## Verification and rollback

Use two synthetic projects, not another user's projects. Run the preview probes
and actual HTTPS checks in [the operations checklist](project-app-preview-operations.md).
Confirm anonymous HTTP/WS refusal, cookie separation, simultaneous previews,
hot reload, disable/re-enable and restart revocation. Check both connector
namespace attachment and the DNS timer after a normal redeploy. Keep licensed
font overlays and all other production capabilities unchanged.

Rollback: stop/disable the timer, withdraw the **dedicated** tunnel ingress,
stop/remove its connector through Compose with the overlay still selected,
disable the complete preview configuration, then roll out through the normal
wrapper without the connector opt-in. Retain exact DNS reservations; do not
delete them into a sibling wildcard. Restore only schema-compatible images.
The application database is never modified by this integration.

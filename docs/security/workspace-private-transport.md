# Private workspace transport

The encrypted workspace gateway needs exclusive access to the running Deck
backend. A publicly reachable backend port would accept a Google session
without the gateway's separate method-backed browser grant. The optional
Linux Unix listener closes that route: `server.unix_socket` replaces the
TCP listener, and each connection must carry the configured owner's UID in
the kernel's `SO_PEERCRED` result. HTTP headers cannot supply that identity.

Configure the backend with the existing Google OIDC mode and the same
dedicated non-root UID as the host gateway. The shared-host rootless Podman
profile uses `keep-id`, preserving that UID across the container boundary.
The gateway forwards the admitted Google cookie; the backend still performs
its normal authentication and CSRF checks.

```yaml
server:
  bind: ""
  unix_socket: /data/gateway/backend.sock
  gateway_uid: 1000
  allowed_origins:
    - https://deck.example.test
sealed:
  require_encrypted_state: true
  profile: shared-host
```

The matching environment variables are `NOISEDECK_SERVER_BIND` (explicitly
empty), `NOISEDECK_SERVER_UNIX_SOCKET`, and `NOISEDECK_SERVER_GATEWAY_UID`.
The UID is an installation value, not a browser input. Provision the socket's
parent directory with mode 0700, owned by that UID, inside the qualified
encrypted data mount. Use an absolute canonical path of at most 103 bytes;
neither the directory nor the socket may be a symlink. The listener creates
the socket with mode 0600 and removes it on ordinary shutdown. It refuses
to replace a live or uncertain listener, a non-socket file, or a socket
owned by another UID. It replaces a stale socket only after a local connect
reports connection refused and its identity is unchanged.

Startup checks the socket directory against the actual sealed stores before
opening the listener. The private mode refuses a simultaneous TCP bind,
password/proxy authentication, HTTP browser origins, the alternate project
preview listener, and the TCP capacity-routing experiment. Provider identity
hooks and the container health check use the same socket, with no TCP
fallback. Their existing capture tokens and bounded retry behavior remain
required. Provision the matching hook assets before launch as usual.

This transport is one prerequisite for the complete gateway deployment.
Compose must publish no backend port, and every external data route and
stream must pass the gateway's browser-grant check. A successful local socket
test does not qualify the host or prove that those deployment paths are
closed. Existing deployments continue using TCP unless this mode is
explicitly configured.

The boundary covers accidental direct access and ordinary access by another
host identity under the shared-host profile. Processes deliberately running
as the dedicated owner, including the unconfined agent workload, share that
authority. Hostile identity switching, namespace entry, software changes,
and memory inspection remain outside the profile. This is neither project
confinement nor encryption of live memory.

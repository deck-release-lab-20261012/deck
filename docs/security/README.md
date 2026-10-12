# Security records

Everything in this directory is a dated record — a ratified design, a threat
model, or a qualification packet — held at the version its header names. None
of it describes how Deck behaves today; for that, read
[`../PRINCIPLES.md`](../PRINCIPLES.md).

These records retain the rules and reasons behind earlier decisions in plain
words. See the [decision-record index](../adr/README.md) for historical context.

The implementation contract for browser-managed workspace encryption is
[ADR-0014](../adr/0014-browser-managed-workspace-encryption.md). It defines
enrollment, encrypted method envelopes, browser grants, native runtime
locking and the hostile tests needed before claiming a deployment is
protected. It is an accepted design, not evidence that those components are
implemented or that a host has qualified. Its
[version-1 protocol](workspace-crypto-v1.md) defines wire formats, API states
and public interoperability fixtures.

The opt-in [workspace gateway runbook](workspace-gateway.md) covers the
always-on unlock service, private backend, enrollment invitation and host
qualification required before onboarding a user.

The [workspace onboarding contract](workspace-onboarding.md) separates fresh
setup completion from encrypted initialization and defines an explicitly
provisioned unencrypted choice without changing legacy application startup.

The [browser interoperability probe](workspace-browser-interop.md) exercises
the production browser cryptography against the Go gateway. Its explicit
test substitutes do not qualify a deployment host or an authenticator.

# Workspace onboarding control contract

Managed workspace setup records a protection choice independently of encrypted
volume initialization. This is a fresh-installation protocol for the workspace
gateway. An ordinary Deck app without the gateway marker keeps its existing
authentication and startup behavior; a missing marker never starts onboarding.

The installed `workspacekeys.Config.EncryptionPolicy` is `required` by default.
An explicitly provisioned `optional` installation can select `encrypted` or
`none`; `unavailable` permits only `none`. These are installation facts, not
inferences from a failed native observation or unsupported browser passkey.
The control store pins the policy on first creation. Reopening it with another
policy refuses. A registry created before this metadata existed upgrades to
`required`, including when no encryption method has yet been saved. Existing
methods, commitment, or native initialization intent identify an encrypted
installation. This upgrade does not make existing deployments optional.

## Selection and authority

The existing local setup-link issuance and Google redemption bind the owner and
issue the independent setup receipt described in ADR-0014. Merely visiting a
fresh installation, signing in, or possessing the host's Google cookie-signing
secret cannot choose its protection or prepare its first method.

Selecting protection requires the receipt, its current login, and the pinned
owner. The decision is durable and cannot be changed through this API. Older
clients remain compatible: their first successful method preparation commits
`encrypted` in the same transaction as the pending method. A concurrent
`none` selection and method preparation cannot both succeed.

Selecting `none` additionally requires no method, encrypted commitment,
challenge, crypto operation, or native initialization intent. It reserves the
first public plain-start operation ID and retires the setup receipts atomically.
After this explicit choice, the pinned owner's current Google login can resume
that start without the original receipt. This makes no independent encryption
or privacy claim against a host that can forge the local Google cookie. It
cannot change the owner, select another protection mode, prepare encryption
methods, or manufacture a method-backed browser grant.

`OnboardingState.SetupComplete` is durable setup history, not observed runtime
readiness. For encrypted installations it follows the existing completed native
initialization and method activation. Plain completion has its own record and
never sets `workspacekeys.State.Initialized`, `BootstrapClosed`, or a volume
commitment. Enabling encryption later uses the separate
[operator-assisted migration](workspace-migration.md). Onboarding cannot convert
or overwrite existing workspace data; a migration-configured installation pauses
after owner enrollment until its verified offline import completes.

## HTTP contract

All paths below are under `/api/security/v1`. Responses are not cacheable.
Authenticated mutations retain the existing exact-origin and CSRF requirements.

| Request | Result and authority |
| --- | --- |
| `GET /onboarding` | Public `{policy, protection, setupComplete, started}` only. `started` means an owner has bound setup; it exposes no identity. No method, receipt, runtime, or operation ID. |
| `GET /state` | Authenticated pinned-owner view adds `ownerBound`, `onboarding`, and `plainOperationId` when selected. |
| `POST /onboarding/protection` | Body `{protection: "encrypted" \| "none"}`; requires the independent setup receipt. Returns the coarse onboarding state. |
| `POST /onboarding/start` | Body `{operationId?: string}`. Requires the pinned owner and committed `none` choice. An explicit ID addresses the current pending intent; omission asks the trusted service to observe and prepare an eligible start. |
| `GET /onboarding/operations/{id}` | Pinned-owner observation of that plain operation. Does not dispatch native work or issue access. |

A successful start submission returns `{id, status: "accepted"}`. A controller
error after dispatch returns HTTP 202 with that ID and `status: "unconfirmed"`.
Neither response claims the runtime is ready. The ID is reserved before native
effects and available from authenticated `/state` after a lost response. Status
observation stays in the onboarding namespace; encrypted proof and operation
routes keep their existing meaning.

Authenticated `/state` uses `awaiting-protection` for an undecided optional or
unavailable installation, `awaiting-start` for an incomplete plain installation,
and `ready` for completed setup. Runtime observation is separate even when setup
is ready. `browserGranted` remains specific to encrypted method-backed access.
`workspaceAuthorized` asks the configured access verifier only after the
selected protection's setup completion. The integration must check current
Google admission, mode, and observed private-runtime readiness before admitting
application requests or streams. Plain runtime storage is `unencrypted`, never
`open` or a successful lock. No native controller is provided by this API layer.

## Trusted plain-runtime adapter

`workspacegateway.PlainOperations` exposes `Prepare`, `Execute`, and `Status`.
The adapter must validate the registry's `PlainStartPermit` again before an
effect. The permit is process-local, pinned to the owner and current Google
login, expires after five minutes, and cannot be reconstructed from JSON or a
durable receipt. `CurrentPlainStart` and `PlainOperation` return observation
records only. Restart recovery obtains fresh owner authorization, observes the
same native operation, and never blindly repeats ambiguous effects.

The adapter calls `CompletePlainStart` only after positively observing the
expected available private runtime. `FailPlainStart` is only for a confirmed
failure with no remaining effects; uncertainty stays pending. Once an operation
is terminal, `ReservePlainStart` can reserve a distinct ID only when the caller
supplies the exact previous ID. Calling that method is a trusted service action:
native observation must first establish stopped with no unresolved effects.
This allows a later start after a host reboot without erasing completed setup.
The adapter serializes native decisions and preserves their journal semantics;
browser-supplied booleans or status labels confer no authority.

The registry and HTTP tests exercise real SQLite transactions, independent
receipt refusal, immutable policy upgrades, concurrent selection/preparation,
owner/session binding, expired and reconstructed permits, restart observation,
separate plain completion, CSRF/origin gates, and non-replaying status reads.
They do not qualify a host, container runtime, browser provider, or deployment.

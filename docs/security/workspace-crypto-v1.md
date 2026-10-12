# Workspace encryption protocol, version 1

This is the implementation contract for [ADR-0014](../adr/0014-browser-managed-workspace-encryption.md),
not a statement that the gateway, controller or deployment is qualified.
Unsupported versions fail explicitly; implementations do not guess a format,
downgrade parameters, or report success for an untested method.

## Envelope and proof bytes

The browser generates one random 32-byte volume unlock secret per instance.
Its canonical unpadded base64url encoding is the native gocryptfs credential;
gocryptfs generates and wraps its separate filesystem master key. Each method
gets its own fresh ECDSA P-256 proof key pair, including password replacements.

An envelope is a JSON object with these exact fields. Object member order is
irrelevant; reject unknown fields and enforce all bounds before a KDF/import.
Binary values use canonical unpadded base64url, with decode/re-encode equality.

| Field | Required value |
| --- | --- |
| `version` | Integer `1`. |
| `instanceId`, `methodId` | Server-owned ASCII identifiers matching `[A-Za-z0-9_-]{1,128}`. |
| `revision` | Integer `1..4294967295`. |
| `kind` | Exactly `passkey`, `password` or `recovery`. |
| `salt` | Fresh random 32 bytes per envelope. |
| `nonce` | Fresh random 12 bytes per encryption. |
| `ciphertext` | AES-256-GCM ciphertext followed by its 16-byte authentication tag; at most 4096 decoded bytes. |
| `proofPublicKey` | P-256 SubjectPublicKeyInfo DER, at most 1024 decoded bytes; import must validate key type and curve. |
| `iterations` | Present only for `password`, exactly integer `600000`. Absent for other kinds. |

AAD is UTF-8 of the no-whitespace JSON array
`["deck.envelope",1,instanceId,methodId,revision,kind]`, in that order.
ASCII identifiers and fixed field types avoid cross-language escaping choices.
The encrypted plaintext is UTF-8 of `[1,unlockSecret,proofPrivateKey]`:
an exact three-element JSON array, with a 32-byte base64url secret and
base64url P-256 PKCS8 DER. Reject wrong types, length, version, malformed UTF-8,
invalid key material or extra elements. Bound PKCS8 to 2048 decoded bytes;
do not require every valid encoding to have one particular length.

Store the public volume commitment as canonical base64url of
`SHA256(UTF8("deck.volume.v1\0") || unlockSecret32)`. Here and below, `\0`
means one zero byte. It is fixed when initial enrollment accepts the first
candidate, and cannot change during ordinary method management. A browser
opens an envelope against the expected instance, method, revision, kind,
public proof key and commitment from the server-owned operation context.
It compares the recovered volume secret's commitment before using its key.
It also checks that the decrypted private key corresponds to the stored
public key, for example by signing and verifying a fresh local challenge.

Proofs sign the raw 32-byte server challenge using ECDSA with SHA-256.
The signature is exactly 64 bytes, big-endian `r || s`, as WebCrypto returns.
Accept either valid S value; single-use challenges supply replay protection.
WebAuthn authenticator signatures have their own verification/encoding and
must not use this raw-signature parser.

Import decrypted proof/AES keys as nonextractable for subsequent use.
The initial proof private key must be exportable only long enough to wrap it.
Drop references and clear form fields after the ceremony; do not persist
decrypted material in browser storage, URLs or service-worker caches.
JavaScript cleanup is best effort, not guaranteed physical memory erasure.

## Wrapping-key derivation

| Kind | Derivation of the 32-byte AES key |
| --- | --- |
| `passkey` | WebAuthn PRF `eval.first = salt32`; require a 32-byte output, then HKDF-SHA-256 with that output as IKM, the same salt and AAD as `info`. |
| `password` | PBKDF2-HMAC-SHA-256, exactly 600,000 iterations, using the envelope salt. |
| `recovery` | HKDF-SHA-256 with the independently generated recovery secret32 as IKM, envelope salt and AAD as `info`. |

Password input must be well-formed Unicode, normalized to NFC and encoded as
UTF-8. Never trim, case-fold or truncate it. The crypto input accepts 1..1024
normalized bytes; new-password UI additionally requires at least 15 Unicode
code points. Accept spaces, paste and password-manager input. Changing the
KDF cost requires an explicitly supported format; reject unsupported costs
before work rather than trusting an arbitrary iteration count.

An ordinary successful WebAuthn login without PRF output is insufficient.
Offer another supported credential, an explicitly chosen password, or an
existing recovery method; do not silently substitute authentication for
decryption. Pin the exact HTTPS origin and RP ID in deployment configuration.
Validate ceremony type, challenge, origin, RP ID, credential, presence and
user verification with a maintained WebAuthn implementation. Synced passkeys
require backup-aware counter handling rather than an unconditional strictly
increasing counter rule. Hardware-only policy is separately declared.

## Challenge and browser-grant records

A challenge contains 32 cryptographically random bytes and expires within
five minutes. Its server-side record binds `(issuer, subject)`, stable login
session ID, instance, operation, authorizing method/revision, target/revision,
SHA-256 digest of the exact proposed nonsecret control payload bytes and runtime
epoch. Bootstrap challenges additionally bind the enrollment receipt record
and enrollment revision; require that receipt again at consumption. The
scoped `resume-enrollment` exception instead binds the current enrollment
revision and its persisted pending method. Record
those control bytes; execute that stored payload, not a later
caller's interpretation. A volume-secret handoff is a separate ephemeral
field, checked against the bound instance commitment and never persisted in
the challenge or operation record. For passkeys the same challenge also binds the fresh
user-verified WebAuthn assertion. Missing, expired, consumed or mismatched
records fail without effects.

Consume the challenge and change control records in one transaction.
External effects receive a durable operation ID before dispatch; after a
disconnect, observe/reconcile that operation instead of replaying uncertain
signals, storage initialization or mount actions. Changing an envelope
invalidates candidate tests and challenges for its earlier revision.

A browser grant is an independent random 32-byte bearer cookie: host-only,
Secure, HttpOnly and SameSite=Lax. Store only its SHA-256 hash with owner,
stable login-session ID, issuing method/revision, runtime epoch and absolute
expiry, at most 12 hours. Google renewal preserves the stable session ID but
never mints or silently extends an unlock grant. Require origin validation
and session-bound CSRF protection for mutations. Never serialize a grant
into localStorage or generate it from a readable stateless signing secret.

Logout revokes that browser's grant and streams. Method removal revokes its
grants. Lock or runtime-epoch change revokes all affected grants/challenges;
gateway restart discards grants/challenges and reconciles native state.
Neither logout nor gateway restart by itself stops running agents.

Grant issuance consumes one completed `authorize-browser`, `initialize`, or
`unlock` operation. A private, process-local proof receipt binds the original
operation ID, current verified login, issuing method/revision and runtime
epoch; copying public operation fields or looking up a pending initialization
cannot mint a grant. Initialization must be finalized after native success;
unlock must likewise be confirmed by the trusted native controller. The
calling service additionally observes a running runtime before issuance, and
data admission checks that observation independently. A resumed initialization
issues only to its fresh proof recipient. Unused issuance receipts expire five
minutes after proof consumption.

When native initialization or unlock changes the observed runtime epoch, the
trusted service completes that operation through the grant store in one
transaction. It validates the original fresh proof and old epoch, rechecks the
pinned initialization envelopes or active unlock method, refuses closed logins
and already fenced operations, records native completion at the observed epoch,
and revokes old grants and all other issuance receipts. Only the returned
process-local receipt can issue for the new epoch; its proof age does not reset.
Old streams close before completion returns. A later lock, logout or method
removal can still refuse issuance. A restart lookup cannot replace the fresh
initialization-resume proof.

The grant store and registry share one SQLite database. A single revocation
sink closes registered streams synchronously after method removal, lock or
epoch changes commit. Admission checks the active method and epoch in the
same transaction as the grant. Each attached stream also has an absolute
expiry timer; an idle connection cannot survive expiry by avoiding requests.
Logout closes that login's streams, records the closed login ID, and prevents
an already consumed proof from recreating its grant. A new Google sign-in
uses a new login ID. Global revocation records existing browser-authorizing operations in the
one-use issuance ledger as well as deleting grants, without rewriting native
operation status. A pending initialization intent stays
available for its narrowly scoped resume proof. If revocation cannot update
the store, all streams close and further access fails until restart.

## Enrollment receipt and resume

Google authentication alone cannot authorize bootstrap: an ordinary root read
may expose its cookie-signing secret and permit a forged owner/session ID.
Atomically consume the invitation and issue an independent random 32-byte
enrollment bearer in a `__Host-` cookie with Secure, HttpOnly, SameSite=Lax,
Path=/ and no Domain. Persist only its SHA-256 hash, bound to owner, stable
Google login-session ID, instance, enrollment revision and absolute expiry
of at most 12 hours. Never log the raw invitation/receipt, include it in
operation records, or back it up. This receipt is separate from a browser
access grant and never grants workspace-data access.

Before any method is active, require the receipt for every bootstrap
prepare, envelope write, candidate-test request/consumption and initialize
request/consumption. A Google session, known session ID, pending method row
or enrollment-phase flag is insufficient. A renewal is not Google-only.
Logout revokes the receipt; expiry is absolute. Gateway restart may retain
its hashed record until expiry, but discards outstanding challenges.

If the receipt is lost or expires, `resume-enrollment` permits a fresh
operation-bound proof from an already persisted pending method for that
owner, instance, enrollment revision and fixed volume commitment. This is
the only receipt-free bootstrap mutation; passkeys also require fresh UV.
It cannot upload or substitute a method. Successful proof atomically revokes
the predecessor receipt/challenges and issues a replacement bound to the
current login session, preserving all method/volume records. Concurrent
resumes cannot both commit against the same enrollment revision.

The transaction that first activates any method permanently closes bootstrap
authority and revokes all enrollment receipts/challenges. From then on,
adding recovery or another method requires fresh active-method proof bound
to the candidate, even if a UI phase still says setup is incomplete. Removing
a method, restoring an old phase flag or issuing another invitation cannot
reopen receipt-only authority. No new invitation or Google-only request may
replace the pinned owner, volume commitment or initialized keys.

Without a usable persisted method, receipt loss fails closed. Only an
explicit operator reset of backing confirmed never initialized may restart
setup for the pinned owner; it is not a remote Google-only reset endpoint.
Initialized storage remains recoverable only through an existing method or
recovery material. If initialization was interrupted, reconcile native
evidence before deciding which case applies; unknown is not empty.

## API and state

The gateway owns `/api/security/v1` before forwarding application traffic.
All endpoints below require the validated, owner-bound Google session except
invitation redemption, which instead verifies that the invited identity is
eligible, and the inert invitation handoff before sign-in. Requests have bounded
JSON schemas; secrets are never URL values.
Bootstrap mutations additionally enforce the enrollment receipt/resume
contract above; Google authentication by itself supplies no such authority.
The API need not expose separate services to implement these responsibilities.

| Route | Contract |
| --- | --- |
| `GET /state` | Return enrollment phase, minimal observed storage/runtime state, this browser's grant state and supported operations. No workspace contents or process/session names without a grant. |
| `POST /invitation/handoff` | Before Google sign-in, preserve the fragment's invitation bearer in a 15-minute Secure HttpOnly SameSite=Lax `__Host-deck_invitation` cookie after an exact-origin JSON POST. The browser clears the fragment first. This does not consume the invitation, verify eligibility or issue enrollment authority. Normal sign-in navigation needs no token in a URL or JavaScript storage. |
| `POST /invitation/redeem` | Atomically bind the eligible verified Google identity, consume the invitation and issue its independent enrollment receipt. Invitations are random 32-byte bearers, stored as hashes, single-use, expiring after 72 hours. GET/link previews never consume one; another invitation cannot replace existing owner/key records. |
| `GET /unlock-options` | Return only the method descriptors, credential IDs, envelope parameters and ciphertext needed to attempt proof for this owner. No workspace data; friendly management details require a grant. |
| `POST /methods/prepare` | Allocate an inert pending method/revision and ceremony parameters. Before first activation require the enrollment receipt; afterward require a current method-backed browser grant or fresh active-method authorization. Allocation conveys no authority to activate it; bound pending records and expire abandoned ones. |
| `PATCH /methods/{id}/label` | Name an inert pending method under that same preparation authority, before an initialization intent freezes enrollment. Change no envelope, revision or test evidence. Active-method renaming still requires a fresh bound management proof. |
| `PUT /methods/{id}/envelope` | Persist the candidate envelope and applicable WebAuthn registration result under the same preparation authority; do not activate it. Reject mutation of active/removed revisions. |
| `GET /methods/{id}/envelope` | Read the exact persisted candidate or active envelope for an owner-authorized ceremony. The fresh test reads this result, not its upload buffer. |
| `POST /challenges` | Create a bound challenge for `verify-method`, `resume-enrollment`, `initialize`, `resume-initialization`, `authorize-browser`, `unlock`, `add-method`, `replace-method`, `remove-method`, `rename-method` or `lock`. Bootstrap requests require a receipt except the scoped resume proof. Return the reserved `operationId` before submission, so a lost operation response can be observed without replaying the mutation. Resuming initialization returns its original pinned operation ID. The identifier itself conveys no authority. |
| `POST /operations` | Verify the proof plus any required WebAuthn assertion, consume the challenge, and apply/start only its bound operation. Initializing/unlocking may hand the volume secret to the controller; never persist or log it. |
| `GET /operations/{id}` | Return the owner/login-session-authorized operation's observed result or uncertain status, including a lock result after its browser grant has been revoked. Reconnection observes this ID. |
| `GET /methods` | With a current browser grant, return active/pending methods and test dates; mutations still require fresh method proof. |

Methods are `pending`, `active` or `removed`. The gateway stores a successful
candidate test against its exact envelope revision; that receipt alone grants
no browser access. A `verify-method` challenge is an explicitly scoped
exception permitting proof by that pending method. Browser code drops prior
plaintext references, rereads and decrypts the saved envelope, checks the
volume commitment, then signs. The server verifies key possession; it cannot
prove that JavaScript actually forgot a key or reran a KDF. Browser tests must
exercise this path rather than signing with the original cached key.

Initial enrollment proceeds through `awaiting-method`, `awaiting-recovery`,
`initializing` and `ready`; the independent enrollment receipt allows only
that instance's setup until first activation. Save and test an everyday method, then separately
save/reenter and test recovery for the same commitment. `initialize` requires
these receipts and a fresh proof from the tested everyday method, and hands
its recovered secret to the native controller. Verify the commitment again
before the handoff, initialize only a confirmed empty configured backing,
test the actual native mount, then activate methods, permanently close
receipt-based authority and publish ready state in one control transaction.
Interrupted initialization is reconciled from its operation and native
evidence, never repeated destructively or reset to a new owner/volume secret.

After first activation, adding/replacing a method requires both a tested candidate
and fresh active-method proof bound to the exact candidate revision and
payload. Preparation/upload alone is inert. Atomically activate the successor
and remove the predecessor only after both proofs pass. An interruption keeps
the old method usable. Guard the last active everyday method; recovery alone
does not satisfy it. Forgotten passwords can be replaced using another active
method or recovery. Recovery remains reusable until a tested replacement
commits; using it or adding a passkey does not consume it.

`authorize-browser` proves a method and mints a grant for an already-open
runtime without remounting or restarting. `unlock` additionally hands off the
secret, verifies native storage and observes runtime readiness. Storage state
is `closed/open/unknown`; runtime state is
`stopped/starting/running/stopping/unknown`. Failed runtime launch with an
open filesystem is not locked; a lost browser connection is not evidence of
either state. Fence launches and recovery before lock, revoke grants, record
intentional stops, stop observed workloads and unmount. Verify no relevant
process or mount alias remains before reporting locked. Preserve unknown or
open state on failure. ADR-0014 defines the required native qualification.

## Recovery key and kit

Generate an independent random 32-byte secret. Encode it into 52 unpadded,
MSB-first Crockford Base32 characters using
`0123456789ABCDEFGHJKMNPQRSTVWXYZ`. The check group is the first four Base32
characters of `SHA256(UTF8("deck.recovery.DK1\0") || secret32)`.
Canonical display is `DK1-` followed by thirteen four-character data groups
and the four-character check group, all separated by hyphens. The check adds
no entropy; this is a Deck checksum, not Crockford's optional mod-37 check.

Bound input to 512 characters. Remove ASCII whitespace and hyphens, uppercase,
require the `DK1` prefix and 56 suffix characters, then map `O` to `0` and
`I`/`L` to `1` in the suffix only. Reject all other alphabet characters.
Decode exactly 32 data bytes and require re-encoding equality after aliases
to reject nonzero trailing pad bits. Verify the checksum. Unknown versions
fail explicitly; a checksum failure cannot identify a specific wrong group.

Copy, download, print and import use one serializer/parser. The kit is
generated in the browser and contains its format version, stable instance
identity, configured address, recovery key and restoration instructions.
File import parses locally; it never uploads the entire file. Treat included
origins/paths as display-only or validate them against the configured instance;
never fetch or navigate to an arbitrary imported URL. Report clipboard,
download and parsing results honestly. Reentering or importing tests the
persisted recovery envelope, not just the transcription check.

The kit is not a workspace data backup. Restore requires the matching
ciphertext, native filesystem metadata and consistent envelope/public-key/
commitment control records. Bearer grants and pending challenges are not
restored. Revoked envelopes may still exist in old backups; password/method
replacement rewraps access and does not rotate the filesystem master key or
make those copies unreadable. See ADR-0014 for the separate rotation boundary.

## Public interoperability fixtures

These are deliberately public test inputs, never operational secrets.

Recovery secret hex:

```text
000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
```

Canonical recovery key:

```text
DK1-000G-40R4-0M30-E209-185G-R38E-1W81-24GK-2GAH-C5RR-34D1-P70X-3RFG-9206
```

Password input as a JavaScript string is `"  cafe\u0301 test password  "`.
Its normalized UTF-8 hex, salt hex and PBKDF2-SHA-256/600000 result hex are:

```text
2020636166c3a920746573742070617373776f72642020
202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f
d9448484791b29c6dca33763b14149a5d087da9bc19e5a5b4cc48735fa585664
```

Implementations must test malformed/oversized encodings, unsupported versions,
tampered AAD/ciphertext, wrong contexts/commitments, truncated signatures,
PRF absence, password normalization, recovery aliases/padding/checksums and
the saved-envelope path. Deployment acceptance remains the hostile test table
in ADR-0014; browser crypto vectors alone do not qualify it.

### Interrupted initialization

After the first initialization proof commits, the registry pins its durable
operation ID, everyday/recovery method revisions and envelope digests. It does
not activate methods until the native controller confirms initialization and
mount of that same volume commitment. A gateway restart discards challenges
but retains this intent. The trusted controller can retrieve it with
`PendingInitialization`; retrieving metadata grants no browser access and is
not permission to repeat an uncertain native effect.

The narrowly scoped `resume-initialization` action requires a fresh proof by
the original everyday method (and fresh required-UV WebAuthn assertion for a
passkey). It is available to the same pinned owner on a fresh verified login
without an expired enrollment receipt. It cannot substitute either method,
change the owner or commitment, create a second native intent, or activate
keys. It consumes a challenge bound to the current login and runtime epoch,
rebinds the existing operation to that epoch, and returns its original ID.
Previously issued permits from another epoch cannot finalize the operation.
The controller must observe the backing first: re-handoff is allowed only
when it proves effects have not started or the same committed volume exists;
unknown effects stay blocked for reconciliation. Finalization requires a
permit for the current epoch and a positive native observation. No operator
reset or receipt reissue bypasses this check.

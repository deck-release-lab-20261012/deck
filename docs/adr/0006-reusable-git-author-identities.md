# ADR-0006: Reusable Git author identities

- Status: Accepted; decision 4 superseded 2026-08-28 (see the note under
  that decision)
- Date: 2026-08-13
- Decision owner: Operator
- Amends: ADR-0003 decision 2 only as described below

## Context

Project setup is the sole owner of repository-local Git
author defaults. The first implementation, however, asks for an author name
and email every time a directory is registered. Projects imported from an
older Deck release have no recorded identity, so a later session launch stops
at an error with no in-context resolution. Operators who use more than one
author identity must repeatedly type the same values, and removing and
re-registering a project becomes the accidental recovery workflow.

The author name and email are non-secret attribution metadata. Reusing them is
an operator convenience, not credential sharing, authentication, signing, or a
new source-control authority boundary. A reusable value also cannot become a
live reference that silently rewrites repositories when it is edited.

## Decision

### 1. The installation stores reusable identity profiles

Deck stores reusable Git author identity profiles in the control database.
Each profile has a stable ID, validated author name and email, a monotonic
revision, and deletion state. When at least one active profile exists, exactly
one is the installation default. Creating the first profile makes it the
default. Changing the default and editing or deleting a profile are explicit
authenticated operator actions with compare-and-swap revision checks. Default
selection has its own monotonic revision so concurrent choices cannot both
claim a current base. Stale writes return the current revisions instead of
winning silently.

Deleting a profile is soft deletion. It removes the profile from future
selection but does not alter a project that previously used it. Deleting the
default requires choosing another active profile in the same operation unless
it is the last active profile.

### 2. A project records versioned setup snapshots

Selecting a profile during project setup copies its profile ID, revision,
author name, and author email into a new immutable project setup snapshot and
makes that revision current for the project. That snapshot, not the mutable
profile, is the declared value written to repository-local Git configuration.
Editing, deleting, or changing the default profile never rewrites an existing
snapshot or its repository. Applying a newer profile revision to a project is a
separate explicit setup action with the expected current project-setup revision,
and appends a new snapshot revision.

The snapshot remains attribution metadata outside the immutable confined
project policy. It grants no repository credential, signing authority, or
authentication claim. Deck never reads or writes operator-global Git
configuration.

### 3. Onboarding and project setup share one selection model

After authentication, an installation with no active identity profile presents
one onboarding step for author name and email. Saving it creates the first
profile and default. The operator can later create, edit, soft-delete, list,
and choose the default profile from settings.

The Open project flow selects an active profile and initially chooses the
default. It does not ask the operator to retype a name and email. A legacy
project without a complete setup snapshot opens the same selector when a
session is requested; successful setup retries that one requested launch once.
The project remains registered throughout. Canceling leaves it unchanged and
does not launch a session.

### 4. Repository conflicts require an explicit choice

Project setup inspects only repository-local `user.name`, `user.email`, and
`user.useConfigOnly`. If present values disagree with the selected snapshot,
Deck makes no write until the operator chooses one of these actions:

- **Keep repository identity** validates the complete repository-local name
  and email, saves or reuses that pair as a profile, and records it as the
  project's setup snapshot. Deck sets `user.useConfigOnly=true` locally if it
  was absent; a conflicting explicit value still requires replacement.
- **Replace with selected identity** writes the selected snapshot and
  `user.useConfigOnly=true` to repository-local configuration.
- **Cancel** leaves both database and repository configuration unchanged.

The resolution is transactional from the operator's perspective: a failed Git
write does not publish or select a new project snapshot. No agent, reviewer,
hook, or harness participates in this resolution or performs later validation.

**Superseded 2026-08-28.** Decision 4 no longer holds. Setup writes the
selected snapshot even when repository-local values disagree, and returns the
previous values with the response; the console states them in the sidebar,
with the command to put them back. There is no keep-or-replace round trip and
no conflict error.

The failure decision 4 guarded against is one operator overwriting an identity
they had set by hand, in their own repository, on their own machine — undone
in seconds with a single `git config --local`. A refusal, an error type, and a
modal were a worse trade than a plain report. What survives from decision 4:
setup still inspects and writes only repository-local `user.name`,
`user.email`, and `user.useConfigOnly` and never reads or exposes the
operator's global configuration; cancelling still leaves the database and the
repository unchanged; a failed Git write still does not publish or select a
new project snapshot; and no agent, reviewer, hook, or harness participates.

### 5. Existing installations upgrade without re-registration

The additive database migration groups distinct, complete author-name/email
pairs already stored on projects into profiles and associates every matching
project with the corresponding revision-1 snapshot. The profile associated
with the most recently used active project becomes the default, with a stable
ID tie-breaker. Projects with empty or incomplete legacy values remain
registered and enter the in-context setup flow before their next session.

The migration never reads or modifies a repository or any Git configuration.
For one compatibility release, the existing project-create name/email request
and project Git-identity setup endpoint remain accepted. They resolve through
the same profile-and-snapshot service as the new profile-ID requests, so old
clients do not create a second authority path. Upgrade tests start from the
released pre-profile schema and exercise both complete and incomplete legacy
projects.

## Consequences

- Operators enter common attribution data once and can deliberately manage
  multiple identities.
- Existing projects no longer require removal and re-registration to become
  launchable.
- Profile edits are safe for existing repositories because projects retain
  explicit snapshots.
- The database and API gain revisioned identity resources, while repository
  configuration remains project-local and setup-owned under the project setup contract.
- Settings and project setup must expose conflicts as operator choices rather
  than silently adopting or overwriting repository state.
  Superseded 2026-08-28: setup overwrites and reports the previous values
  rather than asking, so the operator learns what changed instead of being
  interrupted before it does.

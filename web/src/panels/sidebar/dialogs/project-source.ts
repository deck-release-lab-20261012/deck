// The two markup phases of the project-source flow (comp desktop-r52,
// mobile-r9): the chooser that asks where a project comes from, and the
// GitHub repository picker it leads to. Both are pure renderers — the
// parent model owns filtering, loading and outcomes, and hands over the
// exact list to draw; these functions never filter, fetch or infer.
import { escapeHtml } from "../sidebar.ts";
import { DIALOG_BODY, PRIMARY_MD_BUTTON, SECONDARY_SM_BUTTON, SECONDARY_SM_TYPE, SELECT_FIELD, dialogHead, selectShellHtml } from "../../../ui/controls.ts";
import { lucideIcon, type IconName } from "../../../ui/icons.ts";

export interface GitHubRepositorySummary {
  id: number;
  full_name: string;
  owner: string;
  private: boolean;
  description: string;
}

export interface GitHubRepositoryPickerState {
  account: string;
  loading: boolean;
  checking: boolean;
  outcome: string;
  query: string;
  owner: string;
  repositories: readonly GitHubRepositorySummary[];
  owners: readonly string[];
  // Keyed by lowercased full_name, so a repository whose casing changed on
  // GitHub still matches the project already in the sidebar.
  imported: ReadonlyMap<string, { id: string; name: string }>;
  complete: boolean;
}

// The sm ghost has no controls.ts recipe yet; compose it from the shared sm
// type so the tutorial and Open actions read like the other 28px controls.
const GHOST_SM_BUTTON =
  `flex h-7 flex-none items-center gap-1 rounded-control-sm border border-transparent px-2.5 ${SECONDARY_SM_TYPE} text-text-secondary transition-colors hover:bg-wash-hover hover:text-text-primary disabled:opacity-45`;

const ICON_BUTTON_SM =
  "grid h-7 w-7 flex-none place-items-center rounded-control-sm text-text-tertiary transition-colors hover:bg-wash-hover hover:text-text-primary focus-visible:bg-wash-hover pointer-coarse:h-10 pointer-coarse:w-10";

function sourceCard(source: string, icon: IconName, label: string, caption: string): string {
  return `<button type="button" data-project-source="${source}" class="flex flex-col items-start gap-2.5 rounded-control border border-border bg-transparent p-3.5 text-left transition-colors hover:bg-wash-hover focus-visible:bg-wash-hover">
    <span aria-hidden="true" class="inline-flex text-text-secondary">${lucideIcon(icon, 18)}</span>
    <span class="flex min-w-0 flex-col gap-0.5">
      <span class="text-body-sm font-medium text-text-primary">${label}</span>
      <span class="text-caption leading-[1.4] text-text-secondary">${caption}</span>
    </span>
  </button>`;
}

// The chooser keeps the optional tutorial action below the source cards.
export function addProjectChooserHtml(opts: { tutorialAvailable: boolean; message?: string }): string {
  return `
    <div data-sidebar-modal-scrim class="scrim" style="z-index:90">
      <div data-project-source-dialog data-add-project data-phone-fullscreen tabindex="-1" role="dialog" aria-modal="true" aria-label="Add project" class="dialog outline-none">
        ${dialogHead("Add project", { label: "Close", attr: "data-project-cancel" })}
        ${DIALOG_BODY(`
          <div class="grid gap-2 sm:grid-cols-3">
            ${sourceCard("github", "download", "GitHub", "Clone from your GitHub repositories.")}
            ${sourceCard("local", "folder", "Local folder", "On this machine, or a new one.")}
            ${sourceCard("url", "plus", "Repository URL", "Any Git host.")}
          </div>
          ${opts.tutorialAvailable ? `<p class="m-0 flex flex-wrap items-center gap-2 text-caption text-text-tertiary">New to Deck?
            <button type="button" data-project-source="tutorial" class="${GHOST_SM_BUTTON}">Start with the tutorial project</button>
          </p>` : ""}
          ${opts.message ? `<p role="status" class="m-0 text-caption text-text-secondary">${escapeHtml(opts.message)}</p>` : ""}
        `)}
      </div>
    </div>`;
}

interface OutcomeCopy {
  icon: IconName;
  title: string;
  body: (account: string) => string;
  action: string;
}

// Plain-copy outcome table. Every entry says what GitHub actually reported
// and what the operator can do; none claims more than Deck knows — a
// repository that never lists is not proof an owner withheld approval, and
// access Deck cannot see is access Deck cannot deny.
const OUTCOME_COPY: Record<string, OutcomeCopy> = {
  "rate-limited": {
    icon: "triangle-alert",
    title: "GitHub is rate limiting this machine",
    body: () => "Too many requests went to GitHub just now. Wait a few minutes, then check again.",
    action: "Check again",
  },
  "sso-required": {
    icon: "lock",
    title: "An organization requires single sign-on",
    body: () => "A repository owner enforces SAML single sign-on. Authorize the GitHub CLI for that organization on GitHub, then check again.",
    action: "Check again",
  },
  forbidden: {
    icon: "lock",
    title: "GitHub refused access",
    body: () => "The GitHub API refused this request. Check the account’s permissions and organization SSO requirements. This response does not establish whether organization approval is needed.",
    action: "Check again",
  },
  "account-changed": {
    icon: "info",
    title: "The connected account changed",
    body: (account) => `GitHub now answers as a different account than the one this list belongs to. Refresh to load the repositories ${account === "" ? "of the current account" : `of @${account}`}.`,
    action: "Refresh",
  },
  unavailable: {
    icon: "triangle-alert",
    title: "GitHub access could not be confirmed",
    body: () => "The GitHub CLI request could not be completed. Check the connection and CLI setup, then try again.",
    action: "Try again",
  },
  "not-found": {
    icon: "info",
    title: "A listed repository is no longer visible",
    body: () => "GitHub reports it does not exist or is no longer visible to the connected account. It may have been renamed, moved, or deleted — a missing repository is not proof that an owner withheld approval.",
    action: "Check again",
  },
  limit: {
    icon: "info",
    title: "The repository list exceeded Deck’s limits",
    body: () => "Deck could not finish listing this account within its time or size limits. Search would be incomplete. Try refreshing, or use Repository URL to import a known repository.",
    action: "Check again",
  },
  malformed: {
    icon: "triangle-alert",
    title: "GitHub's answer could not be read",
    body: () => "The repository list from the GitHub CLI was not in the shape Deck expects. Try again; if it repeats, check the GitHub CLI on this machine.",
    action: "Try again",
  },
};

const OUTCOME_FALLBACK: OutcomeCopy = {
  icon: "triangle-alert",
  title: "The repository list could not be loaded",
  body: () => "GitHub gave an answer Deck does not recognise. Try again; if it repeats, check the GitHub CLI on this machine.",
  action: "Try again",
};

function repositoryRow(repo: GitHubRepositorySummary, open: { id: string; name: string } | undefined, selectionDisabled: boolean): string {
  const visibility = repo.private
    ? `<span class="inline-flex flex-none items-center gap-1 text-caption text-text-tertiary"><span aria-hidden="true" class="inline-flex">${lucideIcon("lock", 11)}</span>Private</span>`
    : `<span class="flex-none text-caption text-text-tertiary">Public</span>`;
  const action = open !== undefined
    ? `<button type="button" data-github-repo-open="${escapeHtml(open.id)}" aria-label="Open ${escapeHtml(repo.full_name)}" class="${GHOST_SM_BUTTON}">Open</button>`
    : `<button type="button" data-github-repo-select="${repo.id}" aria-label="Import ${escapeHtml(repo.full_name)}" ${selectionDisabled ? "disabled" : ""} class="${SECONDARY_SM_BUTTON} disabled:opacity-45">Import</button>`;
  return `<div role="listitem" class="flex items-center gap-3 border-t border-border px-3.5 py-2.5 first:border-t-0">
    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span class="flex min-w-0 items-center gap-2">
        <span data-mono="body-sm" class="truncate text-text-primary">${escapeHtml(repo.full_name)}</span>
        ${visibility}
      </span>
      ${open !== undefined
        ? `<span class="truncate text-caption text-text-tertiary">In the sidebar as ${escapeHtml(open.name)}</span>`
        : repo.description === ""
          ? ""
          : `<span class="truncate text-caption text-text-tertiary">${escapeHtml(repo.description)}</span>`}
    </span>
    ${action}
  </div>`;
}

// The repository picker (comp desktop-r52 ghList, mobile-r9 screen 17). The
// parent model filters by query and owner before setting state, so every
// repository handed in is drawn. Loading never traps the dialog: Back and
// Close stay live, and nothing else moves on its own.
export function githubRepositoryPickerHtml(state: GitHubRepositoryPickerState): string {
  const busy = state.loading || state.checking;
  const selectionDisabled = busy;
  const account = escapeHtml(state.account);

  const head = `
    <header class="dialog-head">
      <button type="button" data-project-source="choose" aria-label="Back" class="${ICON_BUTTON_SM}">${lucideIcon("chevron-left", 16)}</button>
      <h2 class="dialog-title dialog-title-prompt">Import from GitHub</h2>
      <button type="button" data-project-cancel aria-label="Close" class="ml-auto ${ICON_BUTTON_SM}">${lucideIcon("x", 16)}</button>
    </header>`;

  if (["authentication-required", "no-account", "auth-issue", "missing-cli"].includes(state.outcome)) {
    return `
      <div data-sidebar-modal-scrim class="scrim" style="z-index:90">
        <div data-github-picker data-phone-fullscreen tabindex="-1" role="dialog" aria-modal="true" aria-label="Import from GitHub" class="dialog outline-none">
          ${head}
          ${DIALOG_BODY(`
            <p class="m-0 text-body-sm leading-[1.55] text-text-secondary">Connect a GitHub account to list its repositories here. Deck signs in through the GitHub CLI on this machine, with access determined by that account’s permissions. Git authentication is separate from commit author identity.</p>
            <div class="flex justify-end gap-2">
              <button type="button" data-github-repo-refresh class="${SECONDARY_SM_BUTTON}">Refresh connection</button>
              <button type="button" data-github-repo-connect class="${PRIMARY_MD_BUTTON}">Connect GitHub</button>
            </div>
          `)}
        </div>
      </div>`;
  }

  const accountRow = state.account === "" ? "" : `
    <div class="flex items-center gap-2.5">
      <span class="min-w-0 flex-1 truncate text-body-sm text-text-secondary">Connected as <span class="font-medium text-text-primary">@${account}</span></span>
      <button type="button" data-github-repo-refresh ${busy ? "disabled" : ""} class="${SECONDARY_SM_BUTTON} disabled:opacity-45"><span aria-hidden="true" class="flex-none">${lucideIcon("refresh-cw", 14)}</span>Refresh</button>
    </div>`;

  const ownerSelect = selectShellHtml(`<select data-github-repo-owner aria-label="Repository owner"
      class="${SELECT_FIELD} font-input h-9 w-full rounded-control border border-border-strong bg-surface-card pl-2 text-body-sm text-text-primary">
      <option value="" ${state.owner === "" ? "selected" : ""}>All owners</option>
      ${state.owners.map((owner) => `<option value="${escapeHtml(owner)}" ${owner === state.owner ? "selected" : ""}>${escapeHtml(owner)}</option>`).join("")}
    </select>`);

  const controls = `
    <div class="flex flex-col gap-2 sm:flex-row">
      <div class="flex-none sm:w-40">${ownerSelect}</div>
      <span class="relative flex min-w-0 flex-1 items-center">
        <span aria-hidden="true" class="pointer-events-none absolute left-[14px] flex text-text-tertiary">${lucideIcon("search", 15)}</span>
        <input type="search" data-github-repo-search aria-label="Search repositories" placeholder="Search repositories" value="${escapeHtml(state.query)}" autocomplete="off" spellcheck="false"
          class="font-input caret-accent h-9 w-full rounded-control border border-border-strong bg-surface-card pl-[37px] pr-(--field-px) text-[16px] text-text-primary sm:text-body-sm">
      </span>
    </div>`;

  const spinner = `<span aria-hidden="true" class="block h-[11px] w-[11px] flex-none animate-row-spinner rounded-circle border-[1.5px] border-border-strong border-t-text-secondary"></span>`;
  const status = state.loading
    ? `<div role="status" class="flex items-center gap-2.5 rounded-card border border-border px-3.5 py-3 text-caption text-text-secondary">${spinner}Loading repositories from GitHub…</div>`
    : state.checking
      ? `<div role="status" class="flex items-center gap-2.5 rounded-card border border-border px-3.5 py-3 text-caption text-text-secondary">${spinner}Checking access with GitHub…</div>`
      : "";

  const copy = OUTCOME_COPY[state.outcome] ?? (["", "ok"].includes(state.outcome) ? undefined : OUTCOME_FALLBACK);
  const outcomeCard = copy === undefined ? "" : `
    <div class="flex flex-col gap-2.5 rounded-card border border-border px-3.5 py-3">
      <span class="flex gap-2.5">
        <span aria-hidden="true" class="mt-px flex-none text-text-tertiary">${lucideIcon(copy.icon, 15)}</span>
        <span class="flex min-w-0 flex-col gap-1">
          <span class="text-body-sm font-medium text-text-primary">${copy.title}</span>
          <span class="text-caption leading-[1.5] text-text-secondary">${copy.body(account)}</span>
        </span>
      </span>
      <span class="flex justify-end"><button type="button" data-github-repo-refresh ${busy ? "disabled" : ""} class="${SECONDARY_SM_BUTTON} disabled:opacity-45">${copy.action}</button></span>
    </div>`;

  const list = state.repositories.length === 0 ? "" : `
    <div role="list" aria-label="GitHub repositories" class="max-h-80 overflow-y-auto rounded-card border border-border">
      ${state.repositories.map((repo) => repositoryRow(repo, state.imported.get(repo.full_name.toLowerCase()), selectionDisabled)).join("")}
    </div>`;

  let empty = "";
  if (!busy && state.complete && ["", "ok"].includes(state.outcome) && state.repositories.length === 0) {
    if (state.query === "") {
      const scope = state.owner === "" ? `@${account}` : `${escapeHtml(state.owner)}`;
      empty = `
        <div class="flex flex-col gap-1 rounded-card border border-border px-3.5 py-5 text-center">
          <span class="text-body-sm font-medium text-text-primary">No repositories to show</span>
          <p class="m-0 text-caption leading-[1.5] text-text-secondary">GitHub listed no repositories for ${scope}. Check that the active account can access the repository. A missing repository does not establish why it is unavailable.</p>
        </div>`;
    } else {
      empty = `
        <div class="flex flex-col gap-1 rounded-card border border-border px-3.5 py-5 text-center">
          <span class="text-body-sm font-medium text-text-primary">Nothing matches “${escapeHtml(state.query)}”</span>
          <p class="m-0 text-caption leading-[1.5] text-text-secondary">Search covers only the repositories GitHub listed. A repository Deck could not list may still exist — and one that does not show here is not proof that an owner withheld approval.</p>
        </div>`;
    }
  }

  return `
    <div data-sidebar-modal-scrim class="scrim" style="z-index:90">
      <div data-github-picker data-phone-fullscreen tabindex="-1" role="dialog" aria-modal="true" aria-label="Import from GitHub" class="dialog outline-none">
        ${head}
        ${DIALOG_BODY(`<p class="m-0 text-caption text-text-tertiary">Import GitHub repositories, not GitHub Projects boards.</p>${accountRow}${controls}${status}${outcomeCard}${list}${empty}`)}
      </div>
    </div>`;
}

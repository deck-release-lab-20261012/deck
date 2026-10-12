import type { GitIdentityProfile, Project } from "../../../api/client.ts";
import { escapeHtml } from "../sidebar.ts";
import { providerDisplayName } from "../../../ui/session-identity.ts";
import { DIALOG_BODY, DIALOG_FOOT, dialogHead, SELECT_FIELD, selectShellHtml } from "../../../ui/controls.ts";
import * as hints from "../../../lib/hints.ts";

export interface ProjectGitIdentitySetupState {
  project: Project | undefined;
  retryProvider: string | null;
  profiles: readonly GitIdentityProfile[];
  selected: GitIdentityProfile | null;
  busy: boolean;
  error: string | null;
}

export function projectGitIdentitySetupHtml(state: ProjectGitIdentitySetupState): string {
    const { project, profiles, selected } = state;
    return `
      <div data-sidebar-modal-scrim class="scrim" style="z-index:90">
        <div data-project-git-identity role="dialog" aria-modal="true" aria-label="Choose git identity" class="dialog">
          ${dialogHead("Choose git identity", null)}
          ${DIALOG_BODY(`
            <p class="-mt-1 text-body-sm text-text-secondary">${project?.git_identity_setup_revision === 0 ? "This project needs a git identity before a session can start." : `Choose the author identity to apply to ${escapeHtml(project?.name ?? "this project")}.`}</p>
            ${state.retryProvider === null ? "" : `<p class="rounded-control bg-wash-selected px-3 py-2 text-caption text-text-secondary">Deck will retry the requested ${escapeHtml(providerDisplayName(state.retryProvider))} session once after setup succeeds.</p>`}
            <label class="block">
              <span class="font-label text-[13px] text-text-secondary">Git identity</span>
              ${selectShellHtml(`<select data-project-identity-profile data-hint="${hints.CHOOSE_GIT_IDENTITY_FOR_PROJECT}" class="${SELECT_FIELD} font-input h-10 w-full rounded-control border border-border-strong bg-surface-card pl-2 text-body-sm text-text-primary">
                ${profiles.map((profile) => `<option value="${escapeHtml(profile.id)}" ${profile.id === selected?.id ? "selected" : ""}>${escapeHtml(profile.name)} — ${escapeHtml(profile.email)}</option>`).join("")}
              </select>`, "mt-1")}
              <p class="mt-1.5 text-caption text-text-tertiary">Writes to this repo's local git config, replacing any values already there.</p>
            </label>
            ${state.error ? `<div class="rounded-control bg-error-tint px-3 py-2 text-caption text-error-on-tint">${escapeHtml(state.error)}</div>` : ""}
          `)}
          ${DIALOG_FOOT(`
            <button type="button" data-project-identity-cancel ${state.busy ? "disabled" : ""} data-hint="${hints.CANCEL_CHOOSING_IDENTITY}" class="h-9 rounded-control border border-border bg-surface-card px-3 text-body-sm text-text-primary hover:bg-wash-hover pointer-coarse:min-h-11">Cancel</button>
            <button type="button" data-project-identity-save ${selected === null || state.busy ? "disabled" : ""} data-hint="${hints.APPLY_IDENTITY_TO_PROJECT}" class="h-9 rounded-control bg-accent px-4 text-body-sm font-medium text-text-on-accent hover:bg-accent-hover disabled:opacity-45 pointer-coarse:min-h-11">Apply identity</button>
          `)}
        </div>
      </div>`;
}

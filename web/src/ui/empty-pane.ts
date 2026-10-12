// The session pane's empty states (comp desktop-r16). `no-session` is a
// project in context with nothing open; `no-project` is a console whose
// registry read succeeded and found nothing; `unread` is a registry no
// successful read has settled yet — a failed read is not an empty
// database, so it never borrows the no-project copy or its actions.
// The states share one anatomy — icon, small-caps title, one
// short body line, one primary action — so they read as one family, and
// all sit on the page surface rather than the terminal ground: this is
// the app speaking, not output from a session that is not running, so
// nothing here is mono.
import { escapeHtml } from "../lib/escape.ts";
import { lucideIcon, type IconName } from "./icons.ts";
import { panelTriggerHtml, type PanelTriggerSurface } from "./panel-trigger.ts";
import { projectIdentityHtml } from "./terminal-identity.ts";
import * as hints from "../lib/hints.ts";

export type EmptyPane = "off" | "no-session" | "no-project" | "unread";

// The empty titlebar's right side: the two docked-panel triggers and the
// account menu, in the exact classes the session chrome uses, so an empty
// pane never dresses itself in controls a session would not carry.
export function titlebarRightHtml(
  surface: PanelTriggerSurface,
  options: {
    panels: boolean;
    filesPressed?: boolean;
    tasksPressed?: boolean;
    sessions?: boolean;
    // chats renders the Chats trigger: only a session has an agent to
    // watch, so the empty pane never carries it.
    chats?: { pressed?: boolean; unseen?: boolean; hint?: string };
  },
): string {
  const more = surface === "live" ? "data-live-more" : "data-titlebar-more";
  const anchor = surface === "live" ? "data-live-more-anchor" : "data-titlebar-more-anchor";
  const sessions = options.panels && options.sessions
    ? `<button data-${surface}-sessions aria-label="Sessions" data-hint="${hints.OPEN_SESSION_LIST}"
        class="grid h-7 w-7 flex-none place-items-center rounded-control-sm text-text-secondary transition-colors hover:bg-field hover:text-text-primary md:hidden max-md:h-11 max-md:w-11">
        ${lucideIcon("layers", 18)}
      </button>`
    : "";
  const panels = options.panels
    ? `<span data-desktop-panels class="inline-flex items-center gap-(--space-4)">${panelTriggerHtml(surface, "files", { pressed: options.filesPressed })}
      ${panelTriggerHtml(surface, "tasks", { pressed: options.tasksPressed })}
      ${options.chats ? panelTriggerHtml(surface, "chats", options.chats) : ""}</span>
      <button data-${surface}-panels data-mobile-panels data-hint="${options.chats ? hints.OPEN_PANELS : hints.OPEN_PROJECT_PANELS}" aria-label="Panels" aria-haspopup="menu" aria-expanded="false" data-unseen="${options.chats?.unseen ?? false}" class="grid h-11 w-11 flex-none place-items-center rounded-control-sm text-text-secondary hover:bg-field">${lucideIcon("layout-panel-left", 18)}</button>`
    : "";
  // The shared cluster owns spacing and the titlebar's right edge.
  return `<span data-titlebar-actions class="ml-auto inline-flex flex-none items-center gap-(--space-4)">${sessions}${panels}
    <span class="relative inline-flex" ${anchor}>
      <button ${more} aria-label="Settings" data-hint="${hints.OPEN_TERMINAL_IDENTITY_ACCOUNT_SETTINGS}"
        class="grid h-7 w-7 flex-none place-items-center rounded-control-sm text-text-secondary transition-colors hover:bg-field hover:text-text-primary max-md:h-11 max-md:w-11">${settingsGlyph()}</button>
    </span></span>`;
}

// The titlebar an empty pane carries. `no-session` keeps the session
// chrome's whole shape with the project in the identity slot; every
// other state sheds the identity AND the panel triggers — Files and
// Tasks have no readable project to draw from, and a populated chrome
// above the pane would promise panels that cannot read anything. Only
// the account menu stays.
export function emptyTitlebarHtml(
  surface: PanelTriggerSurface,
  state: {
    kind: Exclude<EmptyPane, "off">;
    project: { name: string; tint: string | null } | null;
    filesPressed?: boolean;
    tasksPressed?: boolean;
    sessions?: boolean;
  },
): string {
  const identity = state.kind === "no-session" && state.project !== null
    ? projectIdentityHtml(state.project, state.project.tint)
    : "";
  return `${identity}
    ${titlebarRightHtml(surface, {
      panels: state.kind === "no-session",
      filesPressed: state.filesPressed,
      tasksPressed: state.tasksPressed,
      sessions: state.sessions ?? (state.kind === "no-session"),
    })}`;
}

export function emptyPaneHtml(state: {
  kind: Exclude<EmptyPane, "off">;
  projectName: string | null;
  error?: string;
}): string {
  const title = state.kind === "no-session"
    ? "No session open"
    : state.kind === "unread" ? "Projects unavailable" : "No projects yet";
  const icon: IconName = state.kind === "no-session"
    ? "layers"
    : state.kind === "unread" ? "triangle-alert" : "folder";
  const action = state.kind === "no-session" ? "New session" : "Add project";
  const actionHint = state.kind === "no-session" && state.projectName !== null
    ? hints.projectNewSession(state.projectName)
    : hints.ADD_WORKSPACE_DIRECTORY_AS_PROJECT;
  const error = state.error ?? "";
  const failed = error !== "";
  // The body names the project in context so the sentence and the button
  // always agree about what gets created; a failed refresh that kept the
  // last-known groups replaces the copy with the error rather than
  // stacking a second explanation under it.
  const body = failed
    ? escapeHtml(error)
    : state.kind === "no-session"
      ? `Pick a session from the side panel, or start a new one in <em>${escapeHtml(state.projectName ?? "")}</em>.`
      : state.kind === "unread"
        ? "The project list has not loaded yet."
        : "Point Deck at a directory, an existing repository, or a repository to clone.";
  const bodyTone = failed ? "text-error" : "text-text-tertiary";
  // `unread` renders no action: a create button over a registry nobody
  // has read offers onboarding against a database whose state is
  // unknown, which is the no-project claim this state must not make.
  const actionHtml = state.kind === "unread"
    ? ""
    : `<button type="button" data-empty-action data-hint="${escapeHtml(actionHint)}"
          class="mt-(--space-2) h-9 rounded-control bg-accent px-3 text-body-sm font-medium text-text-on-accent transition-colors hover:bg-accent-hover pointer-coarse:min-h-11 focus-visible:bg-wash-hover">${action}</button>`;
  return `
    <div data-empty-pane="${state.kind}" class="grid h-full place-items-center px-6 pb-[7%] text-center font-ui font-normal tracking-normal">
      <!-- Optical, not geometric, centring: a block held at the pane's
           exact middle sits mid-void in a tall window and reads as still
           loading, so the bottom padding lifts the composition's centre
           above the pane's. -->
      <div class="flex flex-col items-center gap-(--space-3)">
        <span aria-hidden="true" class="text-text-tertiary">${lucideIcon(icon, 20)}</span>
        <h2 data-empty-title class="text-title-3 font-title-caps text-text-primary">${title}</h2>
        <p data-empty-body class="max-w-[44ch] text-body-sm ${bodyTone}">${body}</p>
        ${actionHtml}
      </div>
    </div>`;
}

// The global settings trigger uses the shared cogwheel.
// Exported because both the live titlebar and the preview render it
// through titlebarRightHtml, and a local copy in each is how the two
// drift.
export function settingsGlyph(): string {
  return lucideIcon("settings", 18);
}

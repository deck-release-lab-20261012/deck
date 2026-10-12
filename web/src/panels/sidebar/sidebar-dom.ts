// The sidebar's DOM shell: renders a SidebarModel into the
// workspace frame and forwards its events. All state lives in the model
// (and ultimately on the server); this file only draws and listens. The
// shell matches the Claude Design artifact: a "noisefloor" wordmark with a
// collapse control, a PROJECTS list with session rows (each carrying an
// inline new-session +), and centered Open Project / folder-picker modals
// mounted in the workspace's modal region.
import { providerDisplayName, providerTileClass, sessionColorStyle, sessionTileColorStyle } from "../../ui/session-identity.ts";
import { effectiveProjectTint, operatorProjectColorKey } from "../../lib/session-colors.ts";
import {
  escapeHtml,
  modKeyLabel,
  sessionMetaHtml,
  type ChatMark,
  startsCollapsed,
  autoDescendPath,
  dismissOnSelect,
  MOBILE_QUERY,
  type ProjectWithSessions,
  type SidebarModel,
} from "./sidebar.ts";
import type {
  CloneJob,
  Inspection,
  GitIdentityProfile,
  Project,
  ProjectDirectoryListing,
  SessionSummary,
  SidebarLayout,
} from "../../api/client.ts";
import {
  confirmsBeforeClose,
  projectsMenuHtml,
  rowMenuHtml,
  projectMoveHints,
  projectPreviewMenuHtml,
  type ProjectMove,
  type ProjectRowMenuState,
  type RowMenuKind,
} from "../../app/session-menu.ts";
import { openProjectPreview } from "../../app/project-preview.ts";
import { ProjectPreviewSettingsDialog, ProjectPreviewObservations } from "../../app/project-preview-settings.ts";
import { SessionSwipeGesture } from "./session-swipe.ts";
import { lucideIcon } from "../../ui/icons.ts";
import { activateDialog, activateMenu } from "../../ui/dialog-focus.ts";
import * as hints from "../../lib/hints.ts";
import {
  newSessionDialogTarget,
  newSessionModalHtml,
} from "./dialogs/new-session.ts";
import { removeConfirmModalHtml } from "./dialogs/remove-session.ts";
import { removeProjectConfirmModalHtml } from "./dialogs/remove-project.ts";
import { gitIdentityOnboardingHtml, gitIdentitySettingsHtml } from "./dialogs/git-identity.ts";
import { projectGitIdentitySetupHtml } from "./dialogs/project-git-identity.ts";
import { addProjectModalHtml, addProjectView, type SidebarProjectRef } from "./dialogs/add-project.ts";
import { addProjectChooserHtml, githubRepositoryPickerHtml } from "./dialogs/project-source.ts";
import { HttpGitHubConnectClient } from "../../github-connect/client.ts";
import { HttpGitHubRepositoriesClient, githubRemoteIdentity, type GitHubRepository } from "../../github-repositories/client.ts";
import { GitHubRepositoriesModel } from "../../github-repositories/model.ts";
import { directoryPickerHtml } from "./dialogs/directory-picker.ts";
import { pinnedOrder, rankHarnesses } from "./harness-ranking.ts";

export function reconcileCreatedProjectExpansion(
  expanded: Set<string>,
  pendingProjectID: string | null,
  groups: ProjectWithSessions[],
): string | null {
  if (pendingProjectID === null || !groups.some((g) => g.project.id === pendingProjectID)) {
    return pendingProjectID;
  }
  expanded.add(pendingProjectID);
  return null;
}

// sessionActionControlsHtml is the session row's whole trailing edge
// (comp .wssess): the age tick, which fades out on hover, and the ONE
// ellipsis control that fades in over it — .session-menu-trigger in
// app.css owns that reveal. The button is 28px (--control-h-sm) with a
// colour-only hover: the comp gives row icon buttons no wash, so the
// glyph just steps to primary. Absolute placement is what keeps the
// row's height fixed whether the control is hidden or revealed.
//
// The evidence cell is fit-content flush with the row's content edge,
// where the comp's .wssess-meta sits: a min-width or negative margin
// here lands the tick right of the comp and breaks the pending row's
// 0px parity. The tick's line box is normal — the comp sizes the tick
// but sets no line-height, so text-micro's 1.3 ratio (a 14.3px line
// box) must not apply. Its colour follows the row's selected state
// (comp tickColor): secondary on the selected row, tertiary on every
// other — the same promotion the row's name gets.
//
// The trigger overlays the tick, so the two move together: the tick is
// hidden exactly while the trigger is shown, and visible again the moment
// it hides. Both answer hover and keyboard focus — on the row, which
// carries the list's roving tabindex, or on the trigger inside it. A mouse
// click on the row is neither, and leaves the tick where it is.
//
// The tick is the interface face, not mono. Mono is the machine's voice —
// the terminal's own output — and an elapsed time the app computes and
// prints about itself is the app speaking, however evidence-like it reads.
// The size stays --type-micro-size: the mono register's x-height
// correction exists to shrink mono into a micro line box, and an
// interface face at micro needs no such correction.
export function sessionActionControlsHtml(sessionID: string, metaHtml: string, selected: boolean): string {
  const id = escapeHtml(sessionID);
  return `
    <span data-session-meta="${id}" class="session-evidence flex flex-none items-center text-micro font-medium leading-[normal] ${selected ? "text-text-secondary" : "text-text-tertiary"} transition-opacity duration-[110ms] ease-[ease] group-focus-visible:opacity-0 group-has-focus-visible:opacity-0 group-hover:opacity-0">${metaHtml}</span>
    <span class="session-menu-trigger">
      <button type="button" data-session-menu="${id}" aria-label="Session menu" data-hint="${hints.RENAME_RECOLOR_CLOSE_SESSION}" aria-haspopup="menu" aria-expanded="false"
        class="grid h-7 w-7 place-items-center rounded-control-sm text-text-tertiary transition-colors hover:text-text-primary pointer-coarse:h-10 pointer-coarse:w-10">${ellipsisGlyph()}</button>
    </span>`;
}


// The project row's disclosure column (handoff §7): a 13px mono
// column carrying ▾/▸, tinted with the project color when one is set and
// falling back to the secondary text voice. The tint is inline because it
// is per-project data, not a token decision.
export function projectChevronHtml(
  expanded: boolean,
  color: string | null | undefined,
): string {
  const tint = color === null || color === undefined || color === ""
    ? ""
    : ` style="color:${escapeHtml(color)}"`;
  return `<span aria-hidden="true"${tint} class="w-[13px] flex-none font-mono text-[length:min(var(--type-mono-size),calc(13.5px*var(--type-mono-xh-ratio)))] leading-none text-text-secondary">${expanded ? "▾" : "▸"}</span>`;
}

// The sessions-list rail (handoff §7): a 2px border-left indenting
// every session under an open project, in the project colour when one is
// set and the border voice when not. The tint is inline because it is
// per-project data, not a token decision; the width and fallback live in
// the .session-rail rule.
export function sessionRailStyle(color: string | null | undefined): string {
  const tint = color === null || color === undefined || color === ""
    ? ""
    : ` style="border-left-color:${escapeHtml(color)}"`;
  return tint;
}

// The sessions-list rail container (handoff §7): a 2px border-left
// indents every session under an open project. The 11px left margin and
// 8px left padding are hand-tuned in the comp; rounding them to the 4px
// ramp shifts every row 2px right and narrows it by the same amount.
// `bare` sheds the 2px rule for a rail with nothing selected (comp
// desktop-r16): the rule marks an open session's rail, and painted over
// rows nobody chose it reads as a selection the pane does not show.
// The leading status cell's content (comp mobile-r8 screen 02). The
// spinner keeps the streaming label: at the narrow scope this cell is the
// only visible streaming signal, and the trailing spinner is display:none
// there — hidden from readers too — so an unlabeled leading cell would
// leave a phone reader without the state a desktop reader hears.
export function sessionStatusCellHtml(streaming: boolean, attention = false): string {
  if (streaming) {
    return `<span role="img" aria-label="output streaming" class="block h-[11px] w-[11px] animate-row-spinner rounded-circle border-[1.5px] border-border-strong border-t-text-secondary"></span>`;
  }
  // The comp's 7px warning dot (mobile-r8 screen 02): a listed session the
  // server cannot yet verify as running. Content-free by design. The edge
  // patch never erases it: setStreaming returns before this cell for any
  // presentation other than running, so only renders write attention rows.
  if (attention) {
    return `<span role="img" aria-label="needs attention" class="block h-[7px] w-[7px] rounded-full bg-warning"></span>`;
  }
  return "";
}

// The rail carries no in-group + New session chrome of its own: the
// empty-rail row (emptyRailNewSessionHtml, rendered by the caller inside
// childrenHtml) is the single creation affordance a group without
// sessions shows, on every form factor. A populated group offers none in
// its rail — the project row's own + (desktop) and the sheet's bottom
// bar (phone) are the ways in.
export function sessionRailContainerHtml(
  projectID: string,
  color: string | null | undefined,
  expanded: boolean,
  childrenHtml: string,
  bare = false,
): string {
  return `<ul id="sessions-${escapeHtml(projectID)}" draggable="false" class="session-rail${bare ? " session-rail-bare" : ""} mb-1.5 ml-[11px] mt-0.5 flex flex-col gap-px pl-2"${sessionRailStyle(color)} ${expanded ? "" : "hidden"}>${childrenHtml}</ul>`;
}

// moveProjectRelative is the pure core of the menu-driven project reorder:
// it returns the order with `from` removed and reinserted on the named side
// of `target`. An unknown target appends, so a move against a row that left
// the list (a concurrent refresh) still settles somewhere visible. Project
// rows are never draggable — the row menu is the only way to move one.
export function moveProjectRelative(
  ids: readonly string[],
  from: string,
  target: string,
  after: boolean,
): string[] {
  const next = ids.filter((id) => id !== from);
  const index = next.indexOf(target);
  if (index === -1) next.push(from);
  else next.splice(after ? index + 1 : index, 0, from);
  return next;
}

// moveProjectToTop is the long move: the project leaves its place and the
// rows above it each shift down one. A project already first, or one not in
// the list, changes nothing.
export function moveProjectToTop(ids: readonly string[], projectID: string): string[] {
  const index = ids.indexOf(projectID);
  if (index <= 0) return [...ids];
  return [projectID, ...ids.slice(0, index), ...ids.slice(index + 1)];
}

export function moveProjectOneStep(
  ids: readonly string[],
  projectID: string,
  direction: "up" | "down",
): string[] {
  const index = ids.indexOf(projectID);
  const targetIndex = index + (direction === "up" ? -1 : 1);
  if (index === -1 || targetIndex < 0 || targetIndex >= ids.length) return [...ids];
  return moveProjectRelative(ids, projectID, ids[targetIndex]!, direction === "down");
}

// presentedProjectOrder is the id sequence in exactly the order the rows
// render: alphabetical until the operator's menu-built order exists, then
// that order applied on top. The model's server order is never consulted.
// It is also the move's ground truth — a menu move seeds from these ids, so
// it reorders exactly the visible neighbors.
export function presentedProjectOrder(
  groups: readonly ProjectWithSessions[],
  savedOrder: readonly string[] | null,
): string[] {
  const byName = [...groups].sort((a, b) =>
    a.project.name.localeCompare(b.project.name));
  if (savedOrder === null) return byName.map((g) => g.project.id);
  const position = new Map(savedOrder.map((id, index) => [id, index]));
  return byName
    .sort((a, b) =>
      (position.get(a.project.id) ?? Number.MAX_SAFE_INTEGER)
        - (position.get(b.project.id) ?? Number.MAX_SAFE_INTEGER))
    .map((g) => g.project.id);
}

// moveSessionRelative is the pure core of the session-row drag reorder: it
// returns the order with `from` removed and reinserted on the named side of
// `target`. An unknown target appends, so a drag onto a row that left the
// list (a concurrent refresh) still settles somewhere visible.
export function moveSessionRelative(
  ids: readonly string[],
  from: string,
  target: string,
  after: boolean,
): string[] {
  const next = ids.filter((id) => id !== from);
  const index = next.indexOf(target);
  if (index === -1) next.push(from);
  else next.splice(after ? index + 1 : index, 0, from);
  return next;
}

// presentedSessionOrder is the id sequence in exactly the order the rows
// render: the server's order until the operator's drag-built order exists,
// then that order applied on top. A session the saved order does not name
// sorts after the ones it does, so a new session appears predictably rather
// than jumping to the top.
export function presentedSessionOrder(
  sessions: readonly SessionSummary[],
  savedOrder: readonly string[] | null,
): string[] {
  const serverOrder = sessions.map((s) => s.id);
  if (savedOrder === null) return serverOrder;
  const position = new Map(savedOrder.map((id, index) => [id, index]));
  return [...serverOrder].sort((a, b) =>
    (position.get(a) ?? Number.MAX_SAFE_INTEGER)
      - (position.get(b) ?? Number.MAX_SAFE_INTEGER));
}

// A row's box exactly as it laid out when a drag started.
export interface DragRowBox {
  id: string;
  top: number;
  bottom: number;
}

// dragRowBoxes measures a drag's target geometry from live rows. It runs at
// dragstart, and again mid-drag only when the row set itself changed (see
// refreshDragBoxes).
function dragRowBoxes(
  rows: readonly HTMLElement[],
  idOf: (row: HTMLElement) => string,
): DragRowBox[] {
  const boxes: DragRowBox[] = [];
  for (const row of rows) {
    const rect = row.getBoundingClientRect();
    // bottom is derived, not read: every rect source agrees on top and
    // height, and reading .bottom outright breaks against partial rect
    // shapes (the unit fakes carry {top, height} only).
    boxes.push({ id: idOf(row), top: rect.top, bottom: rect.top + rect.height });
  }
  return boxes;
}

// refreshDragBoxes re-measures only when the row set changed — a mid-drag
// refresh that added or removed a row. Rows only change through a render,
// and a render rebuilds them without the gesture's gap classes, so the
// re-measured boxes are gap-free. An unchanged set keeps the dragstart
// boxes: those are the stable ground the gesture targets, not the live
// layout the opened gap itself shifted.
function refreshDragBoxes(
  scope: Element,
  selector: string,
  idOf: (row: HTMLElement) => string,
  current: DragRowBox[] | null,
): DragRowBox[] {
  const rows = Array.from(scope.querySelectorAll<HTMLElement>(selector));
  if (current !== null && current.length === rows.length &&
      current.every((box, index) => box.id === idOf(rows[index]!))) {
    return current;
  }
  return dragRowBoxes(rows, idOf);
}

// rowDropSlot resolves the pointer against the dragstart geometry: the
// first row whose box reaches below the pointer is the target, `after` set
// by which side of that box's midline the pointer sits on. The source
// row's own box offers no slot (the row already occupies it), a pointer
// below every box — the rail's trailing space — offers none, and a source
// missing from the boxes offers none at all: the row being dragged left
// the rail in a mid-gesture refresh, and committing would re-insert its
// dead id into the saved order. Live rects cannot decide this: the gap is
// the target row's own margin, so the moment one opens the target and
// every row below it slide away from a pointer that never moved, and a
// live hit test then names a neighbour that slid under the pointer — the
// release commits the original order back and the drag reads as having
// bounced.
export function rowDropSlot(
  boxes: readonly DragRowBox[],
  clientY: number,
  sourceID: string,
): { id: string; after: boolean } | null {
  const source = boxes.find((box) => box.id === sourceID);
  if (source === undefined) return null;
  if (clientY >= source.top && clientY < source.bottom) return null;
  for (const box of boxes) {
    if (box.id === sourceID) continue;
    if (clientY < box.bottom) return { id: box.id, after: clientY > (box.top + box.bottom) / 2 };
  }
  return null;
}


export class Sidebar {
  private container: HTMLElement;
  private model: SidebarModel;
  // onProjectListRendered reports that the project rows were redrawn.
  // Every change that can move a session's resolved tile colour — a
  // swatch pick, the auto-colour preference, a model refresh — lands in
  // render() or renderProjectList(), so a surface that mirrors a row's
  // presentation (the titlebar chip) re-derives from this one
  // notification instead of tracking each control.
  private onProjectListRendered?: () => void;
  private onConnectGitHub?: () => void;
  private projectActions: { onTutorial?: () => void; tutorialUnavailableReason?: () => string | null; onOpenProject?: (id: string) => void; onAuthorizationLost?: () => void; githubEnabled?: boolean } = {};
  private projectSource: "choose" | "github" | "local" | "url" = "choose";
  private githubRepositories: GitHubRepositoriesModel | null = null;
  private githubSelection: { repository: GitHubRepository; account: string } | null = null;
  private githubImported = new Map<string, { id: string; name: string }>();
  private githubReadGeneration = 0;
  private hostEl: HTMLElement | null = null;
  private previewDialog: ProjectPreviewSettingsDialog | null = null;
  private readonly previewObservations = new ProjectPreviewObservations();
  private modalReturnSelector: string | null = null;
  private nestedModalReturnSelector: string | null = null;
  private modalFocusCleanup: (() => void) | null = null;
  // Narrow viewports open collapsed: below md the sidebar OVERLAYS the
  // workspace, so starting expanded would cover the terminal.
  private collapsed = typeof window === "undefined"
    ? false
    : startsCollapsed(window.matchMedia(MOBILE_QUERY).matches);
  private search = "";
  // The selected session's project starts expanded (reference behavior);
  // other projects collapse to header + count until clicked.
  private expandedProjects = new Set<string>();
  private expansionTouched = false;
  // projectOrder is the operator's menu-built project row order; null
  // keeps the alphabetical display default. Local presentation state like
  // expansion — the server's project order is never rewritten.
  private projectOrder: string[] | null = null;
  // dropAfter carries the in-flight session drag's slot side so the
  // handlers can paint the gap placeholder without a re-render mid-gesture.
  private dropAfter = false;
  // sessionOrder is the operator's drag-built session order per project.
  // A project not named here falls back to the server's order.
  private sessionOrder: Record<string, string[]> = {};
  // dragSession/dropTargetSession carry the in-flight session drag.
  // dragSession also stores the project id so a session only drops inside
  // its own rail. sessionDragBoxes is the rail's row geometry captured at
  // dragstart and resolved by rowDropSlot during dragover.
  private dragSession: { id: string; pid: string } | null = null;
  private dropTargetSession: string | null = null;
  private sessionDragBoxes: DragRowBox[] | null = null;
  private createdProjectToExpand: string | null = null;
  private scrimHandler: (() => void) | null = null;
  private newSessionProject: string | null = null;
  private launchingNewSessionProvider: string | null = null;
  // refreshingProviders is true while the picker's retry button is re-reading
  // the harness inventory. It disables the retry button and lets tests prove
  // the wiring by observing a signal only the listener produces.
  private refreshingProviders = false;
  private newSessionFilter = "";
  private newSessionMarkup: string | null = null;
  private newSessionSelection: number | null = null;
  // The harness order the open picker draws, pinned for its lifetime (task
  // 467). Null is the served order; a ranking replaces it at most once per
  // opening, before the operator has touched the list.
  private newSessionOrder: readonly string[] | null = null;
  // Whether the operator has engaged with the open picker — typed, moved the
  // selection, or put the pointer on a chip. It is a record of the opening,
  // not of the current state: a filter typed and cleared, or a pointer that
  // has moved on, still means the list was being read, and reordering it
  // then moves a target under a hand already on the way to it.
  private newSessionTouched = false;
  // Which opening a pending history read belongs to. Closing and reopening
  // the same project is a new opening with a new read, and the first read's
  // answer must not pin the second dialog.
  private newSessionOpening = 0;
  // pendingSession is a launch the operator has asked for that the server
  // has not answered yet. The row is drawn from the request so it appears
  // on the click, and carries a spinner until the refresh replaces it
  // with the real one.
  private pendingSession: PendingSession | null = null;
  // skipCloseConfirm mirrors the console setting; null until the app shell
  // has read it from the server. confirmsBeforeClose owns what each value
  // means, so nothing here has to encode the fail-safe.
  private skipCloseConfirm: boolean | null = null;
  private skipRemoveProjectConfirm: boolean | null = null;
  // renamingSession is the row currently being relabeled inline (task
  // 48); null when no edit is open. Local presentation state only.
  private renamingSession: string | null = null;
  private renameSessionReturnSelector: string | null = null;
  // selectedProjectID is the project row the operator last clicked. It
  // is presentation state like expansion, and it is what a contextual
  // rename resolves when no menu is open: clicking a project row selects
  // it, and clicking a session selects that session instead.
  private selectedProjectID: string | null = null;
  // contextProjectID is the project currently in context for creation
  // actions: the operator's last-clicked project row, or the project of
  // the selected session. Closing a session leaves this set, so the empty
  // pane names that project instead of falling back to the first row.
  private contextProjectID: string | null = null;
  // openRowMenuTarget is the row whose ⋯ menu is mounted; an open menu
  // is the explicit target a contextual rename resolves first.
  private openRowMenuTarget: { kind: RowMenuKind; id: string } | null = null;
  // projectsMenuAnchor is the trigger of the mounted PROJECTS header
  // menu, and projectsMenuTeardown releases that menu's document-level
  // listeners. A full render swaps the trigger node for a new one, so the
  // pair is reconciled on every render: a menu must never stay mounted
  // against a detached trigger.
  private projectsMenuAnchor: HTMLButtonElement | null = null;
  private projectsMenuTeardown: (() => void) | null = null;
  // rowMenuTeardown releases the open row menu's window-level scroll and
  // resize listeners. The menu outlives any single close path — the
  // backdrop, Escape, an action row, dismissRowMenu, dispose — so every
  // close runs through the teardown rather than dropping the listeners.
  private rowMenuTeardown: (() => void) | null = null;
  // renamingProject is the project header currently being relabeled
  // inline; same pattern, display name only — the directory
  // on disk never changes.
  private renamingProject: string | null = null;
  // An open inline edit's unconfirmed text, carried across the markup
  // replacement that destroys its input and restored onto the rebuilt one.
  // The rebuilt input takes its value from the model's stored name, so
  // without this snapshot every repaint mid-edit discards the half-typed
  // draft and the operator retypes from scratch.
  private renameDraft: RenameDraft | null = null;
  // True only inside the statement that replaces the rail's markup. Chrome
  // delivers the removed input's blur synchronously within that assignment
  // (the same delivery render()'s listHadFocus snapshot depends on), so a
  // rename blur observed with this flag up is the sidebar's own teardown,
  // never the operator accepting the draft. Committing on a teardown blur
  // silently writes a half-typed name every time a background poll repaints
  // the rail while the operator types.
  private railTeardown = false;
  private newProjectOpen = false;
  private removeConfirm: SessionRemovalTarget | null = null;
  private removingSession = false;
  // removeProjectConfirm is the project pending the operator's removal
  // confirmation. live counts its starting/running sessions so the
  // modal states the stop-cascade consequence up front — the server
  // remains the authority on what actually stops.
  private removeProjectConfirm: { id: string; name: string; path: string; live: number } | null = null;
  // The Add project dialog's state: one field, what the server made of it,
  // and the clone job it may be bound to. A hidden job stays bound so the
  // rail row can reopen it.
  private addProjectInput = "";
  private addProjectInspection: Inspection | null = null;
  private addProjectInspectError = "";
  private addProjectServerError = "";
  private addProjectBase = "";
  private addProjectRequest = 0;
  private addProjectInspectTimer: ReturnType<typeof setTimeout> | null = null;
  private addProjectInspecting = false;
  private addProjectJob: CloneJob | null = null;
  private addProjectHidden = false;
  private clonePollTimer: ReturnType<typeof setTimeout> | null = null;
  private cloneJobs: CloneJob[] = [];
  private pickTarget: "add" | "dest" = "add";
  private newProjectProfileID = "";
  private identitySettingsOpen = false;
  private identityEditor: "new" | string | null = null;
  private identityDelete: string | null = null;
  private identityBusy = false;
  private projectIdentitySetup: {
    projectID: string;
    profileID: string;
    retryProvider: string | null;
    retryAttempted: boolean;
  } | null = null;
  // newFolderOpen toggles the picker's inline create-a-folder row (task
  // 57); the name itself is read from the DOM at submit.
  private newFolderOpen = false;
  private directoryPickerOpen = false;
  private directoryLoading = false;
  private directoryListing: ProjectDirectoryListing | null = null;
  private directoryError = "";
  // directoryMountRoots is the allowed-root count the mount listing reports;
  // the picker's Up control returns to the mount only when there is more
  // than one root to choose between. Null until a mount listing has been
  // read, which a picker opened straight at a path has not done.
  private directoryMountRoots: number | null = null;
  private directoryRequest = 0;
  private disposed = false;
  // Independent per-session silence windows are fed only by content-free
  // output edges. Multiple background sessions may spin concurrently.
  private streamingSessionIDs = new Set<string>();
  // chatMarks is the content-free chat fact per session (handoff §23),
  // supplied by the shell from the chat index; a row not listed carries no
  // mark.
  private chatMarks = new Map<string, ChatMark>();
  // Keep visible last-output ages current without re-rendering whole rows.
  private metaTimer: number | null = null;
  // layout caches the last loaded document so a save can preserve fields the
  // sidebar does not manage (session order) while rewriting the ones it does.
  private layout: SidebarLayout | null = null;
  // layoutApplied ensures the saved arrangement is applied exactly once,
  // when projects are first known, even if the layout document resolves before
  // the project list does.
  private layoutApplied = false;
  // projectColors is the operator's saved project tag map from the layout
  // document. It is the persistence side of setProjectColor: the model holds
  // the live colour on the groups, this map survives every group rebuild and
  // is what a swatch pick writes through saveLayout.
  private projectColors: Record<string, string> = {};
  // The sidebar list uses a roving tabindex: one row is tabbable and arrow
  // keys move focus among visible rows. focusedListRow tracks which row that
  // is so it survives re-renders, and listHadFocus tells us whether focus was
  // inside the list when a render happened so we can return it there.
  private focusedListRow: { kind: "project" | "session"; id: string } | null = null;
  private listHadFocus = false;
  // renderedMarkup is the rail markup the last painting render() assigned
  // to the container. render() rebuilds the string from current state on
  // every call and paints only when it differs: assigning innerHTML over
  // an unchanged rail restarts every CSS animation mid-flight (all the
  // running spinners snap back to their starting angle in unison), blurs
  // the focused row, and discards uncommitted rename text. The cache may
  // only describe markup render() itself wrote, so every other writer of
  // the container's contents drops it: renderProjectList repaints list
  // rows without the chrome around them, and a divergent meta patch
  // leaves a span holding bytes no later render is guaranteed to rebuild
  // (writeSessionMeta states why). Transient decorations no render
  // produces — drag-gap classes, a menu trigger's aria-expanded — survive
  // a skip, which is the point: they belong to gestures and menus that
  // are still live.
  private renderedMarkup: string | null = null;
  // sessionMetaWritten is the meta html each row's [data-session-meta]
  // span currently holds, recorded by renderGroup when it builds the
  // markup and by writeSessionMeta when it patches a span in place. The
  // comparison has to be producer string against producer string: reading
  // span.innerHTML back returns the browser's serialization, which
  // collapses the newlines sessionMetaHtml leaves between attributes, so
  // a DOM compare never sees a patched spinner as unchanged and would
  // rewrite it — and drop the render cache — on every age tick.
  private sessionMetaWritten = new Map<string, string>();

  constructor(
    container: HTMLElement,
    model: SidebarModel,
    onProjectListRendered?: () => void,
    onConnectGitHub?: () => void,
    projectActions: { onTutorial?: () => void; tutorialUnavailableReason?: () => string | null; onOpenProject?: (id: string) => void; onAuthorizationLost?: () => void; githubEnabled?: boolean } = {},
  ) {
    this.container = container;
    this.model = model;
    this.onProjectListRendered = onProjectListRendered;
    this.onConnectGitHub = onConnectGitHub;
    this.projectActions = projectActions;
    this.render();
    if (typeof window !== "undefined") {
      this.metaTimer = window.setInterval(() => this.refreshSessionMeta(), 30_000);
      void this.loadLayout();
    }
  }

  // One door, two rooms: with no identity on file the row opens the
  // first-visit form, and only once one exists the manager. Nobody is
  // asked to manage what they have not yet created.
  openGitIdentitySettings(): void {
    this.identitySettingsOpen = !this.needsGitIdentityOnboarding();
    this.identityEditor = null;
    this.identityDelete = null;
    this.renderModals();
  }


  // The rail state the ⌘B chord and the More menu's side-panel switch
  // read and drive; collapse remains this shell's own flow so the
  // collapsed-rail titlebar control stays in one place.
  get isCollapsed(): boolean {
    return this.collapsed;
  }

  toggleCollapsed(): void {
    this.setCollapsed(!this.collapsed);
  }

  open(): void {
    this.setCollapsed(false);
  }

  // renameTarget resolves what a contextual rename (⌘R) points at: the
  // open row menu first — it is the explicit target — then the project
  // row the operator last clicked, then the selected session. A target
  // whose row no longer exists resolves to null: renaming a stale id
  // would silently miss.
  renameTarget(): { kind: RowMenuKind; id: string } | null {
    const open = this.openRowMenuTarget;
    if (open !== null) return this.rowExists(open) ? open : null;
    const project = this.selectedProjectID;
    if (project !== null && this.model.groups.some((g) => g.project.id === project)) {
      return { kind: "project", id: project };
    }
    const session = this.model.selectedSessionID;
    if (session !== null && this.findSession(session) !== null) {
      return { kind: "session", id: session };
    }
    return null;
  }

  // newSessionTarget resolves the project a contextual New session means
  // (comp desktop-r16): the project currently in context, else the first
  // row as presented — the same target the Projects header menu names —
  // with the row's effective tint so the empty titlebar's tile and the
  // rail can never disagree. Null only when no projects exist.
  newSessionTarget(): { id: string; name: string; tint: string | null } | null {
    const target = newSessionTargetProject(
      this.model.groups,
      presentedProjectOrder(this.model.groups, this.projectOrder),
      this.rowMenuProject() ?? this.contextProjectID,
    );
    if (target === null) return null;
    const group = this.model.groups.find((g) => g.project.id === target.id);
    return { ...target, tint: effectiveProjectTint(group?.color, group?.autoColor) };
  }

  // setProjectContext records the project currently in context for
  // creation actions. Programmatic selections (startup restore, poll
  // auto-select) use this so the empty pane and Projects menu target the
  // selected session's project after it goes away.
  setProjectContext(projectID: string | null): void {
    if (projectID === null) {
      this.contextProjectID = null;
      return;
    }
    if (this.model.groups.some((g) => g.project.id === projectID)) {
      this.contextProjectID = projectID;
    } else {
      this.contextProjectID = null;
    }
  }

  // beginRename is the ⌘R path. With a row menu open it behaves exactly
  // like clicking that menu's Rename row — the menu closes and focus
  // returns to its trigger when the edit ends; otherwise the row's own
  // ellipsis control is the return target.
  beginRename(target: { kind: RowMenuKind; id: string }): void {
    const menuTrigger = this.dismissRowMenu();
    this.startInlineRename(
      target,
      target.kind === "session"
        ? menuTrigger ?? `[data-session-menu="${CSS.escape(target.id)}"]`
        : null,
    );
  }


  // rowMenuProject names the project an open row menu points at. The rename
  // chord already reads an open menu as the explicit target; reading it here
  // too keeps the two resolvers from naming different rows.
  private rowMenuProject(): string | null {
    const open = this.openRowMenuTarget;
    if (open === null || !this.rowExists(open)) return null;
    return open.kind === "project" ? open.id : this.projectOfSession(open.id);
  }

  // projectOfSession answers where a session row sits. A poll can rebuild the
  // groups without a row that is still on screen, so the rendered rail
  // answers for the interval between that rebuild and the re-render.
  private projectOfSession(sessionID: string): string | null {
    const group = this.model.groups.find((g) => g.sessions.some((s) => s.id === sessionID));
    if (group !== undefined) return group.project.id;
    const row = this.container.querySelector<HTMLElement>(
      `[data-session="${CSS.escape(sessionID)}"]`,
    );
    return row?.closest<HTMLElement>("[data-project]")?.dataset.project ?? null;
  }

  private rowExists(target: { kind: RowMenuKind; id: string }): boolean {
    return target.kind === "project"
      ? this.model.groups.some((g) => g.project.id === target.id)
      : this.findSession(target.id) !== null;
  }

  // startInlineRename is the ONE inline-rename entry: the menu rows and
  // the ⌘R chord swap the same row for the same field.
  private startInlineRename(
    target: { kind: RowMenuKind; id: string },
    returnSelector: string | null,
  ): void {
    if (target.kind === "project") {
      this.renamingProject = target.id;
    } else {
      this.renamingSession = target.id;
      this.renameSessionReturnSelector = returnSelector;
    }
    this.render();
    const input = this.container.querySelector<HTMLInputElement>(
      target.kind === "project" ? "[data-rename-project-input]" : "[data-rename-input]",
    );
    input?.focus();
    input?.select();
  }

  // The URL-drivable state entry points: the preview harness
  // reaches each presentation through these rather than scripting a click,
  // so a capture cannot silently land on the default view. Each mirrors the
  // exact state the corresponding operator gesture produces.

  openProjectsMenu(): void {
    // Whichever trigger this width renders: the desktop eyebrow, or the
    // sheet's ellipsis where the eyebrow is hidden. Sort, expand and
    // collapse are the menu's commands, so the menu itself must stay
    // reachable at every width that shows the list.
    const sheet = this.container.querySelector<HTMLButtonElement>("[data-sidebar-sheet-menu]");
    const eyebrow = this.container.querySelector<HTMLButtonElement>("[data-projects-menu]");
    // offsetParent needs real layout; where none exists (the unit fake DOM)
    // the sheet trigger reads hidden and the eyebrow keeps the anchor — the
    // desktop behaviour this method always had.
    const anchor = sheet !== null && sheet.offsetParent !== null && sheet.offsetParent !== undefined
      ? sheet
      : eyebrow ?? sheet;
    if (anchor !== null) this.mountProjectsHeaderMenu(anchor);
  }

  openProjectMenu(projectID: string): void {
    const anchor = this.container.querySelector<HTMLButtonElement>(
      `[data-project-menu="${CSS.escape(projectID)}"]`,
    );
    if (anchor === null) return;
    this.mountProjectMenu(projectID, anchor);
  }

  openSessionMenu(sessionID: string): void {
    const anchor = this.container.querySelector<HTMLButtonElement>(
      `[data-session-menu="${CSS.escape(sessionID)}"]`,
    );
    if (anchor === null) return;
    this.mountSessionMenu(sessionID, anchor);
  }

  renderNewSessionPicker(): void {
    if (this.newSessionProject !== null) this.renderModals();
  }

  // The ONE path that opens the picker: every affordance that
  // offers a new session goes through here, because opening it reads that
  // project's launch history to rank the harnesses.
  openNewSession(projectID: string): void {
    this.newSessionProject = projectID;
    this.newSessionFilter = "";
    this.newSessionSelection = null;
    // The order this opening keeps. It starts as the served one — the
    // previous project's ranking is not this project's — and is replaced
    // once, if the history arrives before the operator has touched the
    // picker. Pinning it is what stops a later render moving a chip out
    // from under the pointer or the arrow keys.
    this.newSessionOrder = null;
    this.newSessionTouched = false;
    const opening = ++this.newSessionOpening;
    this.renderModals();
    void this.model.refreshHarnessUsage(projectID).then(() => {
      if (this.disposed || this.newSessionOpening !== opening) return;
      if (this.newSessionProject !== projectID) return;
      // An operator who has started reading the list is reading THIS list:
      // the selection is an index into it, and the pointer is over a chip in
      // it. The ranking waits for the next opening rather than moving either.
      if (this.newSessionTouched) return;
      this.newSessionOrder = rankHarnesses(this.model.availableProviders, this.model.harnessUsage);
      this.renderModals();
    });
  }

  private launchProvider(provider: string): void {
    const projectID = this.newSessionProject;
    if (projectID === null || this.launchingNewSessionProvider !== null) return;
    // Disable every launch choice synchronously. The model repeats this
    // guard because programmatic calls and a concurrent re-render must
    // be just as safe as an ordinary click.
    this.host().querySelectorAll<HTMLButtonElement>("[data-new-session-provider]")
      .forEach((b) => { b.disabled = true; });
    this.launchingNewSessionProvider = provider;
    const host = this.host();
    const spinner = host.querySelector<HTMLElement>(`[data-new-session-spinner="${CSS.escape(provider)}"]`);
    if (spinner !== null) spinner.hidden = false;
    this.pendingSession = { projectID, provider };
    // The row lands in the project the operator launched into, so that
    // project must be open to show it. expansionTouched stays as it
    // was: it means the operator has taken over expansion by hand, and
    // setting it here would stop a later selection auto-expanding its
    // own project.
    this.expandedProjects.add(projectID);
    const creation = this.model.create(projectID, provider);
    this.render();
    void creation.then((result) => {
      if (result !== "identity_required") return;
      this.projectIdentitySetup = {
        projectID,
        profileID: this.defaultGitIdentity()?.id ?? "",
        retryProvider: provider,
        retryAttempted: false,
      };
    }).finally(() => {
      this.launchingNewSessionProvider = null;
      this.newSessionProject = null;
      this.newSessionFilter = "";
      this.newSessionSelection = null;
      this.pendingSession = null;
      if (!this.disposed) this.render();
    });
  }

  openCloseSessionConfirm(sessionID: string): void {
    const target = this.sessionRemovalTarget(sessionID);
    if (target === null) return;
    this.removeConfirm = target;
    this.renderModals();
  }

  openRemoveProjectConfirm(projectID: string): void {
    const group = this.model.groups.find((g) => g.project.id === projectID);
    if (group === undefined) return;
    this.removeProjectConfirm = {
      id: projectID,
      name: group.project.name,
      path: group.project.canonical_path,
      live: group.sessions.filter(
        (s) => s.status === "starting" || s.status === "running",
      ).length,
    };
    this.renderModals();
  }

  openProjectGitIdentitySetup(projectID: string): void {
    const project = this.model.groups.find((g) => g.project.id === projectID)?.project;
    if (project === undefined) return;
    this.projectIdentitySetup = {
      projectID,
      profileID: project.git_identity_profile_id ?? this.defaultGitIdentity()?.id ?? "",
      retryProvider: null,
      retryAttempted: false,
    };
    this.renderModals();
  }

  // openDirectoryPicker opens the choose-a-directory picker nested in the
  // open-project dialog and resolves once the listing has loaded.
  async openDirectoryPicker(): Promise<void> {
    this.openNewProject();
    this.projectSource = "local";
    await this.openDirectory();
  }

  startRenameProject(projectID: string): void {
    this.renamingProject = projectID;
    this.render();
    const input = this.container.querySelector<HTMLInputElement>("[data-rename-project-input]");
    input?.focus();
    input?.select();
  }

  // dismissRowMenu closes an open row menu the way its action rows do —
  // without moving focus, which the action's own flow takes — and
  // returns the dismissed menu's trigger selector, or null when no menu
  // was open.
  private dismissRowMenu(): string | null {
    const open = this.openRowMenuTarget;
    if (open === null) return null;
    const selector = `[data-${open.kind}-menu="${CSS.escape(open.id)}"]`;
    this.container.querySelector<HTMLButtonElement>(selector)
      ?.setAttribute("aria-expanded", "false");
    this.closeRowMenu();
    return selector;
  }

  startRenameSession(sessionID: string): void {
    this.renamingSession = sessionID;
    this.render();
    const input = this.container.querySelector<HTMLInputElement>("[data-rename-input]");
    input?.focus();
    input?.select();
  }

  async refresh(): Promise<void> {
    if (this.disposed) return;
    await this.model.refresh();
    if (this.disposed) return;
    // The rail carries clones in flight; a row for one is only as fresh as
    // the last read, so each refresh reads the job list too.
    try {
      this.cloneJobs = await this.model.api.listClones();
      if (this.cloneJobs.some((j) => j.status === "running") && this.clonePollTimer === null) this.pollClone();
    } catch {
      // The project list still renders; the job rows keep their last read.
    }
    if (this.disposed) return;
    this.render();
  }

  // loadLayout reads the operator's saved arrangement once at mount. A null
  // response means the document has never been written, so the default
  // alphabetical order and default expansion stay in place.
  // A kept document is only applied when the project list is non-empty so ids
  // are not mistaken for stale before the projects have loaded. A failed read
  // leaves the default arrangement in place.
  private async loadLayout(): Promise<void> {
    if (this.disposed) return;
    try {
      const layout = await this.model.api.getLayout();
      if (this.disposed) return;
      this.layout = layout;
      this.maybeApplyLayout();
    } catch {
      // The default arrangement is already rendered; nothing to recover.
    }
  }

  // maybeApplyLayout applies the loaded layout the first time projects are
  // known and the operator has not already changed the local arrangement. A
  // gesture made while the document is in flight wins because expansionTouched
  // and projectOrder stay set.
  private maybeApplyLayout(): void {
    if (this.layoutApplied || this.disposed || this.layout === null) return;
    if (this.model.groups.length === 0) return;
    this.layoutApplied = true;
    this.applyLayout(this.layout);
  }

  // applyLayout sets expansion and project order from the server document,
  // but only when the operator has not already changed the local arrangement.
  // Stale ids are dropped so removed projects do not leave ghost rows.
  private applyLayout(layout: SidebarLayout): void {
    if (this.disposed) return;
    const projectIDs = new Set(this.model.groups.map((g) => g.project.id));
    // Colours apply unconditionally: unlike order and expansion they are per
    // project, not one arrangement, and a document from another device wins
    // over nothing local.
    this.projectColors = { ...(layout.colors ?? {}) };
    let needsRender = false;
    if (!this.expansionTouched) {
      const expanded = new Set(layout.expanded.filter((id) => projectIDs.has(id)));
      if (expanded.size > 0 || layout.expanded.length === 0) {
        this.expandedProjects = expanded;
        this.expansionTouched = true;
        needsRender = true;
      }
    }
    if (this.projectOrder === null) {
      const order = layout.projects.filter((id) => projectIDs.has(id));
      if (order.length > 0) {
        this.projectOrder = order;
        if (!needsRender) {
          this.renderProjectList();
        }
      }
    }
    if (Object.keys(this.sessionOrder).length === 0) {
      this.sessionOrder = { ...layout.sessions };
      if (!needsRender) {
        this.renderProjectList();
      }
    }
    if (needsRender) {
      this.render();
    }
  }

  // saveLayout persists the current arrangement. The local state is already
  // applied; a failed write leaves it on screen and only skips the mirror.
  private saveLayout(): void {
    if (this.disposed) return;
    const projectIDs = new Set(this.model.groups.map((g) => g.project.id));
    const colors: Record<string, string> = {};
    for (const [id, color] of Object.entries(this.projectColors)) {
      if (projectIDs.has(id)) colors[id] = color;
    }
    const next: SidebarLayout = {
      expanded: [...this.expandedProjects].filter((id) => projectIDs.has(id)),
      projects: this.projectOrder?.filter((id) => projectIDs.has(id)) ?? [],
      sessions: this.sessionOrder,
      colors,
    };
    void this.model.api.saveLayout(next).then((saved) => {
      if (!this.disposed) this.layout = saved;
    }).catch(() => {
      // The operator's gesture already took effect locally; leave it there.
    });
  }

  dispose(): void {
    this.disposed = true;
    ++this.githubReadGeneration;
    this.githubRepositories?.close();
    this.previewDialog?.close(false);
    if (this.metaTimer !== null) {
      window.clearInterval(this.metaTimer);
      this.metaTimer = null;
    }
    this.closeProjectsMenu(false);
    this.closeRowMenu();
    this.modalFocusCleanup?.();
    this.modalFocusCleanup = null;
    this.hostEl?.remove();
    this.hostEl = null;
  }

  // replaceRailMarkup is the one place the rail's markup is assigned. A
  // repaint that lands while an inline rename is open destroys its focused
  // input, and Chrome fires that input's blur synchronously inside the
  // assignment - the same delivery the listHadFocus snapshot in render()
  // already depends on. Marking the window is what lets the rename blur
  // handlers tell the sidebar's own teardown from the operator leaving the
  // field: a blur is not evidence of anything on its own, and an unmarked
  // teardown commits a name the operator never confirmed. The open edit's
  // text is captured first because the input is unreachable the moment the
  // assignment runs.
  private replaceRailMarkup(target: Element, markup: string): void {
    this.captureRenameDraft();
    this.railTeardown = true;
    target.innerHTML = markup;
    this.railTeardown = false;
  }

  // captureRenameDraft snapshots the open inline edit ahead of the markup
  // replacement that destroys its input: the typed text, the caret, and
  // whether the field held focus. The session and project edits are mutually
  // exclusive in practice - opening one leaves the other - and the capture
  // takes whichever is open.
  private captureRenameDraft(): void {
    if (this.renamingSession !== null) {
      this.captureDraft("session", this.renamingSession, "[data-rename-input]");
      return;
    }
    if (this.renamingProject !== null) {
      this.captureDraft("project", this.renamingProject, "[data-rename-project-input]");
    }
  }

  private captureDraft(kind: "session" | "project", id: string, selector: string): void {
    const input = this.container.querySelector<HTMLInputElement>(selector);
    if (input === null) return;
    this.renameDraft = {
      kind,
      id,
      value: input.value,
      selStart: input.selectionStart ?? null,
      selEnd: input.selectionEnd ?? null,
      focused: document.activeElement === input,
    };
  }

  // restoreRenameDraft puts a captured edit back onto the rebuilt input -
  // value, caret, and focus - so a repaint the operator never caused is
  // invisible mid-edit. The draft is dropped when the edit ended or its row
  // left the rail across the same repaint: there is nothing left to restore
  // onto, and a later edit captures its own draft.
  private restoreRenameDraft(): void {
    const draft = this.renameDraft;
    this.renameDraft = null;
    if (draft === null) return;
    const stillOpen = draft.kind === "session"
      ? this.renamingSession === draft.id
      : this.renamingProject === draft.id;
    if (!stillOpen) return;
    const input = this.container.querySelector<HTMLInputElement>(
      draft.kind === "session" ? "[data-rename-input]" : "[data-rename-project-input]",
    );
    if (input === null) return;
    input.value = draft.value;
    if (draft.selStart !== null && draft.selEnd !== null) {
      input.setSelectionRange(draft.selStart, draft.selEnd);
    }
    if (draft.focused) input.focus();
  }

  // writeSessionMeta is the one in-place patcher for a row's meta span:
  // setStreaming on an output edge, the age tick for last-output ages.
  // A rewrite whose bytes match the recorded ones is dropped — assigning
  // innerHTML re-parses and replaces the span's children even when the
  // string is identical, which restarts the very spinner this patcher
  // exists to keep current. A rewrite whose bytes differ leaves the
  // container disagreeing with renderedMarkup, because the patch was
  // computed at its own instant against the model as it stood: the
  // server can stop presenting a session as running after a spinner was
  // patched in (the flip then leaves no trace in the recomputed markup),
  // and a fresher last_output_at can move an age back into the bucket
  // the cached string already shows. Dropping the cache makes the next
  // render repaint rather than strand the patched span on screen.
  private writeSessionMeta(span: HTMLElement | null, sessionID: string, html: string): void {
    if (span === null) return;
    if (this.sessionMetaWritten.get(sessionID) === html) return;
    this.sessionMetaWritten.set(sessionID, html);
    span.innerHTML = html;
    this.renderedMarkup = null;
  }

  // Activity replaces only the affected row's metadata, preserving hover and
  // focus in every other row. Silence restores passive state and output age.
  setStreaming(sessionID: string, active: boolean): void {
    if (this.disposed) return;
    const session = this.findSession(sessionID);
    // The spinner is gated on the server-presented presentation state only:
    // a stale output edge must never spin a row the server no longer
    // presents as running.
    if (session === null || session.presentation_state !== "running") return;
    if (this.streamingSessionIDs.has(sessionID) === active) return;
    if (active) this.streamingSessionIDs.add(sessionID);
    else this.streamingSessionIDs.delete(sessionID);
    const span = this.container.querySelector<HTMLElement>(
      `[data-session-meta="${CSS.escape(sessionID)}"]`,
    );
    this.writeSessionMeta(span, sessionID, sessionMetaHtml(session, active, this.chatMarks.get(sessionID) ?? null));
    // The phone's leading status cell is patched on the same edge: a full
    // render is the only other writer, and the 1.5s output window is far
    // shorter than the 10s poll — an edge that only patched the trailing
    // cell left the leading one empty for the whole window (or stuck, on
    // the silence edge after a mid-window render).
    // Two lookups, not a descendant selector: the DOM-free unit fakes
    // resolve simple selectors only, and the cell patch must be the same
    // code the tests drive.
    const row = this.container.querySelector<HTMLElement>(
      `[data-session="${CSS.escape(sessionID)}"]`,
    );
    const status = row?.querySelector<HTMLElement>("[data-session-status]") ?? null;
    if (status !== null) status.innerHTML = sessionStatusCellHtml(active);
  }

  // setChatMarks replaces every row's chat mark at once and patches only
  // the rows whose mark changed, the same in-place write the spinner uses.
  setChatMarks(marks: Map<string, ChatMark>): void {
    if (this.disposed) return;
    const changed = new Set<string>();
    for (const [id, mark] of marks) if ((this.chatMarks.get(id) ?? null) !== mark) changed.add(id);
    for (const id of this.chatMarks.keys()) if (!marks.has(id)) changed.add(id);
    this.chatMarks = new Map([...marks].filter(([, mark]) => mark !== null));
    for (const id of changed) {
      const session = this.findSession(id);
      if (session === null) continue;
      const span = this.container.querySelector<HTMLElement>(`[data-session-meta="${CSS.escape(id)}"]`);
      this.writeSessionMeta(span, id, sessionMetaHtml(session, this.streamingSessionIDs.has(id), this.chatMarks.get(id) ?? null));
    }
  }

  // setSkipCloseConfirm records the console setting as the server states
  // it. The sidebar owns the confirmation because the remove control is
  // here.
  setSkipCloseConfirm(skip: boolean | null): void {
    this.skipCloseConfirm = skip;
  }

  setSkipRemoveProjectConfirm(skip: boolean | null): void {
    this.skipRemoveProjectConfirm = skip;
  }

  private refreshSessionMeta(): void {
    if (this.disposed) return;
    for (const group of this.model.groups) {
      for (const session of group.sessions) {
        const span = this.container.querySelector<HTMLElement>(
          `[data-session-meta="${CSS.escape(session.id)}"]`,
        );
        this.writeSessionMeta(span, session.id, sessionMetaHtml(session, this.streamingSessionIDs.has(session.id), this.chatMarks.get(session.id) ?? null));
      }
    }
  }

  private findSession(id: string): SessionSummary | null {
    for (const group of this.model.groups) {
      const session = group.sessions.find((candidate) => candidate.id === id);
      if (session !== undefined) return session;
    }
    return null;
  }

  render(): void {
    if (this.disposed) return;
    this.maybeApplyLayout();
    const workspace = this.container.closest("[data-workspace]");
    workspace?.setAttribute("data-collapsed", this.collapsed ? "true" : "false");
    this.container.inert = this.collapsed;
    this.container.setAttribute("aria-hidden", this.collapsed ? "true" : "false");
    this.renderSidebarExpand(workspace);
    const m = this.model;
    this.applyDefaultExpansion();
    // Saved project colours re-apply on every draw: a refresh rebuilt the
    // groups without them, and both render paths share this guarantee.
    // The presented row order rides the same call so the auto tints
    // follow the rail in exactly the sequence drawn here.
    this.model.applyProjectColors(
      this.projectColors,
      presentedProjectOrder(this.model.groups, this.projectOrder),
    );
    // Every row's meta is re-derived below, so the recorded map is
    // rebuilt from exactly the sessions still presented; entries for
    // sessions the model dropped must not outlive their rows.
    this.sessionMetaWritten.clear();
    const filtered = this.filteredGroups();
    // With no projects the rail is one action (comp desktop-r16): a single
    // + New project row replaces the Projects header and the list — every
    // other row that menu could offer needs a project to act on. The row
    // itself renders only once a registry read has succeeded: while the
    // read is failing, a create affordance invites onboarding against a
    // database whose state nobody read, so the error banner
    // stands alone.
    const noProjects = m.groups.length === 0;
    const jobRows = this.cloneJobs
      .filter((j) => j.status !== "done")
      .map((j) => cloneRowHtml(j)).join("");
    const listRows = noProjects && jobRows === ""
      ? (m.registryReadOk ? newProjectRowHtml() : "")
      : filtered.map((g) => this.renderGroup(g.project.id)).join("") + jobRows;
    const markup = `
      <div class="chrome chrome-flush pl-(--space-4) pr-(--row-px)">
        ${lockupImg()}
      </div>
      ${sheetChromeHtml(this.search)}
      <div class="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-4 pb-4 pt-2">
        ${noProjects ? "" : projectsHeaderHtml()}
        ${m.error
          ? `<div class="mx-1 rounded-control-sm bg-error-tint px-3 py-2 text-caption text-error-on-tint">${escapeHtml(m.error)}</div>`
          : ""}
        ${m.identityNotice
          ? `<div data-identity-notice class="mx-1 rounded-control-sm bg-wash-selected px-3 py-2 text-caption text-text-secondary">${escapeHtml(m.identityNotice)}</div>`
          : ""}
        <ul data-project-list class="flex flex-col gap-px" role="listbox">
          ${listRows}
        </ul>
      </div>
      ${sheetActionsHtml(noProjects)}
    `;
    if (markup === this.renderedMarkup) {
      // The rail on screen already shows exactly these bytes, so the
      // container keeps its nodes: the bound listeners are still attached
      // to them, an open header menu stays anchored to its live trigger,
      // and focus was never destroyed so it needs no restoring. Modals
      // live in their own host outside the container and follow state a
      // rail render cannot see (an open settings page), so they still
      // redraw. onProjectListRendered stays silent: no row was redrawn,
      // and any change that would move what it re-derives changes these
      // bytes and takes the painting path below.
      this.renderModals();
      return;
    }
    this.renderedMarkup = markup;
    // Replacing the markup blurs a focused row, and Chrome delivers that
    // focusout before the removal - indistinguishable from tabbing away, and
    // it clears listHadFocus below. Whether focus belongs to the list is
    // decided by the state BEFORE the mutation, so snapshot it here and put
    // it back for restoreListFocus.
    const hadFocus = this.listHadFocus;
    this.replaceRailMarkup(this.container, markup);
    this.bind();
    // The markup above rebuilt the header that carries the Projects
    // trigger, so an open header menu is now pinned to a detached node.
    // Close it and hand focus to the replacement trigger; leaving it
    // mounted would strand Escape with no reachable trigger to restore.
    if (this.projectsMenuAnchor !== null) {
      const popovers = this.popoverRegion();
      const active = document.activeElement;
      const focusInMenu = popovers !== null && active instanceof Node && popovers.contains(active);
      this.closeProjectsMenu(focusInMenu);
    }
    this.renderModals();
    this.initListFocus();
    this.updateListTabIndexes();
    this.listHadFocus = hadFocus;
    this.restoreListFocus();
    // The draft restore must follow restoreListFocus: that call hands focus
    // to the roving-tabindex row, and the rebuilt rename input is where the
    // operator's edit left it - an edit that survives its own repaint must
    // also survive the repaint's focus plumbing.
    this.restoreRenameDraft();
    this.onProjectListRendered?.();
  }

  // The collapsed sidebar's re-expand affordance lives in the TOP BAR
  // (the reference's railCollapsed branch): the rail is removed outright —
  // no icon rail, no width — and the session header grows the control, a
  // 26px button carrying the noisefloor mark at 20px in --evidence with a
  // 1×18 divider after it. Populated on every render so the collapsed
  // flag and the titlebar can never drift apart.
  private renderSidebarExpand(workspace: Element | null): void {
    const expand = workspace?.querySelector<HTMLButtonElement>('[data-region="sidebar-expand"]');
    if (expand === null || expand === undefined) return;
    const divider = workspace?.querySelector<HTMLElement>('[data-region="sidebar-expand-divider"]') ?? null;
    if (!this.collapsed) {
      expand.hidden = true;
      expand.innerHTML = "";
      if (divider !== null) divider.hidden = true;
      return;
    }
    expand.hidden = false;
    expand.innerHTML = markImg();
    if (divider !== null) divider.hidden = false;
    expand.onclick = () => {
      this.setCollapsed(false);
    };
  }

  private setCollapsed(collapsed: boolean): void {
    if (this.collapsed === collapsed) {
      this.render();
      return;
    }
    const phoneSheet = window.matchMedia("(max-width: 600px)").matches
      || this.container.closest('[data-viewport="narrow"]') !== null;
    const restoreFocus = collapsed && phoneSheet && this.container.contains(document.activeElement);
    this.collapsed = collapsed;
    this.render();
    if (restoreFocus) {
      const workspace = this.container.closest("[data-workspace]");
      const sessions = workspace?.querySelector<HTMLElement>("[data-live-sessions], [data-titlebar-sessions]");
      const trigger = sessions?.getClientRects().length ? sessions
        : workspace?.querySelector<HTMLElement>('[data-region="sidebar-expand"]');
      trigger?.focus();
    }
  }

  private filteredGroups() {
    // Alphabetical by default (handoff: "Project rows sort: alphabetical"),
    // with the operator's menu-built order applied on top once it exists —
    // the model's server order is left untouched either way. The id order
    // comes from presentedProjectOrder so the rendered rows and the menu
    // moves seed from one shared sequence.
    const order = presentedProjectOrder(this.model.groups, this.projectOrder);
    const position = new Map(order.map((id, index) => [id, index]));
    const groups = [...this.model.groups].sort((a, b) =>
      (position.get(a.project.id) ?? Number.MAX_SAFE_INTEGER)
        - (position.get(b.project.id) ?? Number.MAX_SAFE_INTEGER));
    const q = this.search.trim().toLowerCase();
    if (q === "") return groups;
    return groups.filter(
      (g) => g.project.name.toLowerCase().includes(q) ||
        g.project.canonical_path.toLowerCase().includes(q) ||
        g.sessions.some((session) =>
          (session.display_name || providerDisplayName(session.provider)).toLowerCase().includes(q)),
    );
  }

  private bind(): void {
    const m = this.model;
    this.container.querySelector("[data-collapse]")?.addEventListener("click", () => {
      this.setCollapsed(true);
    });
    // The sheet's X is the same gesture as the desktop collapse: the list
    // leaves and the workspace stands.
    this.container.querySelector("[data-sidebar-sheet-close]")?.addEventListener("click", () => {
      this.setCollapsed(true);
    });
    this.container.querySelector("[data-sidebar-sheet-menu]")?.addEventListener("click", () => {
      this.openProjectsMenu();
    });
    // The sheet's filter drives the same search the group filter already
    // reads; the partial redraw leaves the field and its caret alone.
    {
      const filter = this.container.querySelector<HTMLInputElement>("[data-sheet-filter]");
      filter?.addEventListener("input", () => {
        this.search = filter.value;
        this.renderProjectList();
      });
    }
    // The sheet's bar carries the PROJECTS menu's actions at this width.
    this.container.querySelector("[data-sheet-new-session]")?.addEventListener("click", () => {
      const target = this.newSessionTarget();
      if (target === null) return;
      this.modalReturnSelector = "[data-sheet-new-session]";
      this.openNewSession(target.id);
    });
    this.container.querySelector("[data-sheet-open-project]")?.addEventListener("click", () => {
      // Focus returns to the cell that opened the dialog; the desktop's
      // default names the eyebrow, which this width does not render.
      this.openNewProject("[data-sheet-open-project]");
    });
    // The overlay's scrim dismisses it, the way every other overlay here
    // dismisses. It lives outside this container (workspace level), so
    // it is bound once against the workspace, not the sidebar subtree.
    const scrim = this.container.closest("[data-workspace]")
      ?.querySelector<HTMLElement>('[data-region="sidebar-scrim"]');
    if (scrim !== null && scrim !== undefined && this.scrimHandler === null) {
      this.scrimHandler = () => {
        this.setCollapsed(true);
      };
      scrim.addEventListener("click", this.scrimHandler);
    }
    this.container.querySelectorAll<HTMLButtonElement>("[data-projects-menu]").forEach((button) => {
      button.addEventListener("click", () => {
        this.mountProjectsHeaderMenu(button);
      });
    });
    this.container.querySelectorAll<HTMLButtonElement>("[data-clone-row]").forEach((button) => {
      button.addEventListener("click", () => {
        const job = this.cloneJobs.find((j) => j.id === button.dataset.cloneRow);
        if (job !== undefined) this.reopenClone(job);
      });
    });
    this.container.querySelectorAll<HTMLButtonElement>("[data-new-project-row]").forEach((button) => {
      button.addEventListener("click", () => {
        this.openNewProject("[data-new-project-row]");
      });
    });
    this.bindGroups();
    this.bindListKeyboard();
  }

  // renderProjectList redraws the project groups without touching the
  // search field or the surrounding chrome, so typing keeps focus and the
  // caret exactly where the operator left them.
  private renderProjectList(): void {
    this.maybeApplyLayout();
    // This partial redraw owns the list rows only; the no-project rail
    // also removes the Projects header, which lives outside the list, so
    // the empty case needs the full render.
    if (this.model.groups.length === 0) {
      this.render();
      return;
    }
    const list = this.container.querySelector("[data-project-list]");
    if (list === null) return;
    // Every render passes through here, so the saved project colours are
    // re-applied where a model refresh's rebuilt groups cannot lose them.
    // The presented row order rides the same call so the auto tints
    // follow the rail in exactly the sequence drawn here.
    this.model.applyProjectColors(
      this.projectColors,
      presentedProjectOrder(this.model.groups, this.projectOrder),
    );
    // The list rebuild re-derives every row's meta below, so the recorded
    // map is rebuilt from the sessions still presented — same prune a full
    // render() does, or entries for dropped sessions linger until one.
    this.sessionMetaWritten.clear();
    const hadFocus = this.listHadFocus;
    this.replaceRailMarkup(list, this.filteredGroups()
      .map((g) => this.renderGroup(g.project.id))
      .join(""));
    // This write repaints list rows without staging the chrome around
    // them, so the container now matches no single render's output; drop
    // the cached markup or the next unchanged-looking render() skips over
    // rows only this method repainted.
    this.renderedMarkup = null;
    this.bindGroups();
    this.initListFocus();
    this.updateListTabIndexes();
    this.listHadFocus = hadFocus;
    this.restoreListFocus();
    // As in render(): the draft restore comes last, past the focus plumbing
    // that would otherwise leave the row, not the rebuilt input, holding
    // focus.
    this.restoreRenameDraft();
    this.onProjectListRendered?.();
  }

  private bindGroups(): void {
    const m = this.model;
    for (const button of this.container.querySelectorAll<HTMLButtonElement>("[data-project-menu]")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this.mountProjectMenu(button.getAttribute("data-project-menu")!, button);
      });
    }
    for (const button of this.container.querySelectorAll<HTMLButtonElement>("[data-session-menu]")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this.mountSessionMenu(button.dataset.sessionMenu!, button);
      });
    }
    for (const input of this.container.querySelectorAll<HTMLInputElement>("[data-rename-project-input]")) {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          // The keystroke is the commit, and nothing else may act on it.
          // The re-render below restores focus to the project toggle, and
          // an unconsumed Enter would deliver its default activation to
          // that button - committing a rename must not also toggle the row.
          event.preventDefault();
          const id = this.renamingProject;
          this.renamingProject = null;
          this.render();
          if (id !== null) {
            void this.model.renameProject(id, input.value.trim()).then(() => {
              if (!this.disposed) this.render();
            });
          }
        } else if (event.key === "Escape") {
          this.renamingProject = null;
          this.render();
        }
      });
      // Blur ends the edit, or the header keeps rendering the field and every
      // later click on the row lands on an input the operator has already left
      // — the chevron stops expanding because the chevron is not there.
      //
      // The repaint waits, for the reason the session rename documents: a
      // mousedown on another sidebar control fires this blur, and re-rendering
      // now would destroy that click's target mid-dispatch, costing the
      // operator a second click.
      input.addEventListener("blur", () => {
        // The sidebar's own markup replacement fires this blur by removing
        // the input; that teardown is not an acceptance, and treating it as
        // one writes the half-typed draft every time a background poll
        // repaints the rail mid-edit. Only the operator's blur - clicking
        // away, tabbing out - ends the edit below.
        if (this.railTeardown) return;
        if (this.renamingProject === null) return;
        const id = this.renamingProject;
        this.renamingProject = null;
        let pending = true;
        let onClick: () => void;
        const cleanup = (): void => {
          clearTimeout(timer);
          document.removeEventListener("click", onClick, true);
        };
        // Nothing repaints until the click that caused this blur has
        // dispatched, or until the timeout says none is coming. A rename that
        // resolves first must not open the gate early: the fixture and a warm
        // cache both settle inside the same tick, and repainting then destroys
        // the click's target before it lands.
        const timer = setTimeout(() => openGate(), 300);
        onClick = (): void => { setTimeout(() => openGate(), 0); };
        const paint = (): void => {
          if (this.disposed) return;
          this.render();
        };
        const openGate = (): void => {
          if (!pending) return;
          pending = false;
          cleanup();
          paint();
        };
        document.addEventListener("click", onClick, true);
        // An unchanged name is not an edit: leaving the field closes it and
        // writes nothing, so clicking away cannot spend a request or land a
        // second rename on a row the operator never retyped.
        const next = input.value.trim();
        const current = this.model.groups.find((g) => g.project.id === id)?.project.name ?? "";
        if (next === "" || next === current) return;
        // The second paint is what shows the committed name; it runs only once
        // the gate is open, so a fast rename cannot pre-empt the click.
        void this.model.renameProject(id, next).then(() => {
          if (!pending) paint();
        });
      });
    }
    for (const button of this.container.querySelectorAll("[data-project-toggle]")) {
      button.addEventListener("click", () => {
        this.expansionTouched = true;
        const id = button.getAttribute("data-project-toggle")!;
        this.selectedProjectID = id;
        this.contextProjectID = id;
        if (this.expandedProjects.has(id)) this.expandedProjects.delete(id);
        else this.expandedProjects.add(id);
        this.saveLayout();
        this.renderProjectList();
        // Re-render replaces the button; return focus to its successor.
        this.container.querySelector<HTMLElement>(`[data-project-toggle="${CSS.escape(id)}"]`)?.focus();
      });
    }
    this.bindSessionDrag();
    for (const g of m.groups) {
      const el = this.container.querySelector<HTMLElement>(
        `[data-project="${CSS.escape(g.project.id)}"]`,
      );
      if (!el) continue;
      el.querySelectorAll<HTMLElement>("[data-session]").forEach((s) => {
        s.addEventListener("click", () => {
          // A tap while any row rests swiped-open is the tap-away that
          // closes it, never a selection.
          if (this.openSwipeID !== null) {
            this.setSwipeOpen(null);
            return;
          }
          this.selectSession(s.dataset.session!, false);
        });
        this.bindSessionSwipe(s);
      });
      el.querySelectorAll<HTMLInputElement>("[data-rename-input]").forEach((input) => {
        input.addEventListener("click", (event) => event.stopPropagation());
        // Commit ends the edit and posts the label; the row re-renders from
        // the server's truth. renamingSession is cleared before the input is
        // removed, so a commit that replaces the input (Enter) can never
        // double-fire through the input's own blur.
        const commit = (restoreFocus: boolean): void => {
          const id = this.renamingSession;
          if (id === null) return;
          const returnSelector = this.renameSessionReturnSelector;
          this.renamingSession = null;
          this.renameSessionReturnSelector = null;
          this.render();
          void this.model.rename(id, input.value.trim()).then(() => {
            if (!this.disposed) {
              this.render();
              if (restoreFocus) this.restoreSessionActionFocus(returnSelector);
            }
          });
        };
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            // Consumed for the same reason as the project rename: focus
            // returns to a button, and an unconsumed Enter would activate it.
            event.preventDefault();
            commit(true);
          } else if (event.key === "Escape") {
            const returnSelector = this.renameSessionReturnSelector;
            this.renamingSession = null;
            this.renameSessionReturnSelector = null;
            this.render();
            this.restoreSessionActionFocus(returnSelector);
          }
        });
        // Blur commits the model WITHOUT the synchronous render: a
        // mousedown on another sidebar control fires this blur, and
        // re-rendering now would destroy that click's target mid-dispatch,
        // so the operator would have to click twice. The row repaint waits
        // for the click that caused the blur to finish, or fires promptly
        // when no click follows.
        input.addEventListener("blur", () => {
          // The sidebar's own markup replacement fires this blur by removing
          // the input; that teardown is not an acceptance, and treating it
          // as one writes the half-typed draft every time a background poll
          // repaints the rail mid-edit. Only the operator's blur - clicking
          // away, tabbing out - commits below.
          if (this.railTeardown) return;
          if (this.renamingSession === null) return;
          const id = this.renamingSession;
          this.renamingSession = null;
          this.renameSessionReturnSelector = null;
          let pending = true;
          // cleanup is declared before repaint so no call path can hit a
          // temporal dead zone, and repaint always unwinds the document
          // listener first — a disposed sidebar must not leak a capture
          // listener that queues work on every later click.
          let onClick: () => void;
          const cleanup = (): void => {
            clearTimeout(timer);
            document.removeEventListener("click", onClick, true);
          };
          const timer = setTimeout(() => repaint(), 300);
          onClick = (): void => { setTimeout(() => repaint(), 0); };
          const repaint = (): void => {
            if (!pending) return;
            pending = false;
            cleanup();
            if (this.disposed) return;
            this.render();
          };
          document.addEventListener("click", onClick, true);
          void this.model.rename(id, input.value.trim()).then(repaint);
        });
      });
      // A project with no sessions carries a second new-session control in
      // its empty rail, so bind every one in the group - querySelector would
      // wire only the row's + and leave the empty-state pill dead.
      el.querySelectorAll("[data-new-session]").forEach((control) => {
        control.addEventListener("click", () => {
          this.modalReturnSelector = `[data-project="${CSS.escape(g.project.id)}"] [data-new-session]`;
          this.openNewSession(g.project.id);
        });
      });
    }
  }

  // The sidebar list is a single Tab stop with arrow-key movement inside it.
  // Project rows expand/collapse with Left/Right; Up/Down walk only the rows
  // that are currently visible; Enter or Space on a session selects it without
  // moving focus to the terminal.
  private bindListKeyboard(): void {
    const list = this.container.querySelector<HTMLElement>("[data-project-list]");
    if (list === null) return;
    list.addEventListener("keydown", (event) => {
      const target = event.target as HTMLElement;
      const tag = target.tagName?.toUpperCase();
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }
      const row = target.closest<HTMLElement>("[data-list-row]");
      if (row === null) return;
      // A control inside a row - the session ⋯ trigger, a project action -
      // keeps its own Enter and Space; the list only owns keys sent to the
      // row itself, which is the only element the roving tabindex focuses.
      if (target !== row) return;
      const visible = this.visibleListRows();
      const current = visible.indexOf(row);
      if (current === -1) return;

      let handled = false;
      if (event.key === "ArrowDown") {
        handled = this.focusListRow(visible[current + 1]);
      } else if (event.key === "ArrowUp") {
        handled = this.focusListRow(visible[current - 1]);
      } else if (event.key === "Home") {
        handled = this.focusListRow(visible[0]);
      } else if (event.key === "End") {
        handled = this.focusListRow(visible.at(-1));
      } else if (event.key === "ArrowLeft") {
        handled = this.handleListLeft(row);
      } else if (event.key === "ArrowRight") {
        handled = this.handleListRight(row);
      } else if (event.key === "Enter" || event.key === " ") {
        handled = this.handleListActivate(row);
      }
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
    list.addEventListener("focusin", (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>("[data-list-row]");
      if (row === null) return;
      const identity = this.listRowIdentity(row);
      if (identity === null) return;
      this.listHadFocus = true;
      this.focusedListRow = identity;
      this.updateListTabIndexes();
    });
    list.addEventListener("focusout", (event) => {
      const related = event.relatedTarget as HTMLElement | null;
      if (related !== null && list.contains(related)) return;
      this.listHadFocus = false;
    });
  }

  private visibleListRows(): HTMLElement[] {
    return Array.from(this.container.querySelectorAll<HTMLElement>("[data-list-row]")).filter((row) => {
      if (row.hidden) return false;
      const rail = row.closest<HTMLElement>("ul.session-rail");
      if (rail !== null && rail.hidden) return false;
      return true;
    });
  }

  private listRowIdentity(row: HTMLElement): { kind: "project" | "session"; id: string } | null {
    const projectId = row.getAttribute("data-project-toggle");
    if (projectId !== null) return { kind: "project", id: projectId };
    const sessionId = row.getAttribute("data-session");
    if (sessionId !== null) return { kind: "session", id: sessionId };
    return null;
  }

  private focusListRow(row: HTMLElement | undefined): boolean {
    if (row === undefined) return false;
    row.focus();
    return true;
  }

  private handleListLeft(row: HTMLElement): boolean {
    const identity = this.listRowIdentity(row);
    if (identity?.kind !== "project") return false;
    if (!this.expandedProjects.has(identity.id)) return false;
    this.expansionTouched = true;
    this.selectedProjectID = identity.id;
    this.contextProjectID = identity.id;
    this.expandedProjects.delete(identity.id);
    this.saveLayout();
    this.focusedListRow = identity;
    this.listHadFocus = true;
    this.renderProjectList();
    return true;
  }

  private handleListRight(row: HTMLElement): boolean {
    const identity = this.listRowIdentity(row);
    if (identity?.kind !== "project") return false;
    if (this.expandedProjects.has(identity.id)) return false;
    this.expansionTouched = true;
    this.selectedProjectID = identity.id;
    this.contextProjectID = identity.id;
    this.expandedProjects.add(identity.id);
    this.saveLayout();
    this.focusedListRow = identity;
    this.listHadFocus = true;
    this.renderProjectList();
    return true;
  }

  private handleListActivate(row: HTMLElement): boolean {
    const identity = this.listRowIdentity(row);
    if (identity?.kind !== "session") return false;
    this.selectSession(identity.id, true);
    return true;
  }

  private selectSession(sessionID: string, restoreFocus: boolean): void {
    if (this.renamingSession === sessionID) return;
    // Context comes from where the row sits, not from whether selecting it
    // worked: attachability is not parentage. A row that names no project
    // leaves the previous context standing — clearing it and installing
    // nothing would send New session to the first project in the list.
    const owner = this.projectOfSession(sessionID);
    if (owner !== null) {
      this.selectedProjectID = null;
      this.contextProjectID = owner;
    }
    if (!this.model.select(sessionID, restoreFocus)) return;
    if (typeof window !== "undefined" && dismissOnSelect(window.matchMedia(MOBILE_QUERY).matches)) {
      this.setCollapsed(true);
      return;
    }
    if (restoreFocus) {
      this.focusedListRow = { kind: "session", id: sessionID };
      this.listHadFocus = true;
    }
    this.render();
  }

  private initListFocus(): void {
    if (this.focusedListRow !== null) return;
    const selectedSession = this.model.selectedSessionID;
    if (selectedSession !== null) {
      this.focusedListRow = { kind: "session", id: selectedSession };
    } else {
      const firstProject = this.container.querySelector<HTMLElement>("[data-project-toggle]");
      const id = firstProject?.getAttribute("data-project-toggle");
      if (id !== null && id !== undefined) this.focusedListRow = { kind: "project", id };
    }
  }

  private updateListTabIndexes(): void {
    const visible = this.visibleListRows();
    let focusedEl: HTMLElement | null = null;
    if (this.focusedListRow !== null) {
      const selector = this.focusedListRow.kind === "project"
        ? `[data-project-toggle="${CSS.escape(this.focusedListRow.id)}"]`
        : `[data-session="${CSS.escape(this.focusedListRow.id)}"]`;
      const candidate = this.container.querySelector<HTMLElement>(selector);
      if (candidate !== null && visible.includes(candidate)) {
        focusedEl = candidate;
      }
    }
    if (focusedEl === null && visible.length > 0) {
      const first = visible[0]!;
      focusedEl = first;
      const identity = this.listRowIdentity(first);
      if (identity !== null) this.focusedListRow = identity;
    }
    for (const row of this.container.querySelectorAll<HTMLElement>("[data-list-row]")) {
      row.setAttribute("tabindex", row === focusedEl ? "0" : "-1");
    }
  }

  private restoreListFocus(): void {
    if (!this.listHadFocus) return;
    const focused = this.container.querySelector<HTMLElement>("[data-list-row][tabindex=\"0\"]");
    focused?.focus();
  }

  // The phone rows' swipe-to-close (comp mobile-r8 screen 02).
  // One row rests open at a time; the shell paints travel inline mid-drag
  // and lets the stylesheet's 180ms park the end states. Everything here
  // is inert on the desktop: the surface is display:contents there, so a
  // drag never claims and the classes paint nothing.
  private openSwipeID: string | null = null;
  private swipeGesture = new SessionSwipeGesture();
  private swipePointerRow: HTMLElement | null = null;

  private swipeSurface(row: HTMLElement): HTMLElement | null {
    return row.querySelector<HTMLElement>("[data-session-swipe-surface]");
  }

  private setSwipeOpen(id: string | null): void {
    this.openSwipeID = id;
    for (const row of this.container.querySelectorAll<HTMLElement>("[data-session]")) {
      const open = id !== null && row.dataset.session === id;
      const wasPromoted = row.classList.contains("swipe-open")
        || row.classList.contains("swipe-dragging");
      row.classList.toggle("swipe-open", open);
      row.classList.remove("swipe-dragging");
      const surface = this.swipeSurface(row);
      surface?.style.removeProperty("right");
      // Closing glides home before the surface demotes to layout
      // transparency: dropping straight to display:contents skips the
      // 180ms and reads as a snap. The closing class keeps the surface
      // promoted at right:0 until its transition settles.
      if (!open && wasPromoted && surface !== null) {
        row.classList.add("swipe-closing");
        const done = (): void => {
          surface.removeEventListener("transitionend", done);
          row.classList.remove("swipe-closing");
        };
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          done();
        } else {
          surface.addEventListener("transitionend", done);
          setTimeout(done, 250);
        }
      }
    }
  }

  private bindSessionSwipe(row: HTMLElement): void {
    const id = row.dataset.session!;
    row.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "touch") return;
      this.swipePointerRow = row;
      this.swipeGesture.begin(event.clientX, event.clientY, this.openSwipeID === id);
    });
    row.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "touch" || this.swipePointerRow !== row) return;
      const state = this.swipeGesture.move(event.clientX, event.clientY);
      if (state.phase !== "dragging") return;
      if (!row.classList.contains("swipe-dragging")) {
        row.classList.add("swipe-dragging");
        row.classList.remove("swipe-closing");
        // The row owns the claimed drag even when the finger drifts off
        // it: without capture the move stream stops at the row's edge and
        // the surface freezes mid-travel. Synthetic probe events carry no
        // capturable pointer, so the refusal is tolerated.
        try {
          row.setPointerCapture(event.pointerId);
        } catch {
          // A probe-dispatched event has no active pointer to capture.
        }
      }
      const surface = this.swipeSurface(row);
      if (surface !== null) surface.style.right = `${state.travel}px`;
    });
    const settle = (event: PointerEvent): void => {
      if (event.pointerType !== "touch" || this.swipePointerRow !== row) return;
      this.swipePointerRow = null;
      const wasDragging = row.classList.contains("swipe-dragging");
      const open = this.swipeGesture.end(event.clientX);
      this.setSwipeOpen(open ? id : this.openSwipeID === id ? null : this.openSwipeID);
      // A drag that just settled must not fall through to the click
      // handler as a selection or tap-away.
      if (wasDragging) {
        const swallow = (clickEvent: Event): void => clickEvent.stopPropagation();
        row.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => row.removeEventListener("click", swallow, { capture: true }), 0);
      }
    };
    row.addEventListener("pointerup", settle);
    row.addEventListener("pointercancel", () => {
      if (this.swipePointerRow !== row) return;
      this.swipePointerRow = null;
      this.swipeGesture.cancel();
      this.setSwipeOpen(this.openSwipeID);
    });
    row.querySelector<HTMLButtonElement>("[data-session-swipe-close]")
      ?.addEventListener("click", (event) => {
        event.stopPropagation();
        this.setSwipeOpen(null);
        const target = this.sessionRemovalTarget(id);
        if (target === null) return;
        // The confirm returns focus to the row itself: the sheet has no
        // menu trigger to hand back to.
        this.modalReturnSelector = `[data-session="${CSS.escape(id)}"]`;
        if (!confirmsBeforeClose(this.skipCloseConfirm)) {
          void this.attemptRemove(target);
          return;
        }
        this.removeConfirm = target;
        this.renderModals();
      });
  }

  private clearDropHints(): void {
    for (const element of this.container.querySelectorAll<HTMLElement>(
      ".project-row-drop-gap-before, .project-row-drop-gap-after",
    )) {
      element.classList.remove("project-row-drop-gap-before", "project-row-drop-gap-after");
    }
  }

  // The session row is draggable for reorder within its own project rail
  // (handoff §7). The gesture is scoped to the rail it started in: the
  // rail's dragover and drop handlers ignore a drag from another project,
  // so dragging a session into a different project drops nowhere and the
  // row returns. The dragstart stops propagation so the gesture stays the
  // rail's own; project rows are not draggable at all. The rail
  // itself accepts the drop — the gap is the target row's own margin and a
  // margin is not a hit target, so the pointer can sit over the rail at
  // exactly the slot the gap shows — and the slot is resolved against the
  // dragstart geometry (rowDropSlot), not the rows the gap shifted.
  private bindSessionDrag(): void {
    for (const rail of this.container.querySelectorAll<HTMLElement>(".session-rail")) {
      const pid = (rail.getAttribute("id") ?? "").replace("sessions-", "");
      if (pid === "") continue;
      rail.addEventListener("dragleave", (event) => {
        if (this.dragSession === null) return;
        const related = event.relatedTarget as Node | null;
        if (related !== null && rail.contains(related)) return;
        this.clearDropHints();
        this.dropTargetSession = null;
        this.dropAfter = false;
      });
      rail.addEventListener("dragover", (event) => {
        const drag = this.dragSession;
        if (drag === null || drag.pid !== pid) return;
        event.stopPropagation();
        this.sessionDragBoxes = refreshDragBoxes(
          rail, "[data-session]", (row) => row.dataset.session!, this.sessionDragBoxes);
        const slot = rowDropSlot(this.sessionDragBoxes, event.clientY, drag.id);
        if (slot === null) {
          // Over the source row's own box, or below the last row: no slot
          // to offer, and no drop to accept.
          if (this.dropTargetSession !== null) {
            this.dropTargetSession = null;
            this.dropAfter = false;
            this.clearDropHints();
          }
          return;
        }
        event.preventDefault();
        const transfer = (event as DragEvent).dataTransfer;
        if (transfer !== null) transfer.dropEffect = "move";
        if (this.dropTargetSession !== slot.id || this.dropAfter !== slot.after) {
          this.clearDropHints();
          rail.querySelector<HTMLElement>(`[data-session="${CSS.escape(slot.id)}"]`)
            ?.classList.add(slot.after ? "project-row-drop-gap-after" : "project-row-drop-gap-before");
          this.dropTargetSession = slot.id;
          this.dropAfter = slot.after;
        }
      });
      rail.addEventListener("drop", (event) => {
        const from = this.dragSession;
        if (from === null || from.pid !== pid) return;
        // Like the project drop: the slot comes from the release point, not
        // the remembered target, so a mid-drag render that removed the
        // remembered row cannot turn the release into an append of the
        // source, and a gap whose row is gone commits nothing.
        this.sessionDragBoxes = refreshDragBoxes(
          rail, "[data-session]", (row) => row.dataset.session!, this.sessionDragBoxes);
        const slot = rowDropSlot(this.sessionDragBoxes, event.clientY, from.id);
        if (slot === null) return;
        event.preventDefault();
        event.stopPropagation();
        const group = this.model.groups.find((g) => g.project.id === pid);
        if (group === undefined) return;
        this.sessionOrder = {
          ...this.sessionOrder,
          [pid]: moveSessionRelative(
            presentedSessionOrder(group.sessions, this.sessionOrder[pid] ?? null),
            from.id,
            slot.id,
            slot.after,
          ),
        };
        this.dragSession = null;
        this.sessionDragBoxes = null;
        this.dropTargetSession = null;
        this.dropAfter = false;
        this.clearDropHints();
        this.saveLayout();
        this.renderProjectList();
      });
      for (const row of rail.querySelectorAll<HTMLElement>("[data-session]")) {
        const id = row.dataset.session!;
        row.addEventListener("dragstart", (event) => {
          event.stopPropagation();
          const transfer = (event as DragEvent).dataTransfer;
          if (transfer !== null) {
            transfer.effectAllowed = "move";
            transfer.setData("text/plain", id);
          }
          this.dragSession = { id, pid };
          this.dropTargetSession = null;
          this.dropAfter = false;
          this.sessionDragBoxes = dragRowBoxes(
            Array.from(rail.querySelectorAll<HTMLElement>("[data-session]")),
            (r) => r.dataset.session!,
          );
          row.classList.add("project-row-drag");
        });
        row.addEventListener("dragend", () => {
          if (this.dragSession === null && this.dropTargetSession === null) return;
          this.dragSession = null;
          this.sessionDragBoxes = null;
          this.dropTargetSession = null;
          this.dropAfter = false;
          this.clearDropHints();
          this.renderProjectList();
        });
      }
    }
  }

  private sessionRemovalTarget(id: string): SessionRemovalTarget | null {
    for (const group of this.model.groups) {
      const session = group.sessions.find((candidate) => candidate.id === id);
      if (session !== undefined) {
        return {
          id,
          label: session.display_name || providerDisplayName(session.provider),
          projectID: group.project.id,
          projectName: group.project.name,
          meta: `${providerDisplayName(session.provider)} · ${group.project.canonical_path}`,
          color: session.color,
        };
      }
    }
    return null;
  }

  private async attemptRemove(target: SessionRemovalTarget): Promise<void> {
    const removed = await this.model.remove(target.id);
    if (this.disposed) return;
    this.removingSession = false;
    this.removeConfirm = null;
    if (removed) {
      this.modalReturnSelector = `[data-project-toggle="${CSS.escape(target.projectID)}"]`;
    }
    this.render();
  }

  // The project-row ⋯ menu: the same shared mount path as the
  // session menu — rowMenuHtml on the app's anchored-popover idiom, with
  // the backdrop click-away and Escape dismissal mountRowMenu provides.
  // The commit-and-close verbs route to the existing flows: Open preview's
  // tab-and-ticket entry, inline rename, the project's
  // git-identity setup, and the remove-from-sidebar confirmation modal,
  // whose copy shows the path. Position rows instead redraw
  // the rail and leave this panel mounted.
  async openProjectPreviewSettings(projectID: string): Promise<ProjectPreviewSettingsDialog | null> {
    const project = this.model.groups.find((group) => group.project.id === projectID)?.project;
    if (project === undefined || this.disposed) return null;
    this.previewDialog?.close(false);
    const region = this.container.closest("[data-workspace]")?.querySelector<HTMLElement>('[data-region="modals"]') ?? this.container;
    const dialog = new ProjectPreviewSettingsDialog(region, this.model.api, projectID, project.name, () => {
      this.container.querySelector<HTMLButtonElement>(`[data-project-menu="${CSS.escape(projectID)}"]`)?.focus();
    });
    this.previewDialog = dialog;
    dialog.model.onObservation = (observation) => {
      this.previewObservations.remember(projectID, dialog.model.settings, observation);
    };
    await dialog.model.load();
    if (this.disposed || this.previewDialog !== dialog) return null;
    if (dialog.model.settings !== null) {
      const observation = this.previewObservations.get(projectID, dialog.model.settings);
      if (observation !== null) {
        dialog.model.check = observation.check;
        dialog.model.checkFailed = observation.checkFailed;
        dialog.model.changed();
      }
    }
    return dialog;
  }

  private mountProjectMenu(projectID: string, anchor: HTMLButtonElement): void {
    this.mountRowMenu(anchor, "project", (bind, menu, close) => {
      for (const move of ["up", "down", "top"] as const) {
        menu.querySelector<HTMLButtonElement>(`[data-project-menu-move-${move}]`)
          ?.addEventListener("click", () => this.moveProjectFromMenu(projectID, move, menu));
      }
      const wirePreview = (): void => {
        // The opener runs inside the click; awaiting settings here loses the
        // browser gesture and can block the isolated preview tab.
        bind("project-menu-preview", () => {
          openProjectPreview(projectID, this.model.api, (message, cause) => {
            if (this.disposed) return;
            this.model.previewFailed(message, cause);
            this.render();
          });
        });
        bind("project-menu-preview-settings", () => { void this.openProjectPreviewSettings(projectID); });
      };
      wirePreview();
      void this.model.api.getProjectPreviewSettings?.(projectID).then((settings) => {
        if (this.disposed || !menu.isConnected) return;
        const group = menu.querySelector<HTMLElement>("[data-project-preview-actions]");
        if (group === null) return;
        const hadFocus = group.contains(document.activeElement);
        group.innerHTML = projectPreviewMenuHtml(settings, this.previewObservations.get(projectID, settings));
        wirePreview();
        if (hadFocus) group.querySelector<HTMLButtonElement>("button")?.focus();
        const row = this.container.querySelector(`[data-project="${CSS.escape(projectID)}"] [class~="group/project"]`);
        if (row !== null) this.positionRowMenu(row, menu);
      }).catch(() => {
        // Preview… still opens the dialog, which reports the failed read.
      });
      bind("project-menu-rename", () => {
        this.startInlineRename({ kind: "project", id: projectID }, null);
      });
      bind("project-menu-identity", () => {
        const project = this.model.groups.find((group) => group.project.id === projectID)?.project;
        if (project === undefined) return;
        this.projectIdentitySetup = {
          projectID,
          profileID: project.git_identity_profile_id ?? this.defaultGitIdentity()?.id ?? "",
          retryProvider: null,
          retryAttempted: false,
        };
        this.renderModals();
      });
      bind("project-menu-remove", () => {
        if (this.selectedProjectID === projectID) this.selectedProjectID = null;
        if (this.contextProjectID === projectID) this.contextProjectID = null;
        this.modalReturnSelector = `[data-project-menu="${CSS.escape(projectID)}"]`;
        const g = this.model.groups.find((x) => x.project.id === projectID);
        if (g !== undefined) {
          if (this.skipRemoveProjectConfirm === true) {
            void this.model.removeProject(projectID).then(() => {
              if (!this.disposed) this.render();
            });
            return;
          }
          this.removeProjectConfirm = {
            id: projectID,
            name: g.project.name,
            path: g.project.canonical_path,
            live: g.sessions.filter((s) => s.status === "starting" || s.status === "running").length,
          };
        }
        this.renderModals();
      });
      // A swatch pick commits and closes, unlike the repeatable position rows.
      for (const swatch of menu.querySelectorAll<HTMLButtonElement>("[data-proj-swatch]")) {
        swatch.addEventListener("click", () => {
          close(false);
          const color = swatch.dataset.projSwatch === "none" ? null : swatch.dataset.projSwatch!;
          // The pick outlives the groups: the map is the durable side, the
          // model write paints it now, and the document persists it.
          if (color === null) delete this.projectColors[projectID];
          else this.projectColors[projectID] = color;
          void this.model.setProjectColor(projectID, color).then(() => {
            if (!this.disposed) {
              this.saveLayout();
              this.render();
            }
          });
        });
      }
      const applyColor = menu.querySelector<HTMLButtonElement>("[data-project-menu-apply-color]");
      applyColor?.addEventListener("click", () => {
        close(false);
        void this.model.applyProjectColorToSessions(projectID).then(() => {
          if (!this.disposed) this.render();
        });
      });
    });
  }

  private projectRowMenuState(projectID: string): ProjectRowMenuState {
    const order = presentedProjectOrder(this.model.groups, this.projectOrder);
    const index = order.indexOf(projectID);
    const group = this.model.groups.find((candidate) => candidate.project.id === projectID);
    return {
      name: group?.project.name,
      operatorColor: operatorProjectColorKey(group?.color),
      canMoveUp: index > 0,
      canMoveDown: index !== -1 && index < order.length - 1,
    };
  }

  private updateProjectMoveRows(menu: HTMLElement, projectID: string): void {
    const state = this.projectRowMenuState(projectID);
    for (const [move, enabled] of [
      ["up", state.canMoveUp],
      ["down", state.canMoveDown],
      ["top", state.canMoveUp],
    ] as const) {
      const row = menu.querySelector<HTMLButtonElement>(`[data-project-menu-move-${move}]`);
      if (row === null) continue;
      if (enabled) row.removeAttribute("aria-disabled");
      else row.setAttribute("aria-disabled", "true");
      const { hint, blocked } = projectMoveHints(move);
      row.setAttribute("data-hint", enabled ? hint : blocked);
      // The info bar prints the hint the focused row carried when focus
      // landed on it; rewriting data-hint under that focus leaves the strip
      // naming a verb the row no longer offers ("Swap places…" over a row
      // that is now last). No focus change follows, so the bar never
      // re-reads the attribute on its own. Re-announce on the bar's one
      // update path — its delegated focusin listener — rather than adding a
      // second channel that could drift from it.
      if (row.matches(":focus")) row.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    }
  }

  private moveProjectFromMenu(
    projectID: string,
    move: ProjectMove,
    menu: HTMLElement,
  ): void {
    const order = presentedProjectOrder(this.model.groups, this.projectOrder);
    const next = move === "top"
      ? moveProjectToTop(order, projectID)
      : moveProjectOneStep(order, projectID, move);
    if (next.every((id, index) => id === order[index])) return;
    this.projectOrder = next;
    this.saveLayout();
    this.renderProjectList();
    this.container.querySelector<HTMLButtonElement>(`[data-project-menu="${CSS.escape(projectID)}"]`)
      ?.setAttribute("aria-expanded", "true");
    this.updateProjectMoveRows(menu, projectID);
  }

  // The session-row ⋯ menu: the same surface and mount path as
  // the project menu. The colour strip picks the tag in place; Rename runs
  // inline in the row; the Close verb ends the session's process with the
  // recording kept, behind the confirmation the console setting gates.
  private mountSessionMenu(sessionID: string, anchor: HTMLButtonElement): void {
    this.mountRowMenu(anchor, "session", (bind, menu, close) => {
      bind("session-menu-rename", () => {
        this.startInlineRename(
          { kind: "session", id: sessionID },
          `[data-session-menu="${CSS.escape(sessionID)}"]`,
        );
      });
      // A swatch pick is a commit, not a submenu: the menu closes and the
      // tag posts, exactly like the comp's sw.pick. "none" clears the tag.
      for (const swatch of menu.querySelectorAll<HTMLButtonElement>("[data-sess-swatch]")) {
        swatch.addEventListener("click", () => {
          close(false);
          const color = swatch.dataset.sessSwatch === "none" ? null : swatch.dataset.sessSwatch!;
          void this.model.setSessionColor(sessionID, color).then(() => {
            if (!this.disposed) this.render();
          });
        });
      }
      bind("session-menu-close", () => {
        const target = this.sessionRemovalTarget(sessionID);
        if (target === null) return;
        this.modalReturnSelector = `[data-session-menu="${CSS.escape(sessionID)}"]`;
        if (!confirmsBeforeClose(this.skipCloseConfirm)) {
          void this.attemptRemove(target);
          return;
        }
        this.removeConfirm = target;
        this.renderModals();
      });
    });
  }

  // positionRowMenu places a row menu relative to its row's viewport rect.
  // The popover region is fixed to the viewport, so a menu hanging below the
  // last session or project row is clipped by the bottom of the screen and
  // its actions cannot be clicked at all. Such a menu opens upward instead,
  // when the space above holds it.
  private positionRowMenu(row: Element, menu: HTMLElement): void {
    const rect = row.getBoundingClientRect();
    // The comp overlaps the menu onto the row's edge by 2px; a flipped menu
    // mirrors that onto the top edge.
    const overlap = 2;
    // A re-place after scroll or resize re-measures: a cap left over from
    // the last placement would report the capped height as the menu's own.
    menu.style.maxHeight = "";
    menu.style.overflowY = "";
    const height = menu.offsetHeight;
    const viewport = window.innerHeight;
    // Compare the edges each placement would produce, so a menu that clears
    // the bottom by a pixel is not flipped for nothing.
    const downwardTop = rect.bottom - overlap;
    const upwardTop = rect.top + overlap - height;
    // The DOM-free unit fakes report zero dimensions, and a zero-height menu
    // overflows nothing.
    const flip = height > 0 && viewport > 0
      && downwardTop + height > viewport && upwardTop >= 0;
    let top = flip ? upwardTop : downwardTop;
    // The chosen placement still overflows — neither edge holds the menu
    // under a short phone viewport, or the row scrolled or resized past an
    // edge after the menu opened — so the menu is pinned inside the viewport
    // with the edge inset the sidebar menus keep, and scrolls within itself
    // when even that is too tall. Its last row has to be reachable, or the
    // row is a lie.
    if (height > 0 && viewport > 0 && (top + height > viewport || top < 0)) {
      const capped = Math.min(height, viewport - 16);
      top = Math.min(Math.max(top, 8), Math.max(8, viewport - capped - 8));
      menu.style.maxHeight = `${viewport - 16}px`;
      menu.style.overflowY = "auto";
    }
    menu.style.top = `${top}px`;
    menu.style.left = `${Math.max(8, rect.right - menu.offsetWidth)}px`;
  }

  // mountRowMenu is the ONE open path for the sidebar's row menus (task
  // 306): the shared rowMenuHtml surface on the app's anchored-popover
  // idiom — the panel mounts in the workspace's popover region behind a
  // full-viewport transparent click-catcher, and dismissal is a backdrop
  // click or Escape, both of which return focus to the trigger. A row menu
  // hangs from its row, not from the control that opened it: the comp places
  // the menu inside the row with bottom/right edges flush to the row (minus
  // the 2px overlap), and the trigger is just a 3px-inset button inside that
  // row. We translate that to the viewport-fixed popover region by measuring
  // the row rect and right-aligning the menu to it, clamped 8px from the
  // viewport left.
  // An action click closes without restoring focus — the action's own
  // flow takes it (inline rename selects its input; the dialogs return
  // through modalReturnSelector).

  private mountRowMenu(
    anchor: HTMLButtonElement,
    kind: RowMenuKind,
    wire: (
      bind: (action: string, run: () => void) => void,
      menu: HTMLElement,
      close: (restoreFocus: boolean) => void,
    ) => void,
  ): void {
    const id = anchor.dataset[`${kind}Menu`] ?? "";
    const popovers = this.popoverRegion();
    if (popovers === null) return;
    // Mounting replaces any open popover wholesale; reset that trigger's
    // state first, while its anchor is still reachable.
    for (const trigger of this.container.querySelectorAll<HTMLButtonElement>(
      '[aria-haspopup="menu"][aria-expanded="true"]',
    )) {
      trigger.setAttribute("aria-expanded", "false");
    }
    // Resolve the row from the document by id, not by walking up from the
    // trigger: the trigger may already be detached at mount time, and
    // falling back to its rect would place the menu 2px high. The project
    // row is the div inside the <li data-project> wrapper; the <li> also
    // contains the expanded session list, so its bottom is not the row's.
    const row = kind === "session"
      ? this.container.querySelector<HTMLElement>(`[data-session="${CSS.escape(id)}"]`)
      : this.container.querySelector<HTMLElement>(`[data-project="${CSS.escape(id)}"] [class~="group/project"]`);
    if (row === null) {
      this.openRowMenuTarget = null;
      return;
    }
    this.openRowMenuTarget = { kind, id };
    // The row menu's strip marks the current tag, so it renders from the
    // row's own colour — the session's stored tag or the project's locally
    // set colour.
    const currentColor = kind === "session"
      ? this.findSession(id)?.color ?? null
      : this.model.groups.find((g) => g.project.id === id)?.color ?? null;
    const projectState = kind === "project" ? this.projectRowMenuState(id) : undefined;
    // Release the menus this mount replaces before their markup goes: the
    // previous row menu's listeners, and the header menu through its full
    // close path — a stale projectsMenuAnchor would let the next render
    // unmount the row menu that replaced it.
    this.closeProjectsMenu(false);
    this.rowMenuTeardown?.();
    this.rowMenuTeardown = null;
    popovers.innerHTML = `<div class="absolute inset-0${kind === "project" ? " project-menu-sheet-backdrop" : ""}" data-popover-backdrop>${rowMenuHtml(kind, currentColor, projectState)}</div>`;
    const backdrop = popovers.querySelector<HTMLElement>("[data-popover-backdrop]")!;
    const menu = backdrop.querySelector<HTMLElement>("[role=menu]")!;
    // The menu is placed in viewport coordinates while its row moves with
    // the layout, so one measurement goes stale on the first scroll or
    // resize and the menu is left running off the viewport edge with its
    // actions unreachable: every scroll that carries the row (its own
    // scroll container, or the document) and every window resize re-place
    // the menu, and a row detached by a re-render closes the menu rather
    // than leaving it pinned to a dead node. Scrolls elsewhere — a
    // streaming terminal, say — never move the row and are ignored.
    const place = (): void => {
      if (this.disposed || !menu.isConnected) return;
      if (!row.isConnected) {
        close(true);
        return;
      }
      this.positionRowMenu(row, menu);
    };
    const onScroll = (event: Event): void => {
      if (event.target instanceof Node && event.target.contains(row)) place();
    };
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", place);
    this.rowMenuTeardown = () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", place);
    };
    // The row's geometry is still settling in the same tick as the insert,
    // so measure and place the menu after the browser has finished layout.
    // Keep the fractional values; rounding would hide the 2px mismatch.
    requestAnimationFrame(place);
    anchor.setAttribute("aria-expanded", "true");
    const close = (restoreFocus: boolean): void => {
      this.openRowMenuTarget = null;
      this.rowMenuTeardown?.();
      this.rowMenuTeardown = null;
      const currentAnchor = this.container.querySelector<HTMLButtonElement>(
        `[data-${kind}-menu="${CSS.escape(id)}"]`,
      ) ?? anchor;
      currentAnchor.setAttribute("aria-expanded", "false");
      popovers.replaceChildren();
      if (restoreFocus && currentAnchor.isConnected) currentAnchor.focus();
    };
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) close(true);
    });
    menu.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
        return;
      }
      if (!["Tab", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>("button:not([disabled])"));
      if (buttons.length === 0) return;
      event.preventDefault();
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
        : index + (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey) ? -1 : 1);
      buttons[(next + buttons.length) % buttons.length]?.focus();
    });
    const bind = (action: string, run: () => void): void => {
      menu.querySelector<HTMLButtonElement>(`[data-${action}]`)?.addEventListener("click", () => {
        close(false);
        run();
      });
    };
    wire(bind, menu, close);
    menu.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
  }

  private closeRowMenu(): void {
    this.openRowMenuTarget = null;
    this.rowMenuTeardown?.();
    this.rowMenuTeardown = null;
    this.popoverRegion()?.replaceChildren();
  }

  private restoreSessionActionFocus(selector: string | null): void {
    if (selector === null) return;
    this.container.querySelector<HTMLElement>(selector)?.focus();
  }

  private popoverRegion(): HTMLElement | null {
    return this.container.closest("[data-workspace]")
      ?.querySelector<HTMLElement>('[data-region="popovers"]') ?? null;
  }

// The PROJECTS header menu (comp desktop-r5): the eyebrow's menubar-style
// panel on the same anchored-popover idiom as the row menus — the shared
// popover region behind a full-viewport transparent click-catcher,
// dismissed by backdrop click or Escape, both returning focus to the
// trigger. The panel drops below-left with its edge on the trigger's pill
// edge, never from a negative offset. Its rows take the overlay density
// every menu takes; the panel sets no inset of its own. Every row routes to
// a flow the sidebar already owns.
  private mountProjectsHeaderMenu(anchor: HTMLButtonElement): void {
    const popovers = this.popoverRegion();
    if (popovers === null) return;
    // Mounting replaces any open popover wholesale; reset the open
    // trigger's state first, while its anchor is still reachable.
    for (const trigger of this.container.querySelectorAll<HTMLButtonElement>(
      '[aria-haspopup="menu"][aria-expanded="true"]',
    )) {
      trigger.setAttribute("aria-expanded", "false");
    }
    this.openRowMenuTarget = null;
    // The replaced menus' listeners must not outlive their markup: an
    // open row menu's leave through its teardown, the header menu's
    // through its close path.
    this.rowMenuTeardown?.();
    this.rowMenuTeardown = null;
    this.closeProjectsMenu(false);
    const target = this.newSessionTarget();
    popovers.innerHTML = `<div class="absolute inset-0" data-popover-backdrop>${projectsMenuHtml(target?.name ?? null)}</div>`;
    const backdrop = popovers.querySelector<HTMLElement>("[data-popover-backdrop]")!;
    const menu = backdrop.querySelector<HTMLElement>("[role=menu]")!;
    this.projectsMenuAnchor = anchor;
    // The panel is placed in viewport coordinates while its trigger moves
    // with the layout, so one measurement goes stale on the first scroll
    // or resize: every scroll that carries the trigger (its own scroll
    // container, or the document) and every window resize re-place the
    // panel, and a trigger detached by a re-render closes the menu rather
    // than leaving the panel pinned to a dead node. Scrolls elsewhere —
    // a streaming terminal, say — never move the trigger and are ignored.
    const place = (): void => {
      if (this.disposed || !menu.isConnected) return;
      if (!anchor.isConnected) {
        this.closeProjectsMenu(true);
        return;
      }
      const rect = anchor.getBoundingClientRect();
      menu.style.top = `${rect.bottom + 2}px`;
      // Track the trigger's left edge, but never leave the viewport: the
      // sheet's ellipsis sits near the right edge, and an untracked panel
      // ran 92px off-screen there (design review M2). A left-edge trigger
      // still left-aligns exactly.
      const width = menu.offsetWidth;
      const vw = window.innerWidth;
      // Clamp only when the layout is real: the DOM-free unit fakes report
      // zero widths, and a zero-width clamp would pin every panel left.
      const left = width > 0 && vw > 0
        ? Math.max(0, Math.min(rect.left, vw - width - 12))
        : rect.left;
      menu.style.left = `${left}px`;
    };
    const onScroll = (event: Event): void => {
      if (event.target instanceof Node && event.target.contains(anchor)) place();
    };
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", place);
    const releaseMenu = activateMenu(menu, (restoreFocus) => {
      this.closeProjectsMenu(restoreFocus);
    });
    this.projectsMenuTeardown = () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", place);
      releaseMenu();
    };
    // The trigger's geometry is still settling in the same tick as the
    // insert, so measure and place the menu after layout has finished.
    requestAnimationFrame(place);
    anchor.setAttribute("aria-expanded", "true");
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) this.closeProjectsMenu(true);
    });
    // A dialog-opening row closes without restoring focus — the dialog
    // returns it through modalReturnSelector. A row that acts in place
    // restores focus to the trigger itself.
    const bind = (action: string, restoreFocus: boolean, run: () => void): void => {
      menu.querySelector<HTMLButtonElement>(`[data-${action}]`)?.addEventListener("click", () => {
        this.closeProjectsMenu(restoreFocus);
        run();
      });
    };
    // The dialogs hand focus back to whatever anchored this menu: the
    // desktop eyebrow, or the sheet's ellipsis where the eyebrow is hidden.
    // A hard-coded eyebrow selector strands focus on <body> at the widths
    // that renamed the trigger.
    const returnSelector = anchor.dataset.sidebarSheetMenu !== undefined
      ? "[data-sidebar-sheet-menu]"
      : "[data-projects-menu]";
    bind("projects-menu-new-project", false, () => {
      this.openNewProject(returnSelector);
    });
    // With no projects there is no session to start and no dialog to
    // hand focus to, so the row closes back to the trigger instead of
    // dropping focus on <body>.
    bind("projects-menu-new-session", target === null, () => {
      if (target === null) return;
      this.modalReturnSelector = returnSelector;
      this.openNewSession(target.id);
    });
    bind("projects-menu-sort", true, () => {
      // One-shot: the rewrite becomes the manual order, which the drag and
      // move rows keep editing; no sort preference persists.
      this.projectOrder = sortedProjectOrderByName(this.model.groups);
      this.saveLayout();
      this.renderProjectList();
    });
    bind("projects-menu-expand-all", true, () => {
      this.expansionTouched = true;
      for (const g of this.model.groups) this.expandedProjects.add(g.project.id);
      this.saveLayout();
      this.renderProjectList();
    });
    bind("projects-menu-collapse-all", true, () => {
      this.expansionTouched = true;
      this.expandedProjects.clear();
      this.saveLayout();
      this.renderProjectList();
    });
  }

  // closeProjectsMenu unmounts the header menu and releases its
  // document-level listeners. Focus restoration prefers the recorded
  // trigger and falls back to the live one, because a full render can
  // swap the trigger node out from under an open menu.
  private closeProjectsMenu(restoreFocus: boolean): void {
    const anchor = this.projectsMenuAnchor;
    if (anchor === null) return;
    const teardown = this.projectsMenuTeardown;
    this.projectsMenuAnchor = null;
    this.projectsMenuTeardown = null;
    teardown?.();
    anchor.setAttribute("aria-expanded", "false");
    this.popoverRegion()?.replaceChildren();
    if (!restoreFocus) return;
    const trigger = anchor.isConnected
      ? anchor
      : this.container.querySelector<HTMLButtonElement>("[data-projects-menu]");
    trigger?.focus();
  }

  openNewProject(returnSelector = "[data-projects-menu]"): void {
    this.modalReturnSelector = returnSelector;
    this.newProjectOpen = true;
    this.addProjectHidden = false;
    this.directoryPickerOpen = false;
    this.directoryListing = null;
    this.directoryError = "";
    this.newProjectProfileID = this.defaultGitIdentity()?.id ?? "";
    // A bound job that is still running or stopped reopens as itself; any
    // other open starts from an empty field.
    if (this.addProjectJob === null || this.addProjectJob.status === "done") {
      this.addProjectJob = null;
      this.projectSource = "choose";
      this.githubSelection = null;
      this.addProjectInput = "";
      this.addProjectInspection = null;
      this.addProjectInspectError = "";
      this.addProjectServerError = "";
      this.addProjectBase = "";
    }
    this.render();
  }

  // presetNewProjectPath fills the Add project field as a completed choice
  // would, so Browse reopens the picker straight at it. Preview scaffolding
  // for the probes; production reaches this state by choosing.
  presetNewProjectPath(path: string): void {
    this.projectSource = "local";
    this.setAddProjectInput(path);
  }

  // setAddProjectInput takes what was typed, pasted or chosen and asks the
  // server what it is. The readout only ever states an inspection of the
  // current input: a stale answer is dropped by request number.
  private setAddProjectInput(input: string, base = this.addProjectBase): void {
    this.addProjectInput = input;
    this.addProjectBase = base;
    this.addProjectServerError = "";
    // The readout describes the current input or nothing: the previous
    // answer goes before the new question is asked, so no action can be
    // taken on the old path under the new text.
    this.addProjectInspection = null;
    this.addProjectInspectError = "";
    if (this.addProjectInspectTimer !== null) clearTimeout(this.addProjectInspectTimer);
    const request = ++this.addProjectRequest;
    if (input.trim() === "") {
      this.addProjectInspection = null;
      this.addProjectInspectError = "";
      this.addProjectInspecting = false;
      this.renderModals();
      return;
    }
    this.addProjectInspecting = true;
    this.addProjectInspectTimer = setTimeout(() => {
      this.addProjectInspectTimer = null;
      void this.model.api.inspectProject(input, base).then((inspection) => {
        if (this.disposed || request !== this.addProjectRequest) return;
        this.addProjectInspection = inspection;
        this.addProjectInspectError = this.projectSource === "local" && inspection.kind === "clone"
          ? "Choose Repository URL to import a remote repository."
          : this.projectSource === "url" && inspection.kind !== "clone"
            ? "Enter a repository URL, or choose Local folder for a directory." : "";
        this.addProjectInspecting = false;
        this.renderModals();
      }, (err: unknown) => {
        if (this.disposed || request !== this.addProjectRequest) return;
        this.addProjectInspection = null;
        this.addProjectInspectError = err instanceof Error ? err.message : String(err);
        this.addProjectInspecting = false;
        this.renderModals();
      });
    }, 180);
    this.renderModals();
  }

  private async loadGitHubRepositories(refresh = false): Promise<void> {
    if (this.githubRepositories === null) {
      const lost = () => {
        this.githubSelection = null;
        this.githubRepositories?.authorizationLost();
        this.projectActions.onAuthorizationLost?.();
      };
      const status = this.projectActions.githubEnabled === false
        ? { status: async () => ({ outcome: "authentication-required" }) }
        : new HttpGitHubConnectClient(lost);
      this.githubRepositories = new GitHubRepositoriesModel(status, new HttpGitHubRepositoriesClient(lost), () => {
        if (!this.disposed && this.newProjectOpen && this.projectSource === "github") this.renderModals();
      });
    }
    const generation = ++this.githubReadGeneration;
    this.githubImported.clear();
    const projects = [...this.model.groups.map(group => group.project)];
    const inspect = async () => {
      while (projects.length > 0 && generation === this.githubReadGeneration && !this.disposed) {
        const project = projects.shift()!;
        try {
          const result = await this.model.api.inspectProject(project.canonical_path);
          if (generation !== this.githubReadGeneration || this.disposed) return;
          const remote = githubRemoteIdentity(result.remote?.startsWith("github.com/") ? `https://${result.remote}` : result.remote);
          if (remote !== null) this.githubImported.set(remote.full_name.toLowerCase(), { id: project.id, name: project.name });
        } catch { /* An unread local remote cannot establish a match. */ }
      }
    };
    await Promise.all([this.githubRepositories.load(refresh), ...Array.from({ length: Math.min(4, projects.length) }, inspect)]);
    if (generation === this.githubReadGeneration && !this.disposed && this.newProjectOpen && this.projectSource === "github") this.renderModals();
  }

  private async selectGitHubRepository(id: number): Promise<void> {
    const model = this.githubRepositories;
    if (model === null || this.identityBusy) return;
    const generation = this.githubReadGeneration;
    const repository = await model.select(id);
    if (repository === null || model.state.account === null || this.disposed || !this.newProjectOpen ||
        this.projectSource !== "github" || generation !== this.githubReadGeneration) return;
    this.githubSelection = { repository, account: model.state.account };
    this.setAddProjectInput(repository.clone_url, "");
  }

  private sidebarProjectRefs(): SidebarProjectRef[] {
    return this.model.groups.map((g) => ({ id: g.project.id, name: g.project.name, path: g.project.canonical_path }));
  }

  // closeAddProject dismisses the dialog. Dismissal never cancels: while a
  // job exists the dialog only hides and the rail row carries it.
  private closeAddProject(): void {
    ++this.githubReadGeneration;
    ++this.addProjectRequest;
    this.githubRepositories?.reset();
    if (this.addProjectJob !== null && this.addProjectJob.status !== "done") {
      this.addProjectHidden = true;
    } else {
      this.addProjectJob = null;
    }
    this.newProjectOpen = false;
    this.directoryPickerOpen = false;
    ++this.directoryRequest;
    this.renderModals();
    this.render();
  }

  // reopenClone brings a hidden or rail-carried job back into the dialog.
  reopenClone(job: CloneJob): void {
    this.addProjectJob = job;
    this.addProjectInput = job.url;
    this.addProjectInspection = null;
    this.addProjectHidden = false;
    this.newProjectOpen = true;
    this.directoryPickerOpen = false;
    this.pollClone();
    this.render();
  }

  // pollClone follows the bound job while it runs, and the rail's job list
  // whenever anything is running, so a dismissed clone keeps moving in the
  // row that carries it.
  private pollClone(): void {
    if (this.clonePollTimer !== null) clearTimeout(this.clonePollTimer);
    const tick = async () => {
      if (this.disposed) return;
      try {
        const jobs = await this.model.api.listClones();
        if (this.disposed) return;
        this.cloneJobs = jobs;
        if (this.addProjectJob !== null) {
          const bound = jobs.find((j) => j.id === this.addProjectJob?.id);
          if (bound !== undefined) {
            const finished = bound.status === "done" && this.addProjectJob.status !== "done";
            this.addProjectJob = bound;
            if (finished) await this.model.refresh();
          }
        }
        this.renderModals();
        this.render();
      } catch {
        // A failed poll changes nothing on screen; the next one tries again.
      }
      if (this.disposed) return;
      const running = this.cloneJobs.some((j) => j.status === "running");
      this.clonePollTimer = running ? setTimeout(() => void tick(), 500) : null;
    };
    void tick();
  }

  private async startAddProject(): Promise<void> {
    const state = this.addProjectState();
    const view = addProjectView(state);
    if (view.blocked || state.busy || state.inspection === null) return;
    const ins = state.inspection;
    const profile = view.signable ? this.selectedGitIdentity(this.newProjectProfileID) : null;
    if (view.signable && profile === null) return;
    const name = view.path.split("/").filter(Boolean).at(-1) ?? "workspace";
    this.identityBusy = true;
    this.addProjectServerError = "";
    this.renderModals();
    try {
      if (view.kind === "url" && !view.sameClone) {
        // Only a clone is a job. Everything else — including adopting a
        // clone already on disk — is instant and just lands in the sidebar.
        const selected = this.githubSelection;
        const job = await this.model.api.startClone({ url: ins.clone_url ?? state.input.trim(), destination: view.path, name, profile,
          ...(selected === null ? {} : { githubAccount: selected.account, githubRepositoryID: selected.repository.id }),
        });
        if (this.disposed) return;
        this.addProjectJob = job;
        this.pollClone();
        return;
      }
      // A plain directory, or one inside a repository, registers as it is;
      // a repository, worktree or fresh directory is provisioned.
      const plain = view.kind === "plain" || view.nested;
      const created = await this.model.createProject(name, view.path, plain ? null : profile, { plain });
      if (this.disposed) return;
      if (created === null) {
        this.addProjectServerError = this.model.error ?? "The project could not be added.";
        return;
      }
      this.createdProjectToExpand = created.id;
      this.addProjectJob = null;
      this.newProjectOpen = false;
      this.addProjectInput = "";
      this.addProjectInspection = null;
      this.directoryPickerOpen = false;
      this.directoryListing = null;
      this.directoryError = "";
      this.render();
    } catch (error) {
      if (!this.disposed) this.addProjectServerError = error instanceof Error ? error.message : "The import could not be confirmed. Check existing imports before trying again.";
    } finally {
      this.identityBusy = false;
      if (!this.disposed) this.renderModals();
    }
  }

  private async changeClone(action: "cancel" | "resume" | "discard"): Promise<void> {
    const job = this.addProjectJob;
    if (job === null || this.identityBusy) return;
    this.identityBusy = true;
    this.addProjectServerError = "";
    this.renderModals();
    try {
      const result = action === "cancel" ? await this.model.api.cancelClone(job.id)
        : action === "resume" ? await this.model.api.resumeClone(job.id)
          : await this.model.api.discardClone(job.id);
      if (this.disposed || this.addProjectJob?.id !== job.id) return;
      if (result === undefined) {
        this.addProjectJob = null;
        this.addProjectInput = "";
        this.addProjectInspection = null;
        this.closeAddProject();
      } else this.addProjectJob = result;
      this.pollClone();
    } catch (error) {
      if (!this.disposed && this.addProjectJob?.id === job.id) {
        this.addProjectServerError = error instanceof Error ? error.message : "The import change could not be confirmed. Nothing was retried.";
        this.pollClone();
      }
    } finally {
      this.identityBusy = false;
      if (!this.disposed) this.renderModals();
    }
  }

  private async openClonedProject(): Promise<void> {
    const job = this.addProjectJob;
    if (job?.status !== "done" || job.project_id === undefined || this.identityBusy) return;
    this.identityBusy = true;
    this.addProjectServerError = "";
    this.renderModals();
    try {
      await this.model.api.initializeTaskmaster(job.project_id);
      if (this.disposed || this.addProjectJob?.id !== job.id) return;
      this.addProjectJob = null;
      this.closeAddProject();
      this.createdProjectToExpand = job.project_id;
      this.revealProject(job.project_id);
      this.model.announceCreatedProject(job.project_id);
      this.projectActions.onOpenProject?.(job.project_id);
    } catch (error) {
      if (!this.disposed && this.addProjectJob?.id === job.id) this.addProjectServerError = error instanceof Error ? error.message : "The task board could not be opened. The imported project was kept.";
    } finally {
      this.identityBusy = false;
      if (!this.disposed) this.renderModals();
    }
  }

  private addProjectState() {
    return {
      source: this.projectSource === "choose" ? undefined : this.projectSource,
      githubAccount: this.githubSelection?.account,
      input: this.addProjectInput,
      inspection: this.addProjectInspection,
      inspectError: this.addProjectInspectError,
      projects: this.sidebarProjectRefs(),
      profiles: this.model.gitIdentities?.profiles ?? [],
      selectedProfileID: this.newProjectProfileID,
      busy: this.identityBusy,
      inspecting: this.addProjectInspecting,
      serverError: this.addProjectServerError,
      job: this.addProjectJob,
      directoryPickerHtml: this.renderDirectoryPicker(),
    };
  }

  private defaultGitIdentity(): GitIdentityProfile | null {
    const catalog = this.model.gitIdentities;
    if (catalog === null) return null;
    return catalog.profiles.find((profile) => profile.id === catalog.default_profile_id)
      ?? catalog.profiles[0] ?? null;
  }

  private selectedGitIdentity(id: string): GitIdentityProfile | null {
    return this.model.gitIdentities?.profiles.find((profile) => profile.id === id) ?? null;
  }

  private needsGitIdentityOnboarding(): boolean {
    return this.model.gitIdentities !== null && this.model.gitIdentities.profiles.length === 0;
  }

  // host returns the modal mount region: the workspace's overlay layer, or
  // the sidebar container itself when the frame lacks one (tests, fallback).
  private host(): HTMLElement {
    if (this.hostEl === null || !this.hostEl.isConnected) {
      const region = this.container.closest("[data-workspace]")
        ?.querySelector<HTMLElement>('[data-region="modals"]') ?? this.container;
      const host = document.createElement("div");
      host.dataset.modalHost = "sidebar";
      host.className = "absolute inset-0";
      region.append(host);
      this.hostEl = host;
    }
    return this.hostEl;
  }

  private renderModals(): void {
    if (this.disposed) return;
    const host = this.host();
    const addProjectOpen = this.newProjectOpen && !this.addProjectHidden;
    host.hidden = !this.needsGitIdentityOnboarding() && !this.identitySettingsOpen
      && this.projectIdentitySetup === null && !addProjectOpen
      && this.removeConfirm === null
      && this.removeProjectConfirm === null && this.newSessionProject === null;
    const markup = this.needsGitIdentityOnboarding()
      ? this.renderGitIdentityOnboarding()
      : this.identitySettingsOpen
        ? this.renderGitIdentitySettings()
        : this.projectIdentitySetup !== null
          ? this.renderProjectGitIdentitySetup()
          : addProjectOpen
            ? this.renderAddProjectModal()
      : this.removeConfirm !== null
        ? this.renderRemoveConfirmModal()
        : this.removeProjectConfirm !== null
            ? this.renderRemoveProjectConfirmModal()
            : this.newSessionProject !== null
              ? this.renderNewSessionModal()
              : "";
    // A sidebar poll must not replace the picker beneath the pointer or
    // steal focus from the harness the operator is selecting.
    const pickerOpen = markup.includes("data-new-session-modal");
    if (pickerOpen && markup === this.newSessionMarkup && host.querySelector("[data-new-session-modal]") !== null) return;
    this.newSessionMarkup = pickerOpen ? markup : null;
    const focused = markup.includes("data-github-picker") ? document.activeElement : null;
    const pickerFocus = focused !== null && focused instanceof HTMLElement && host.contains(focused)
      ? focused.matches("[data-github-repo-search]") ? "[data-github-repo-search]"
        : focused.matches("[data-github-repo-owner]") ? "[data-github-repo-owner]" : null
      : null;
    const selection = focused !== null && focused instanceof HTMLInputElement ? [focused.selectionStart, focused.selectionEnd] : null;
    this.modalFocusCleanup?.();
    this.modalFocusCleanup = null;
    host.innerHTML = markup;
    this.bindModals();
    this.bindModalFocus();
    if (pickerFocus !== null) {
      const restored = host.querySelector<HTMLElement>(pickerFocus);
      restored?.focus({ preventScroll: true });
      if (restored instanceof HTMLInputElement && selection !== null) restored.setSelectionRange(selection[0] ?? 0, selection[1] ?? 0);
    }
  }

  private bindModalFocus(): void {
    const host = this.hostEl;
    if (host === null) return;
    if (host.hidden) {
      const selector = this.modalReturnSelector;
      this.modalReturnSelector = null;
      if (selector !== null) {
        this.container.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
      }
      return;
    }
    const dialogs = host.querySelectorAll<HTMLElement>('[role="dialog"]');
    const dialog = dialogs.item(dialogs.length - 1);
    if (dialog !== null) {
      const selector = this.nestedModalReturnSelector;
      this.nestedModalReturnSelector = null;
      // Every modal takes focus on its own container unless it names a
      // control: the comp draws no focus mark at open, and an auto-focused
      // close control would wear the keyboard wash the moment the dialog
      // appeared. The new-session picker's filter is the one deliberate
      // exception — typing is that surface's whole point.
      const initialFocus = dialog.hasAttribute("data-new-session-modal")
        ? "[data-new-session-filter]"
        : selector ?? ":dialog";
      this.modalFocusCleanup = activateDialog(
        dialog,
        () => this.dismissTopModal(),
        initialFocus,
      );
    }

    for (const scrim of host.querySelectorAll("[data-directory-scrim], [data-sidebar-modal-scrim]")) {
      scrim.addEventListener("click", (event) => {
        event.stopPropagation();
        this.dismissTopModal();
      });
      scrim.querySelector(".dialog")?.addEventListener("click", (event) => event.stopPropagation());
    }
  }

  private dismissTopModal(): void {
    if (this.needsGitIdentityOnboarding()) {
      return;
    } else if (this.identitySettingsOpen) {
      if (this.identityBusy) return;
      if (this.identityEditor !== null || this.identityDelete !== null) {
        this.identityEditor = null;
        this.identityDelete = null;
      } else {
        this.identitySettingsOpen = false;
      }
    } else if (this.projectIdentitySetup !== null) {
      if (this.identityBusy) return;
      this.projectIdentitySetup = null;
    } else if (this.directoryPickerOpen) {
      this.directoryPickerOpen = false;
      this.newFolderOpen = false;
      this.nestedModalReturnSelector = "[data-project-browse]";
      ++this.directoryRequest;
    } else if (this.newProjectOpen) {
      this.closeAddProject();
      return;
    } else if (this.removeConfirm !== null) {
      if (this.removingSession) return;
      this.removeConfirm = null;
    } else if (this.removeProjectConfirm !== null) {
      this.removeProjectConfirm = null;
    } else if (this.launchingNewSessionProvider === null) {
      this.newSessionProject = null;
      this.newSessionFilter = "";
      this.newSessionSelection = null;
    }
    this.renderModals();
  }

  private renderNewSessionModal(): string {
    const creating = this.model.creatingSession || this.launchingNewSessionProvider !== null;
    // The dialog names the project the session lands in. This is the only
    // place that target is disclosed: the Projects menu row that opens the
    // dialog is plain text, because naming it there asks you to trust a label
    // and click, while naming it here shows it beside the harness you are
    // choosing.
    //
    // It must read the SAME id the launch uses. newSessionProject is what a
    // provider is created against, and every path that opens this dialog sets
    // it — a project row stores its own id, the header menu stores its
    // resolved target. So there is no second resolution to fall back to: an id
    // that matches no project names nothing, because naming a project the
    // session will not land in is worse than naming none.
    const inventory = this.model.harnessInventory;
    return newSessionModalHtml({
      available: pinnedOrder(this.model.availableProviders, this.newSessionOrder),
      inventoryStatus: inventory.status,
      inventoryError: inventory.status === "unknown" ? inventory.error : inventory.status === "stale" ? inventory.error : null,
      inventoryRefreshing: this.refreshingProviders,
      creating,
      target: newSessionDialogTarget(this.model.groups, this.newSessionProject),
      filter: this.newSessionFilter,
      launching: this.launchingNewSessionProvider,
      selection: this.newSessionSelection,
    });
  }

  private renderRemoveConfirmModal(): string {
    return removeConfirmModalHtml(this.removeConfirm!);
  }

  private renderRemoveProjectConfirmModal(): string {
    return removeProjectConfirmModalHtml(this.removeProjectConfirm!);
  }

  private renderGitIdentityOnboarding(): string {
    return gitIdentityOnboardingHtml({ busy: this.identityBusy, error: this.model.error });
  }

  private renderGitIdentitySettings(): string {
    const catalog = this.model.gitIdentities;
    if (catalog === null) return "";
    return gitIdentitySettingsHtml({
      catalog,
      defaultProfile: this.defaultGitIdentity(),
      editor: this.identityEditor,
      deleteID: this.identityDelete,
      busy: this.identityBusy,
      error: this.model.error,
    });
  }

  private renderProjectGitIdentitySetup(): string {
    const state = this.projectIdentitySetup!;
    return projectGitIdentitySetupHtml({
      project: this.model.groups.find((group) => group.project.id === state.projectID)?.project,
      retryProvider: state.retryProvider,
      profiles: this.model.gitIdentities?.profiles ?? [],
      selected: this.selectedGitIdentity(state.profileID) ?? this.defaultGitIdentity(),
      busy: this.identityBusy,
      error: this.model.error,
    });
  }

  private renderAddProjectModal(): string {
    if (this.addProjectJob === null && this.projectSource === "choose") return addProjectChooserHtml({ tutorialAvailable: this.projectActions.onTutorial !== undefined, message: this.addProjectServerError });
    if (this.addProjectJob === null && this.projectSource === "github" && this.githubSelection === null) {
      const model = this.githubRepositories, state = model?.state;
      return githubRepositoryPickerHtml({ account: state?.account ?? "", loading: state === undefined || state.phase === "loading", checking: state?.phase === "checking",
        outcome: state?.phase === "error" ? "unavailable" : state?.outcome ?? "", query: state?.query ?? "", owner: state?.owner ?? "",
        repositories: model?.visible ?? [], owners: model?.owners ?? [], imported: this.githubImported, complete: state?.complete ?? false });
    }
    return addProjectModalHtml(this.addProjectState());
  }

  private renderDirectoryPicker(): string {
    return directoryPickerHtml({
      open: this.directoryPickerOpen,
      loading: this.directoryLoading,
      listing: this.directoryListing,
      error: this.directoryError,
      fallbackError: this.model.error,
      newFolderOpen: this.newFolderOpen,
      mountRoots: this.directoryMountRoots ?? 1,
    });
  }

  private async applyProjectGitIdentity(): Promise<void> {
    const state = this.projectIdentitySetup;
    if (state === null || this.identityBusy) return;
    const project = this.model.groups.find((group) => group.project.id === state.projectID)?.project;
    const profile = this.selectedGitIdentity(state.profileID);
    if (project === undefined || profile === null) return;
    this.identityBusy = true;
    this.renderModals();
    const updated = await this.model.setupProjectGitIdentity(project, profile);
    if (this.disposed) return;
    this.identityBusy = false;
    if (updated === null) {
      this.renderModals();
      return;
    }
    const retryProvider = state.retryProvider;
    this.projectIdentitySetup = null;
    this.renderModals();
    this.render();
    if (retryProvider === null || state.retryAttempted) return;
    state.retryAttempted = true;
    const result = await this.model.create(state.projectID, retryProvider);
    if (result === "identity_required") {
      this.model.error = "Git identity setup did not become current. Start the session again after reviewing the project identity.";
    }
    if (!this.disposed) this.render();
  }

  private bindModals(): void {
    const m = this.model;
    const host = this.hostEl;
    if (host === null) return;
    host.querySelector("[data-github-connect]")?.addEventListener("click", () => this.onConnectGitHub?.());
    host.querySelector<HTMLFormElement>("[data-git-identity-onboarding]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (this.identityBusy) return;
      const form = event.currentTarget as HTMLFormElement;
      const name = form.querySelector<HTMLInputElement>("[data-onboarding-git-name]")?.value.trim() ?? "";
      const email = form.querySelector<HTMLInputElement>("[data-onboarding-git-email]")?.value.trim() ?? "";
      if (name === "" || email === "") return;
      this.identityBusy = true;
      this.renderModals();
      void m.createGitIdentity(name, email).finally(() => {
        this.identityBusy = false;
        if (!this.disposed) { this.render(); this.renderModals(); }
      });
    });
    host.querySelector("[data-git-identities-close]")?.addEventListener("click", () => {
      if (this.identityBusy) return;
      this.identitySettingsOpen = false;
      this.identityEditor = null;
      this.identityDelete = null;
      this.renderModals();
    });
    host.querySelector("[data-git-identity-add]")?.addEventListener("click", () => {
      this.identityEditor = "new";
      this.identityDelete = null;
      this.renderModals();
    });
    // The Name field edits the default identity's author name in place
    // (comp: one author, many emails). Enter or blur commits; an unchanged
    // value writes nothing.
    const nameField = host.querySelector<HTMLInputElement>("[data-git-identity-name]");
    if (nameField !== null) {
      const commitName = (): void => {
        const profile = this.defaultGitIdentity();
        const name = nameField.value.trim();
        if (this.identityBusy || profile === null || name === "" || name === profile.name) return;
        this.identityBusy = true;
        void m.updateGitIdentity(profile, name, profile.email).finally(() => {
          this.identityBusy = false;
          if (!this.disposed) this.renderModals();
        });
      };
      nameField.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commitName();
        }
      });
      nameField.addEventListener("blur", commitName);
    }
    host.querySelectorAll<HTMLButtonElement>("[data-git-identity-edit]").forEach((button) => {
      button.addEventListener("click", () => {
        this.identityEditor = button.dataset.gitIdentityEdit ?? null;
        this.identityDelete = null;
        this.renderModals();
      });
    });
    host.querySelector("[data-git-identity-editor-cancel]")?.addEventListener("click", () => {
      this.identityEditor = null;
      this.renderModals();
    });
    host.querySelector<HTMLFormElement>("[data-git-identity-editor]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (this.identityBusy || this.identityEditor === null) return;
      const form = event.currentTarget as HTMLFormElement;
      const name = form.querySelector<HTMLInputElement>("[data-editor-git-name]")?.value.trim() ?? "";
      const email = form.querySelector<HTMLInputElement>("[data-editor-git-email]")?.value.trim() ?? "";
      if (name === "" || email === "") return;
      const editing = this.identityEditor;
      const profile = this.selectedGitIdentity(editing);
      this.identityBusy = true;
      this.renderModals();
      const action = editing === "new" ? m.createGitIdentity(name, email)
        : profile === null ? Promise.resolve(false) : m.updateGitIdentity(profile, name, email);
      void action.then((saved) => { if (saved) this.identityEditor = null; }).finally(() => {
        this.identityBusy = false;
        if (!this.disposed) this.renderModals();
      });
    });
    host.querySelectorAll<HTMLButtonElement>("[data-git-identity-default]").forEach((button) => {
      button.addEventListener("click", () => {
        const profile = this.selectedGitIdentity(button.dataset.gitIdentityDefault ?? "");
        if (profile === null || this.identityBusy) return;
        this.identityBusy = true;
        this.renderModals();
        void m.setDefaultGitIdentity(profile).finally(() => {
          this.identityBusy = false;
          if (!this.disposed) this.renderModals();
        });
      });
    });
    host.querySelectorAll<HTMLButtonElement>("[data-git-identity-delete]").forEach((button) => {
      button.addEventListener("click", () => {
        this.identityDelete = button.dataset.gitIdentityDelete ?? null;
        this.identityEditor = null;
        this.renderModals();
      });
    });
    host.querySelector("[data-git-identity-delete-cancel]")?.addEventListener("click", () => {
      this.identityDelete = null;
      this.renderModals();
    });
    host.querySelector("[data-git-identity-delete-confirm]")?.addEventListener("click", () => {
      const deleting = this.selectedGitIdentity(this.identityDelete ?? "");
      if (deleting === null || this.identityBusy) return;
      const replacementID = host.querySelector<HTMLSelectElement>("[data-git-identity-replacement]")?.value;
      const replacement = replacementID === undefined ? undefined : this.selectedGitIdentity(replacementID) ?? undefined;
      this.identityBusy = true;
      this.renderModals();
      void m.deleteGitIdentity(deleting, replacement).then((deleted) => {
        if (deleted) this.identityDelete = null;
      }).finally(() => {
        this.identityBusy = false;
        if (!this.disposed) this.renderModals();
      });
    });
    host.querySelector<HTMLSelectElement>("[data-project-identity-profile]")?.addEventListener("change", (event) => {
      if (this.projectIdentitySetup === null) return;
      this.projectIdentitySetup.profileID = (event.currentTarget as HTMLSelectElement).value;
      this.renderModals();
    });
    host.querySelector("[data-project-identity-cancel]")?.addEventListener("click", () => {
      if (this.identityBusy) return;
      this.projectIdentitySetup = null;
      this.renderModals();
    });
    host.querySelector("[data-project-identity-save]")?.addEventListener("click", () => {
      void this.applyProjectGitIdentity();
    });
    host.querySelector("[data-project-browse]")?.addEventListener("click", () => {
      // Browse answers "I don't know the path": it fills the field with
      // what is chosen, reopening at the field's path when it names one.
      this.pickTarget = "add";
      const at = this.addProjectInspection;
      const typed = this.addProjectInput.trim();
      void this.openDirectory(at !== null && at.exists && at.kind !== "clone" ? at.path
        : typed.startsWith("/") ? typed : undefined);
    });
    host.querySelector("[data-remove-cancel]")?.addEventListener("click", () => {
      this.removeConfirm = null;
      this.renderModals();
    });
    host.querySelector("[data-remove-project-cancel]")?.addEventListener("click", () => {
      this.removeProjectConfirm = null;
      this.renderModals();
    });
    host.querySelector("[data-remove-project-confirm-btn]")?.addEventListener("click", () => {
      const target = this.removeProjectConfirm;
      if (target === null) return;
      this.removeProjectConfirm = null;
      this.renderModals();
      void this.model.removeProject(target.id).then(() => {
        if (!this.disposed) this.render();
      });
    });
    host.querySelectorAll("[data-new-session-cancel]").forEach((button) => button.addEventListener("click", () => {
      this.newSessionProject = null;
      this.newSessionFilter = "";
      this.newSessionSelection = null;
      this.renderModals();
    }));
    const picker = host.querySelector<HTMLElement>("[data-new-session-modal]");
    const pickerDialog = host.querySelector<HTMLElement>("[data-new-session-dialog]");
    const pickerChips = host.querySelector<HTMLElement>("[data-new-session-chips]");
    const pickerFilter = host.querySelector<HTMLInputElement>("[data-new-session-filter]");
    const pickerEmpty = host.querySelector<HTMLElement>("[data-new-session-empty]");
    const pickerRetry = host.querySelector<HTMLButtonElement>("[data-new-session-inventory-retry]");
    const pickerButtons = (): HTMLButtonElement[] =>
      Array.from(host.querySelectorAll<HTMLButtonElement>("[data-new-session-provider]"));
    const visiblePickerButtons = (): HTMLButtonElement[] =>
      pickerButtons().filter((button) => !button.disabled);
    const syncSelection = (): void => {
      const buttons = visiblePickerButtons();
      const selected = this.newSessionSelection !== null ? buttons[this.newSessionSelection] ?? null : null;
      pickerButtons().forEach((button, index) => {
        const visibleIndex = buttons.indexOf(button);
        button.dataset.selected = button === selected ? "true" : "false";
        button.tabIndex = visibleIndex === (this.newSessionSelection ?? 0) ? 0 : -1;
      });
      if (picker !== null) this.newSessionMarkup = this.renderNewSessionModal();
    };
    // The chip row wraps rather than stopping at its ends. The row holds every
    // harness and reflows across several visual lines, so an end is not
    // somewhere the eye can find: an operator holding an arrow key would sit
    // on a chip that stopped moving with nothing to say it had.
    const wrapSelection = (buttons: readonly HTMLButtonElement[], index: number): number => {
      if (buttons.length === 0) return 0;
      return ((index % buttons.length) + buttons.length) % buttons.length;
    };
    const movePickerSelection = (delta: number): void => {
      const buttons = visiblePickerButtons();
      if (buttons.length === 0) return;
      const current = this.newSessionSelection ?? (delta > 0 ? -1 : 0);
      this.newSessionSelection = wrapSelection(buttons, current + delta);
      syncSelection();
      const target = buttons[this.newSessionSelection];
      if (target !== undefined) target.focus();
    };
    const commitPickerSelection = (): boolean => {
      const buttons = visiblePickerButtons();
      const selected = this.newSessionSelection !== null ? buttons[this.newSessionSelection] : null;
      if (selected !== null && selected !== undefined) {
        selected.click();
        return true;
      }
      return false;
    };
    // Every way in: a key, a value the operator did not type a key for (a
    // pasted filter), the pointer arriving on a chip, and — below, with the
    // selection it also sets — focus landing on one. The listeners are
    // re-bound on each render, so the flag lives on the shell. The filter's
    // own opening focus is not engagement: the dialog puts it there.
    const touchPicker = (): void => { this.newSessionTouched = true; };
    pickerDialog?.addEventListener("keydown", touchPicker, { capture: true });
    pickerDialog?.addEventListener("input", touchPicker, { capture: true });
    pickerChips?.addEventListener("pointerover", touchPicker);
    pickerFilter?.addEventListener("input", () => {
      const filter = pickerFilter.value;
      const start = pickerFilter.selectionStart;
      const end = pickerFilter.selectionEnd;
      this.newSessionFilter = filter;
      this.newSessionSelection = filter.trim() !== "" ? 0 : null;
      this.renderModals();
      const next = host.querySelector<HTMLInputElement>("[data-new-session-filter]");
      if (next !== null) {
        next.focus();
        next.setSelectionRange(start ?? filter.length, end ?? filter.length);
      }
    });
    pickerFilter?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        if (commitPickerSelection()) event.preventDefault();
        return;
      }
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (step === undefined) return;
      event.preventDefault();
      movePickerSelection(step);
    });
    pickerDialog?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.newSessionProject = null;
        this.newSessionFilter = "";
        this.newSessionSelection = null;
        this.renderModals();
        return;
      }
      if (event.target === pickerFilter) return;
      if (event.key === "Enter") {
        if (commitPickerSelection()) event.preventDefault();
        return;
      }
    });
    pickerChips?.addEventListener("keydown", (event) => {
      const target = event.target as HTMLElement;
      if (target.matches("[data-new-session-provider]") && event.key === "Enter") {
        event.preventDefault();
        (target as HTMLButtonElement).click();
        return;
      }
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (step === undefined) return;
      event.preventDefault();
      movePickerSelection(step);
    });
    pickerChips?.addEventListener("focusin", (event) => {
      const target = event.target as HTMLElement;
      if (!target.matches("[data-new-session-provider]")) return;
      // Focus can reach a chip without a key, a pointer or an input — an
      // assistive navigation moves it directly — and a chip with focus is
      // the list being read as surely as an armed one is.
      touchPicker();
      const buttons = visiblePickerButtons();
      const index = buttons.indexOf(target as HTMLButtonElement);
      this.newSessionSelection = index >= 0 ? index : null;
      syncSelection();
    });
    pickerRetry?.addEventListener("click", () => {
      if (this.refreshingProviders) return;
      this.refreshingProviders = true;
      this.renderModals();
      void this.model.refreshProviders().finally(() => {
        this.refreshingProviders = false;
        if (!this.disposed) this.renderModals();
      });
    });
    syncSelection();
    pickerButtons().forEach((button) => {
      button.addEventListener("click", () => {
        const provider = button.dataset.newSessionProvider!;
        this.launchProvider(provider);
      });
    });
    host.querySelector("[data-remove-confirm-btn]")?.addEventListener("click", () => {
      const target = this.removeConfirm;
      if (target === null) return;
      this.removingSession = true;
      host.querySelectorAll<HTMLButtonElement>("[data-remove-confirm-btn], [data-remove-cancel]")
        .forEach((button) => { button.disabled = true; });
      void this.attemptRemove(target);
    });
    host.querySelectorAll("[data-project-cancel]").forEach((button) => button.addEventListener("click", () => {
      this.closeAddProject();
    }));
    for (const button of host.querySelectorAll<HTMLButtonElement>("[data-project-source]")) {
      button.addEventListener("click", () => {
        const source = button.dataset.projectSource;
        if (this.identityBusy) return;
        if (source === "tutorial") {
          const reason = this.projectActions.tutorialUnavailableReason?.();
          if (reason) {
            this.addProjectServerError = reason;
            this.renderModals();
            return;
          }
          this.closeAddProject();
          if (dismissOnSelect(window.matchMedia(MOBILE_QUERY).matches)) this.setCollapsed(true);
          this.projectActions.onTutorial?.();
          return;
        }
        if (source !== "choose" && source !== "github" && source !== "local" && source !== "url") return;
        ++this.githubReadGeneration;
        this.githubRepositories?.reset();
        this.githubSelection = null;
        this.projectSource = source;
        ++this.addProjectRequest;
        this.addProjectInspection = null;
        this.addProjectInput = "";
        this.addProjectInspectError = "";
        this.addProjectServerError = "";
        this.renderModals();
        if (source === "github") void this.loadGitHubRepositories();
      });
    }
    host.querySelector<HTMLInputElement>("[data-github-repo-search]")?.addEventListener("input", event => this.githubRepositories?.setQuery((event.currentTarget as HTMLInputElement).value));
    host.querySelector<HTMLSelectElement>("[data-github-repo-owner]")?.addEventListener("change", event => this.githubRepositories?.setOwner((event.currentTarget as HTMLSelectElement).value || null));
    host.querySelector("[data-github-repo-refresh]")?.addEventListener("click", () => { void this.loadGitHubRepositories(true); });
    host.querySelector("[data-github-repo-connect]")?.addEventListener("click", () => this.onConnectGitHub?.());
    for (const button of host.querySelectorAll<HTMLButtonElement>("[data-github-repo-select]")) button.addEventListener("click", () => { void this.selectGitHubRepository(Number(button.dataset.githubRepoSelect)); });
    for (const button of host.querySelectorAll<HTMLButtonElement>("[data-github-repo-open]")) button.addEventListener("click", () => {
      const id = button.dataset.githubRepoOpen;
      if (id === undefined || !this.model.groups.some(group => group.project.id === id)) return;
      this.closeAddProject();
      this.revealProject(id);
      this.projectActions.onOpenProject?.(id);
    });
    host.querySelector<HTMLInputElement>("[data-project-path]")?.addEventListener("input", (event) => {
      this.setAddProjectInput((event.currentTarget as HTMLInputElement).value, "");
    });
    host.querySelector<HTMLInputElement>("[data-project-clone-dest]")?.addEventListener("change", (event) => {
      // The container is the one thing a clone needs from the operator:
      // editing the destination changes where it lands, not the name.
      const value = (event.currentTarget as HTMLInputElement).value.trim();
      const cut = value.lastIndexOf("/");
      this.setAddProjectInput(this.addProjectInput, cut > 0 ? value.slice(0, cut) : "");
    });
    host.querySelector("[data-project-browse-dest]")?.addEventListener("click", () => {
      this.pickTarget = "dest";
      void this.openDirectory(this.addProjectBase || undefined);
    });
    host.querySelector("[data-project-show-dup]")?.addEventListener("click", () => {
      const dup = addProjectView(this.addProjectState()).dup;
      if (dup === null) return;
      this.closeAddProject();
      this.revealProject(dup.id);
    });
    host.querySelector("[data-project-take-parent]")?.addEventListener("click", () => {
      const view = addProjectView(this.addProjectState());
      if (view.nested && view.kind === "url") {
        this.pickTarget = "dest";
        void this.openDirectory();
        return;
      }
      if (view.parentKnown !== null) {
        this.closeAddProject();
        this.revealProject(view.parentKnown.id);
        return;
      }
      this.setAddProjectInput(view.parentPath, "");
    });
    host.querySelector("[data-clone-cancel]")?.addEventListener("click", () => { void this.changeClone("cancel"); });
    host.querySelector("[data-clone-background]")?.addEventListener("click", () => this.closeAddProject());
    host.querySelector("[data-clone-resume]")?.addEventListener("click", () => { void this.changeClone("resume"); });
    host.querySelector("[data-clone-discard]")?.addEventListener("click", () => { void this.changeClone("discard"); });
    host.querySelector("[data-clone-create-board]")?.addEventListener("click", () => { void this.openClonedProject(); });
    host.querySelector<HTMLSelectElement>("[data-project-git-profile]")?.addEventListener("change", (event) => {
      this.newProjectProfileID = (event.currentTarget as HTMLSelectElement).value;
      this.renderModals();
    });
    host.querySelector("[data-directory-cancel]")?.addEventListener("click", () => {
      this.directoryPickerOpen = false;
      this.newFolderOpen = false;
      this.nestedModalReturnSelector = "[data-project-browse]";
      ++this.directoryRequest;
      this.renderModals();
    });
    host.querySelector("[data-directory-new-folder]")?.addEventListener("click", () => {
      this.newFolderOpen = !this.newFolderOpen;
      this.renderModals();
      this.host().querySelector<HTMLInputElement>("[data-directory-new-name]")?.focus();
    });
    // Enter commits the inline create row (the comp's contract: the row
    // says "Enter to create" and carries no button).
    const createFolder = () => {
      const parent = this.directoryListing?.current_path;
      const input = host.querySelector<HTMLInputElement>("[data-directory-new-name]");
      const name = input?.value.trim() ?? "";
      if (parent === undefined || parent === "" || name === "") return;
      if (input !== null) input.disabled = true;
      void this.model.api.createProjectDirectory(parent, name).then((created) => {
        if (this.disposed) return;
        // The new folder becomes the field's answer directly — the
        // operator made it to use it.
        this.directoryPickerOpen = false;
        this.newFolderOpen = false;
        this.directoryError = "";
        this.choosePicked(created.path);
      }).catch((cause: unknown) => {
        if (this.disposed) return;
        this.directoryError = cause instanceof Error ? cause.message : String(cause);
        this.renderModals();
      });
    };
    host.querySelector<HTMLInputElement>("[data-directory-new-name]")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        createFolder();
      }
    });
    host.querySelector("[data-directory-roots]")?.addEventListener("click", () => {
      void this.openDirectory();
    });
    host.querySelector("[data-directory-parent]")?.addEventListener("click", () => {
      const parent = this.directoryListing?.parent_path;
      void this.openDirectory(parent ?? undefined);
    });
    host.querySelectorAll<HTMLButtonElement>("[data-directory-path]").forEach((button) => {
      button.addEventListener("click", () => void this.openDirectory(button.dataset.directoryPath));
    });
    host.querySelector("[data-directory-select]")?.addEventListener("click", () => {
      const selected = this.directoryListing?.current_path;
      if (!selected) return;
      this.directoryPickerOpen = false;
      this.nestedModalReturnSelector = "[data-project-browse]";
      this.choosePicked(selected);
    });
    const form = host.querySelector<HTMLFormElement>("[data-project-form]");
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.startAddProject();
    });
  }

  // choosePicked writes the picker's answer to the control that opened it:
  // the field when Browse answered "I don't know the path", the clone's
  // container when Browse sat on Clone into.
  private choosePicked(path: string): void {
    if (this.pickTarget === "dest") {
      this.setAddProjectInput(this.addProjectInput, path);
    } else {
      this.setAddProjectInput(path, "");
    }
  }

  // revealProject expands and selects a project the dialog pointed at.
  private revealProject(projectID: string): void {
    this.expandedProjects.add(projectID);
    this.selectedProjectID = projectID;
    this.contextProjectID = projectID;
    this.expansionTouched = true;
    this.render();
    this.container.querySelector<HTMLElement>(`[data-project-toggle="${CSS.escape(projectID)}"]`)?.focus();
  }

  private async openDirectory(path?: string): Promise<void> {
    const request = ++this.directoryRequest;
    this.directoryLoading = true;
    this.directoryPickerOpen = true;
    this.newFolderOpen = false;
    this.directoryError = "";
    this.renderModals();
    const listing = await this.model.browseProjectDirectories(path);
    if (this.disposed || request !== this.directoryRequest) return;
    this.directoryLoading = false;
    if (listing !== null) {
      if (listing.current_path === "") this.directoryMountRoots = listing.directories.length;
      // A single allowed root means the mount listing offers no choice;
      // descend straight into it rather than making the operator click
      // through a one-item list.
      const descend = autoDescendPath(listing);
      if (descend !== null) {
        void this.openDirectory(descend);
        return;
      }
      // A root's top reports no parent, so whether Up can still go
      // somewhere is the mount's root count. A picker opened straight at a
      // path has never read the mount, so read it now rather than deciding
      // from a count nobody fetched.
      if (listing.parent_path === null && listing.current_path !== "" && this.directoryMountRoots === null) {
        const mount = await this.model.browseProjectDirectories();
        if (this.disposed || request !== this.directoryRequest) return;
        this.directoryMountRoots = mount === null ? null : mount.directories.length;
      }
      this.directoryListing = listing;
    } else {
      this.directoryError = this.model.error ?? "Directories are unavailable";
    }
    this.renderModals();
  }

  // Until the operator toggles a project, the selected session's project
  // (or the first, when nothing is selected) stays expanded.
  private applyDefaultExpansion(): void {
    this.createdProjectToExpand = reconcileCreatedProjectExpansion(
      this.expandedProjects,
      this.createdProjectToExpand,
      this.model.groups,
    );
    if (this.expansionTouched) return;
    const m = this.model;
    const selected = m.groups.find((g) => g.sessions.some((x) => x.id === m.selectedSessionID));
    const target = selected?.project.id ?? m.groups[0]?.project.id;
    if (target !== undefined) this.expandedProjects.add(target);
  }

  private renderGroup(projectID: string): string {
    const m = this.model;
    const g = m.groups.find((x) => x.project.id === projectID);
    if (!g) return "";
    const sessionOrder = presentedSessionOrder(g.sessions, this.sessionOrder[g.project.id] ?? null);
    const sessionById = new Map(g.sessions.map((s) => [s.id, s]));
    const sessions = sessionOrder
      .map((id) => sessionById.get(id)!)
      .map((s) => {
        const selected = s.id === m.selectedSessionID;
        // Reference row: provider tile, name, and optional output age. The
        // name is the operator's display_name when set, else the provider.
        // The tile leads directly — the reference has no lead
        // dot slot, so the tile lands exactly under the project name.
        const renaming = this.renamingSession === s.id;
        // The name carries a normal line box, not the body ratio. The comp's
        // session row is a <button>, and a button does not inherit
        // line-height - the UA default applies, giving a 19px line box and a
        // 31px row. Our row is an <li>, which does inherit, so without this
        // the row is 35px and the rail drifts 4px further out with every
        // session.
        // The rename field is chromeless (comp desktop-r15): preflight
        // leaves a bare input with no border, fill, padding or radius,
        // and any inset would shove the text right the moment it becomes
        // editable. The renaming row holds the pressed wash in place of
        // the hover rule — the wash plus the accent selection on the
        // auto-selected text is the whole affordance.
        // The built meta is recorded before the markup embeds it: this is
        // the producer string writeSessionMeta compares against, and it is
        // as accurate on a skip as on a paint, because a skip means the
        // container already holds exactly these bytes.
        const metaHtml = sessionMetaHtml(s, this.streamingSessionIDs.has(s.id), this.chatMarks.get(s.id) ?? null);
        this.sessionMetaWritten.set(s.id, metaHtml);
        const sessionName = escapeHtml(s.display_name || providerDisplayName(s.provider));
        const dragClass = this.dragSession?.id === s.id ? "project-row-drag" : "";
        return `<li data-session="${escapeHtml(s.id)}" data-list-row role="option" aria-selected="${selected}" draggable="true"
          data-hint="${hints.sessionSwitch(sessionName, escapeHtml(g.project.name))}"
          class="group relative flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 transition-colors ${
            renaming || selected ? "bg-wash-pressed" : "hover:bg-wash-hover"
          } ${dragClass}">
          <!-- The swipe action sits behind the sliding surface (comp
               mobile-r8 screen 02: swipe a row to close). Phone chrome:
               the wide scope hides the action and the surface is
               display:contents, so the desktop row's layout never sees
               either wrapper. -->
          <button type="button" data-session-swipe-close="${escapeHtml(s.id)}" tabindex="-1" class="hidden" data-hint="${hints.CLOSE_THIS_SESSION}">
            ${lucideIcon("square", 16)}<span>Close</span>
          </button>
          <div data-session-swipe-surface class="contents">
          <span data-session-status class="hidden w-[13px] flex-none items-center justify-center">${
            sessionStatusCellHtml(
              this.streamingSessionIDs.has(s.id) && metaHtml.includes("data-meta-spinner"),
              metaHtml.includes("data-meta-attention"),
            )
          }</span>
          ${sessionTileHtml(s.provider, sessionTileColorStyle(s.color, g.autoColor))}
          ${renaming
            ? `<input data-rename-input value="${escapeHtml(s.display_name || providerDisplayName(s.provider))}" aria-label="Rename session" data-hint="${hints.RENAME_THIS_SESSION}"
                autocapitalize="none" autocomplete="off" spellcheck="false"
                class="font-input h-[19px] min-w-0 flex-1 text-body font-medium text-text-primary focus:outline-none">`
            : `<span class="min-w-0 flex-1 truncate text-body leading-[normal] ${selected ? "font-medium text-text-primary" : "text-text-secondary"}">${sessionName}</span>
          <!-- The meta cell and the menu trigger trade places on hover:
               the tick fades out (group-hover:opacity-0 above) and the
               trigger fades in from .session-menu-trigger. Both moves
               are opacity-only, so nothing travels sideways: the tick
               hugs the row's content edge and the trigger overlays it
               from the row's right edge. -->
          ${sessionActionControlsHtml(s.id, metaHtml, selected)}`}
          </div>
        </li>`;
      })
      .join("");
    const error = g.loadError
      ? `<div class="px-2 py-1 text-caption text-error">${escapeHtml(g.loadError)}</div>`
      : "";
    const expanded = this.expandedProjects.has(g.project.id);
    // The effective project tint: an operator tag wins over the derived
    // auto-color tint. Both colour the chevron, rail, and tree line, and
    // the tag is resolved through the palette — see effectiveProjectTint.
    const projectColor = effectiveProjectTint(g.color, g.autoColor);
    // The indent rail under an open project (handoff §7): a 2px
    // line in the project colour where one is set — mixed toward the
    // border so it reads as a rail, not a stripe — and the plain border
    // otherwise. The 11px inset plus the rail and 8px padding lands the
    // session tile exactly under the project name.
    const treeLine = projectColor
      ? `color-mix(in oklab, ${escapeHtml(projectColor)} 78%, var(--color-border))`
      : "var(--color-border)";
    // The row's inline rename swaps the name — and the toggle
    // around it — for a chromeless input; the directory on disk never
    // changes. The row takes the selected wash while it edits: with no
    // field chrome, the wash plus the accent selection is the affordance.
    const renamingProject = this.renamingProject === g.project.id;
    // The reference project-row anatomy (handoff §7): a 13px mono
    // disclosure column carrying ▸/▾ tinted with the project color, the
    // name at --text-primary, and the trailing + / ⋯ icon buttons, which
    // reveal on the row's hover or keyboard focus-visible — the Fastmail
    // model. A mouse click focuses the toggle but must not pin the
    // cluster; pointer-coarse keeps it visible because there is no hover
    // to reveal it. An open submenu keeps the cluster visible so the
    // operator can reach it after the pointer leaves the row.
    const chev = projectChevronHtml(expanded, projectColor);
    const actions = "pointer-events-none opacity-0 transition-opacity duration-[110ms] ease-[ease] group-has-focus-visible/project:pointer-events-auto group-has-focus-visible/project:opacity-100 group-hover/project:pointer-events-auto group-hover/project:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100";
    const hint = hints.projectToggle(expanded, escapeHtml(g.project.name));
    const header = renamingProject
      ? `<div class="flex items-center gap-(--row-icon-gap) rounded-control bg-wash-selected py-(--row-py) pl-(--row-px) pr-2">
          ${chev}
          <input data-rename-project-input value="${escapeHtml(g.project.name)}" aria-label="Rename project" data-hint="${hints.RENAME_THIS_PROJECT}"
            autocapitalize="none" autocomplete="off" spellcheck="false"
            class="font-input h-5 min-w-0 flex-1 text-body font-medium text-text-primary focus:outline-none">
        </div>`
      : projectRowHtml({ id: g.project.id, name: g.project.name, expanded, hint, chev, actions, selected: this.selectedProjectID === g.project.id });
    // The rail sheds its rule while nothing is selected (comp
    // desktop-r16): the pane shows no session, so a rule under any rail
    // would read as a selection the pane does not have.
    const bareRail = this.model.selectedSessionID === null;
    return `
      <li data-project="${escapeHtml(g.project.id)}" data-project-row class="rounded-control">
        ${header}
        ${sessionRailContainerHtml(g.project.id, projectColor, expanded, `${pendingSessionRowHtml(this.pendingSession, g.project.id)}${sessions}${emptyRailNewSessionHtml(g, expanded, this.pendingSession)}`, bareRail)}
        ${error}
      </li>
    `;
  }
}

// PendingSession is a launch the operator has asked for that the server
// has not answered yet.
export interface PendingSession {
  projectID: string;
  provider: string;
}

interface SessionRemovalTarget {
  id: string;
  label: string;
  projectID: string;
  projectName: string;
  meta: string;
  color: string | null | undefined;
}

// RenameDraft is an open inline edit's unconfirmed state, carried across
// the markup replacement that destroys its input. The rebuilt input renders
// the model's stored name; the draft is what the operator typed, and losing
// it to a background repaint forces a retype of text that was on screen
// moments earlier.
interface RenameDraft {
  kind: "session" | "project";
  id: string;
  value: string;
  selStart: number | null;
  selEnd: number | null;
  focused: boolean;
}

// pendingSessionRowHtml is the row for a pending launch, or "" when the
// group is not the one being launched into. It repeats the real session
// row's geometry — 16px tile, name, 11px meta cell — with the meta cell
// holding the streaming spinner. It carries no data-session, so the click
// handlers that bind by that attribute cannot reach it, and no
// rename or remove control, which would have nothing to act on.
// The project row template, extracted so the rendered shape — permanence
// classes, control sizes, the unconditional plus — is regression-tested.
export function projectRowHtml(args: {
  id: string;
  name: string;
  expanded: boolean;
  hint: string;
  chev: string;
  actions: string;
  selected?: boolean;
}): string {
  // The reference's selected project row holds the same wash its hover
  // uses — sessions take the stronger selected wash — so a selected
  // project reads as position, not emphasis.
  const selectedWash = args.selected === true ? "bg-wash-hover" : "hover:bg-wash-hover";
  return `<div class="group/project relative flex items-center" data-selected="${args.selected === true}">
          <button data-project-toggle="${escapeHtml(args.id)}" data-list-row role="option" tabindex="-1" aria-expanded="${args.expanded}" aria-controls="sessions-${escapeHtml(args.id)}" data-hint="${args.hint}"
            class="flex w-full min-w-0 cursor-pointer items-center gap-(--row-icon-gap) rounded-control py-(--row-py) pl-(--row-px) pr-[64px] text-left text-text-primary transition-colors pointer-coarse:pr-[86px] ${selectedWash} active:bg-wash-pressed focus-visible:bg-wash-hover">
            ${args.chev}
            <span class="flex min-w-0 flex-1 flex-col gap-px">
              <span data-project-name class="truncate text-body font-medium leading-[1.3] text-text-primary">${escapeHtml(args.name)}</span>
            </span>
          </button>
          <span data-project-actions class="absolute right-[3px] top-1/2 flex -translate-y-1/2 items-center gap-px ${args.actions}">
            <button type="button" data-new-session aria-label="New session" data-hint="${hints.projectNewSession(escapeHtml(args.name))}"
              class="grid h-7 w-7 flex-none place-items-center rounded-control-sm pointer-coarse:h-10 pointer-coarse:w-10 text-text-tertiary transition-colors hover:bg-wash-hover hover:text-text-primary">${plusGlyph()}</button>
            <button type="button" data-project-menu="${escapeHtml(args.id)}" aria-label="Project menu" data-hint="${hints.projectMenu(escapeHtml(args.name))}" aria-haspopup="menu" aria-expanded="false"
              class="grid h-7 w-7 flex-none place-items-center rounded-control-sm pointer-coarse:h-10 pointer-coarse:w-10 text-text-tertiary transition-colors hover:bg-wash-hover hover:text-text-primary">${ellipsisGlyph()}</button>
          </span>
        </div>`;
}

// A project with no sessions would otherwise show an empty rail and no way
// in: the + on the project row is invisible until the row is hovered. This
// row fills that gap and then gets out of the way - once the project has a
// session, including a pending one, the sessions themselves are the content
// and the row's + is the way to add another.
//
// Comp desktop-r2 wraps this row in `sc-if p.empty` for exactly this reason:
// with sessions present it would be a second plus affordance a few pixels
// from the project row's own.
export function emptyRailNewSessionHtml(
  g: { sessions: readonly unknown[]; project: { id: string; name: string } },
  expanded: boolean,
  pending: PendingSession | null,
): string {
  if (!expanded) return "";
  if (g.sessions.length > 0) return "";
  if (pending !== null && pending.projectID === g.project.id) return "";
  return `<li><button type="button" data-new-session data-hint="${hints.projectNewSession(escapeHtml(g.project.name))}"
      class="flex w-full cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-left text-body leading-5 text-text-tertiary transition-colors hover:bg-wash-hover hover:text-text-primary focus-visible:bg-wash-hover max-md:min-h-11"><span aria-hidden="true" class="flex w-4 flex-none justify-center font-mono text-[min(var(--type-mono-size),calc(var(--type-body-size)*var(--type-mono-xh-ratio)))]">+</span><span class="min-w-0 flex-1">New session</span></button></li>`;
}

// The no-projects rail's single row (comp desktop-r16): a control-icon
// plus and a sentence-case label, in the interface voice — mono is the
// machine voice and never marks a creation affordance. It opens the
// same New project dialog the Projects menu's row does.
// An import in flight is a project that exists but cannot be opened yet
// (comp desktop-r35). It sits in the rail from the moment the clone
// starts, so dismissing the dialog costs nothing — the job kept its place
// in the list you would look for it in. No disclosure triangle and no
// action cluster: there is nothing to expand or start a session in.
// Clicking reopens the dialog.
export function cloneRowHtml(job: CloneJob): string {
  const running = job.status === "running";
  const stopped = !running;
  const hint = running
    ? `Cloning ${escapeHtml(job.url.replace(/^https?:\/\//, ""))} — click to reopen`
    : "Import stopped part-way — click to resume";
  return `<li><button type="button" data-clone-row="${escapeHtml(job.id)}" data-hint="${hint}"
      class="flex w-full cursor-pointer flex-col items-stretch gap-[5px] rounded-control px-2 py-1.5 text-left transition-colors hover:bg-wash-hover focus-visible:bg-wash-hover">
      <span class="flex w-full items-center gap-2">
        <span aria-hidden="true" class="flex w-[13px] flex-none justify-center ${stopped ? "text-warning" : "text-text-tertiary"}">${lucideIcon(running ? "download" : "triangle-alert", 12)}</span>
        <span class="min-w-0 flex-1 truncate text-body text-text-secondary">${escapeHtml(job.name)}</span>
        <span class="flex-none text-micro font-medium tabular-nums text-text-tertiary">${running ? `${job.percent}%` : ""}</span>
      </span>
      ${running ? `<span class="ml-[21px] block h-[3px] overflow-hidden rounded-pill bg-wash-hover"><span class="block h-full rounded-pill bg-accent" style="width:${job.percent}%"></span></span>` : ""}
      <span class="ml-[21px] text-micro font-medium text-text-tertiary">${running ? "importing" : "import incomplete"}</span>
    </button></li>`;
}

export function newProjectRowHtml(): string {
  return `<li><button type="button" data-new-project-row data-hint="${hints.ADD_WORKSPACE_DIRECTORY_AS_PROJECT}"
      class="flex w-full cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-left text-body leading-5 text-text-tertiary transition-colors hover:bg-wash-hover hover:text-text-primary focus-visible:bg-wash-hover"><span aria-hidden="true" class="flex w-4 flex-none justify-center">${plusGlyph()}</span><span class="min-w-0 flex-1">Add project</span></button></li>`;
}

export function pendingSessionRowHtml(
  pending: PendingSession | null,
  projectID: string,
): string {
  if (pending === null || pending.projectID !== projectID) return "";
  return `<li data-pending-session="${escapeHtml(pending.provider)}"
      class="flex items-center gap-2 rounded-control px-2 py-1.5">
      ${sessionTileHtml(pending.provider)}
      <span class="min-w-0 flex-1 truncate text-body text-text-tertiary">${escapeHtml(providerDisplayName(pending.provider))}</span>
      <span role="img" aria-label="starting"
        class="flex flex-none items-center"><span aria-hidden="true"
        class="block h-[11px] w-[11px] animate-row-spinner rounded-circle border-[1.5px] border-border-strong border-t-text-secondary"></span></span>
    </li>`;
}

// The wordmark for the expanded sidebar header is itself the collapse
// control (comp desktop-r1): the whole lockup is a button so the action
// is keyboard-reachable, and its accessible name says what happens rather
// than naming the brand. The artwork is decorative inside the button.
//
// The mark is flat. It takes no hover wash and no hover tint, because the
// brand is not a control surface — collapsing swaps it for the evidence-
// coloured mark, and that swap is the only state it reports. The
// focus-visible ring stays: it is how a keyboard reaches the control.
export function lockupImg(): string {
  return `<button type="button" data-collapse aria-label="Collapse sidebar" data-hint="${hints.COLLAPSE_PROJECT_SIDEBAR}"
    class="ml-(--space-2) grid h-6 place-items-center rounded-control-sm text-text-tertiary focus-visible:bg-wash-hover pointer-coarse:h-10">
    <img src="/brand/noisefloor-lockup-inverse.svg" alt="" width="99" height="20" class="block h-[20px] w-[99px] flex-none" draggable="false">
  </button>`;
}

// The PROJECTS header (comp desktop-r5): the micro, tracked, uppercase
// eyebrow is itself a menubar-style menu button. The authored copy stays
// sentence case in the markup; the comp applies the casing with
// text-transform so screen readers still read "Projects". The trigger is
// tertiary at rest and primary on hover — colour only, the label voice —
// and takes the pressed wash only while its menu is held open, like a
// pressed menubar title.
// The phone opens the sidebar as a sheet (comp mobile-r8 screen 02): a
// grabber, "Sessions" at title-3, and a close cell. Desktop hides all of it
// and keeps the lockup chrome; the phone hides the lockup and shows this.
// Both live in the markup so the two widths cannot render different bytes
// from different code paths.
export function sheetChromeHtml(search = ""): string {
  return `<div data-sidebar-sheet-chrome class="hidden">
    <div class="flex justify-center pb-0.5 pt-2">
      <span aria-hidden="true" class="h-1 w-[38px] rounded-pill bg-border-strong"></span>
    </div>
    <div class="flex items-center gap-2 pb-2 pl-5 pr-2 pt-1">
      <span class="flex-1 text-title-3 font-medium text-text-primary">Sessions</span>
      <button type="button" data-sidebar-sheet-menu aria-haspopup="menu" aria-expanded="false" aria-label="Projects menu" data-hint="${hints.OPEN_PROJECTS_MENU}"
        class="grid h-11 w-11 flex-none place-items-center rounded-control text-text-secondary transition-colors hover:text-text-primary">${lucideIcon("ellipsis", 18)}</button>
      <button type="button" data-sidebar-sheet-close aria-label="Close" data-hint="${hints.CLOSE_SESSION_LIST}"
        class="grid h-11 w-11 flex-none place-items-center rounded-control text-text-secondary transition-colors hover:text-text-primary">${lucideIcon("x", 18)}</button>
    </div>
    <!-- The comp's field carries no placeholder: the magnifier says it, and
         the aria-label carries it for a reader. -->
    <div class="px-4 pb-3">
      <label class="inputwrap">
        <span aria-hidden="true" class="inputwrap-lead">${lucideIcon("search", 16)}</span>
        <input data-sheet-filter value="${escapeHtml(search)}" aria-label="Filter sessions" autocapitalize="none" autocomplete="off" spellcheck="false"
          class="input input-lead font-input leading-[normal]">
      </label>
    </div>
  </div>`;
}

// The sheet's bottom bar (comp mobile-r8 screen 02): New session across the
// width, the folder cell beside it for Open project. These are the PROJECTS
// menu's affordances in the shape the phone draws them — the eyebrow leaves
// with the desktop drawer, so the bar is where its actions live at this
// width, not an addition to them.
export function sheetActionsHtml(noProjects = false): string {
  return `<div data-sidebar-sheet-actions class="hidden">
    <div class="flex items-center gap-2.5 border-t border-border px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
      <button type="button" data-sheet-new-session ${noProjects ? "disabled" : ""} data-hint="${hints.START_NEW_SESSION}"
        class="flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-control bg-accent text-body font-medium text-text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-45">${lucideIcon("plus", 18)}New session</button>
      <button type="button" data-sheet-open-project aria-label="Open project" data-hint="${hints.OPEN_DIRECTORY_AS_PROJECT}"
        class="grid h-12 w-12 flex-none place-items-center rounded-control border border-border text-text-secondary transition-colors hover:text-text-primary">${lucideIcon("folder", 18)}</button>
    </div>
  </div>`;
}

export function projectsHeaderHtml(): string {
  return `<div class="mb-1 flex min-h-[26px] items-center pr-[3px]">
    <button data-projects-menu aria-haspopup="menu" aria-expanded="false" data-hint="${hints.OPEN_PROJECTS_MENU}"
      class="rounded-control-sm px-2 py-[3px] text-micro font-medium uppercase leading-[1.55] tracking-(--type-micro-ls) text-text-tertiary transition-colors hover:text-text-primary aria-expanded:bg-wash-pressed">Projects</button>
  </div>`;
}

// Sort by name is a ONE-SHOT action, not a mode: it returns the ids in
// case-insensitive display-name order for the caller to store as the manual
// order, which stays hand-editable afterwards — nothing persists as a sort
// preference.
export function sortedProjectOrderByName(
  groups: readonly ProjectWithSessions[],
): string[] {
  return [...groups]
    .sort((a, b) => a.project.name.toLowerCase().localeCompare(b.project.name.toLowerCase()))
    .map((g) => g.project.id);
}

// The header menu's New session names its target: the project in context,
// else the first row as presented. Null only when no projects exist.
export function newSessionTargetProject(
  groups: readonly ProjectWithSessions[],
  order: readonly string[],
  selectedProjectID: string | null,
): { id: string; name: string } | null {
  const id = selectedProjectID !== null && order.includes(selectedProjectID)
    ? selectedProjectID
    : order[0];
  const project = groups.find((g) => g.project.id === id)?.project;
  return project === undefined ? null : { id: project.id, name: project.name };
}

// The PROJECTS header's plain plus (handoff: an IconButton, not a
// "+ New" pill).
function plusGlyph(): string {
  return lucideIcon("plus", 14);
}

// The collapsed rail's expand mark (reference railCollapsed branch): 20px,
// masked from the mark artwork and filled with --evidence rather than the
// artwork's own ink, so the mark carries the product's evidence colour on
// the chrome surface. The button's accessible name carries the identity;
// the mark itself is decorative.
function markImg(): string {
  const mask = "url(/brand/noisefloor-mark-inverse.svg) center/contain no-repeat";
  return `<span aria-hidden="true" class="block h-5 w-5 flex-none bg-evidence" style="-webkit-mask:${mask};mask:${mask}"></span>`;
}

// sessionTileHtml renders the 16px --radius-mark tile shared by the real
// session row and the pending-launch placeholder. Extracting it makes
// their parity structural instead of textual. Tiles carry
// colour, never letters: the background is the provider hue or the
// session-colour override, and nothing renders inside.
export function sessionTileHtml(provider: string, colorStyle = ""): string {
  return `<span class="h-4 w-4 flex-none rounded-mark ${providerTileClass(provider)}" ${colorStyle}></span>`;
}

// The project-row ⋯: three dots at the row-icon
// size, echoing the titlebar's session-menu glyph.
function ellipsisGlyph(): string {
  return lucideIcon("ellipsis", 13);
}

// The search shortcut chip follows the operator's platform:
// ⌘ on macOS/iOS, Ctrl everywhere else. The binding itself (metaKey ||
// ctrlKey) already accepts both; this is the honest label.
function modKeyChip(): string {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return modKeyLabel(nav.userAgentData?.platform, nav.userAgent);
}

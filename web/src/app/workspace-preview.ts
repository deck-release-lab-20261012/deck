// The visual preview: the full workspace composed with fixture data
// (app/fixtures.ts) for deterministic screenshots and interaction probes.
// NOT the app entry — main.ts is. It is terminal-native: the terminal is the
// only input surface, and there is no composer/outbox.
import { GitHubConnectDialog } from "../github-connect/dialog.ts";
import { TutorialModel, defaultTutorialCatalog } from "./tutorial.ts";
import { TutorialPanel } from "./tutorial-panel.ts";
import { firstProjectCatalog } from "./tutorial-first-project.ts";
import { exploreTutorialCatalog, exploreChoice, selectExplore } from "./tutorial-explore.ts";
import { TutorialProjectView } from "./tutorial-project-view.ts";
import { configureProjectPreviewFixture, applyProjectPreviewFixture } from "./project-preview-fixtures.ts";
import "../styles/app.css";
import "../preview/preview.css";
import { SidebarModel } from "../panels/sidebar/sidebar.ts";
import { Sidebar } from "../panels/sidebar/sidebar-dom.ts";
import { TaskmasterPanelModel } from "../panels/taskmaster/taskmaster-panel.ts";
import { TaskmasterPanel } from "../panels/taskmaster/taskmaster-panel-dom.ts";
import { FilesPanelModel } from "../panels/files/files-panel.ts";
import { FilesPanel } from "../panels/files/files-panel-dom.ts";
import type { ChatIndex } from "../api/client.ts";
import { ChatsPanelModel, chatHandles, chatMarks } from "../panels/chats/chats-panel.ts";
import { ChatsPanel } from "../panels/chats/chats-panel-dom.ts";
import {
  emptyPaneHtml,
  emptyTitlebarHtml,
  titlebarRightHtml,
} from "../ui/empty-pane.ts";
import {
  projectIdentityHtml,
  terminalIdentityHtml,
} from "../ui/terminal-identity.ts";
import {
  FixtureApiClient,
  fixtureProject,
  fixtureProjects,
  fixtureSessionDetail,
  fixtureSessions,
} from "./fixtures.ts";
import { focusPanelTrigger, mountPanelsMenu } from "../ui/panel-trigger.ts";
import { DockedPanels } from "./docked-panels.ts";
import { InfoBar } from "./info-bar.ts";
import { showAutoColorProjects } from "../lib/auto-color.ts";
import { region, workspaceLayout } from "./layout.ts";
import { sessionMenuHtml } from "./session-menu.ts";
import { ThemeDialog } from "./theme-dialog.ts";
import {
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  terminalFontSize,
} from "../terminal/font-size.ts";
import { customThemeSlots, resolveTerminalTheme, terminalThemeName } from "../terminal/theme.ts";
import type { TerminalThemeName } from "../terminal/themes.ts";
import { currentTheme } from "./theme.ts";
import {
  applyTerminalChromeVars,
  customThemeChromeSlots,
  terminalChromePalette,
} from "../terminal/palette.ts";
import {
  RECOVERY_MONO,
  recoveryComposerHtml,
  recoveryBannerHtml,
  recoveryRegisterHtml,
  recoveryStreamHtml,
  referenceRecovery,
  type RecoveryState,
} from "./recovery.ts";
import {
  FILES_DEPTH_PATHS,
  describeState,
  parsePreviewParams,
} from "../preview/preview-states.ts";
import { inertSoftKeyTerminal, MobileTerminalSoftKeys, setSoftKeysInert } from "../terminal/soft-keys.ts";
import { MobileTerminalCompose, isComposeSubmitIntent } from "../terminal/mobile-compose.ts";
import { mobileComposeMarkup } from "../terminal/mobile-compose-markup.ts";
import * as hints from "../lib/hints.ts";

document.documentElement.dataset.theme = currentTheme();

const params = new URLSearchParams(window.location.search);
// Parse and validate every URL axis up front so an unknown value fails
// loudly (the page carries data-preview-error) instead of silently rendering
// the default state.
const state = (() => {
  try {
    return parsePreviewParams(params);
  } catch (err) {
    document.documentElement.dataset.previewError =
      err instanceof Error ? err.message : String(err);
    throw err;
  }
})();
const taskState = state.tasks;
const delayedRemoval = state.delayedRemoval;
// The recovery states are forced here so the screenshot fixture can exercise
// all four presentations (handoff §10); the live app derives them from
// the server-presented session record instead. Replayed and failed are
// FIXTURE-ONLY: referenceRecovery supplies their facts because the server
// presents neither state today.
const recoveryState: RecoveryState = state.recovery;
const recovery = referenceRecovery(recoveryState);
const previewSession = fixtureSessionDetail;
const emptyState = state.empty;
const api = new FixtureApiClient(
  taskState,
  delayedRemoval,
  previewSession,
  emptyState === "no-project" ? [] : state.projectPreview === null ? fixtureProjects : fixtureProjects.map((project) => project.id === fixtureProject.id ? { ...project, name: "rewrite-scheduler" } : project),
  state.roots,
  state.identities,
  state.filesConflict,
);
if (state.projectPreview !== null) configureProjectPreviewFixture(api, state.projectPreview);
// The loading states hold the registry read open or fail it: the shell
// then draws exactly what the live app draws before, or without, an
// answer (comp Workspace Loading State).
if (emptyState === "loading") api.listProjects = () => new Promise<never>(() => {});
if (emptyState === "error") api.listProjects = () => Promise.reject(new Error("project registry unavailable"));
// The phone frame reserves the mobile comp's device mock — a 12px figure
// gutter, a 1px bezel, the 54px status strip and the 35px home band — so the
// app's content lands at the reference's origin. It reserves those bands
// rather than drawing them: the status bar and the home indicator belong to
// the OS, and the gate masks every reserved band. Capture scaffolding only —
// production renders into the real viewport.
if (state.frame === "phone") {
  document.documentElement.dataset.previewFrame = "phone";
  const frame = document.createElement("div");
  frame.dataset.phoneFrame = "";
  // Blueprint mirrors its phone metrics onto [data-viewport="narrow"] so a
  // device frame drawn inside a wide page gets them: a media query keys off
  // the viewport, which here is the review page, not the frame. Production
  // needs no such attribute — the real viewport fires the queries.
  frame.dataset.viewport = "narrow";
  document.body.prepend(frame);
  frame.append(document.querySelector("#app")!);
}
const root = document.querySelector<HTMLDivElement>("#app")!;
root.innerHTML = workspaceLayout();

// Sidebar.
const sidebarModel = new SidebarModel(api, { onProvidersChanged: () => sidebar.renderNewSessionPicker() });
// Title bar: the session identity left — the selected session's own name,
// "claude" at rest, as the comp draws it — the two docked-panel triggers and
// the more control right; the more control is an anchored popover. The chip
// resolves its facts from the sidebar model's groups — the same session row
// and derived tint its sidebar tile renders from — exactly as the live
// titlebar does, and it derives the session from the model's selection so a
// row click moves it; the groups are empty and nothing is selected at this
// first paint, so the fixture session is the identity and the chip starts on
// the provider hue, repainting below once the model settles. The empty
// states (comp desktop-r16) instead paint the pane's own titlebar through
// the same helpers the live shell uses, so the fixture mirrors the shipped
// chrome rather than a stand-in.
const titlebarIdentity = (): string => {
  const id = sidebarModel.selectedSessionID ?? previewSession.id;
  const group = sidebarModel.groups.find((g) => g.sessions.some((s) => s.id === id));
  return terminalIdentityHtml(
    group?.sessions.find((s) => s.id === id) ?? previewSession,
    group?.autoColor,
  );
};
// The chip's one repaint path. Any control that changes the selected
// session's resolved tile colour redraws the sidebar's rows, and every
// row redraw re-resolves the chip against the same group the tile just
// rendered. The preview has no status poll, so a second repaint path is
// a surface that can fall out of step and never heal. The no-session
// state's project identity rides the same redraw: a row redraw re-resolves
// the project in context exactly as the session chip re-resolves its row.
const syncTitlebarIdentity = (): void => {
  const identity = region(root, "terminal-titlebar").querySelector("[data-terminal-identity]");
  if (identity === null) return;
  const html = emptyState === "no-session"
    ? (() => {
      const target = sidebar.newSessionTarget();
      return target === null ? null : projectIdentityHtml(target, target.tint);
    })()
    : emptyState === null
      ? titlebarIdentity()
      : null;
  if (html !== null && identity.outerHTML !== html) identity.outerHTML = html;
};
const openGitHubPreview = (): void => {
  const host = document.createElement("div");
  region(root, "modals").append(host);
  const dialog = new GitHubConnectDialog(host, {
    status: async () => ({ outcome: "authenticated", login: "preview-user", source: "stored", active: true, state: "success" }),
    current: async () => ({ csrf: "preview", attempt: null }),
    start: async () => { throw new Error("Preview does not start native login"); },
    cancel: async () => { throw new Error("Preview does not cancel native login"); },
  }, { onClosed: () => host.remove() });
  dialog.open();
};
const sidebar = new Sidebar(region(root, "sidebar"), sidebarModel, syncTitlebarIdentity, openGitHubPreview, {
  tutorialUnavailableReason: () => tutorial.state.phase === "ready" ? null : "The tutorial is still loading. Try again in a moment.",
  onTutorial: () => {
    if (tutorial.state.phase !== "ready") return;
    panels.close();
    tutorial.selectLesson("first-project-create");
    tutorial.reopen();
  },
});

// renderEmptySurfaces paints both empty states' chrome: the titlebar the
// comp draws for each kind and the pane's own anatomy, on the page surface
// rather than the themed terminal ground. Pre-refresh the sidebar has no
// groups yet, so the project in context falls back to the fixture project
// — which is also the first row as presented once the groups settle, so
// the repaint below lands on the same name.
const renderEmptySurfaces = (): void => {
  if (emptyState === null) return;
  const target = sidebar.newSessionTarget()
    ?? { id: fixtureProject.id, name: fixtureProject.name, tint: null };
  const project = emptyState === "no-session"
    ? { name: target.name, tint: target.tint }
    : null;
  region(root, "terminal-titlebar").innerHTML = emptyTitlebarHtml("titlebar", {
    kind: emptyState,
    project,
    sessions: emptyState === "no-session",
  });
  const terminal = region(root, "terminal");
  terminal.innerHTML = emptyPaneHtml({
    kind: emptyState,
    projectName: project?.name ?? null,
    error: sidebarModel.error ?? "",
    phase: "reconnect",
  });
  terminal.style.backgroundColor = "var(--color-surface)";
  region(root, "terminal-card").style.backgroundColor = "var(--color-surface)";
  // The pane's one action reaches the same dialogs the sidebar's rows open,
  // exactly as the live shell wires it.
  terminal.querySelector("[data-empty-action]")?.addEventListener("click", () => {
    if (emptyState === "no-project") sidebar.openNewProject("[data-empty-action]");
    else if (emptyState === "error") void sidebar.refresh();
    else sidebar.openNewSession(target.id);
  });
};

if (emptyState === null) {
  region(root, "terminal-titlebar").innerHTML = `
    ${titlebarIdentity()}
    ${titlebarRightHtml("titlebar", { panels: true, sessions: true, chats: { pressed: false, unseen: true } })}
  `;
} else {
  renderEmptySurfaces();
}

// The info bar mirrors the live surface: hover/focus hints only, with no
// resting copy. The comp's reference PNG still shows
// an idle status line at rest; that region must be masked or
// accepted as a known offset when the visual-diff baseline is wired.
// Preview-local, like the font and theme above — it reads the operator's
// preference but never writes it.
const infoBar = new InfoBar(root);

const terminal = region(root, "terminal");
const terminalCard = region(root, "terminal-card");
// The empty states have no terminal to paint: renderEmptySurfaces already
// filled the pane and put it on the page surface.
if (emptyState === null) {
  terminal.dataset.mono = "operator";
  // The recovery presentation is forced by the ?recovery= param; the marker
  // lets the capture harness verify which state rendered.
  terminal.dataset.recoveryState = state.recovery;
  // Terminal pane: the CLI's own pixels (fixture), following the theme. The
  // fixture mirrors the live column split: scrolling output flexes, the
  // machine register stays pinned below. The four recovery states render at
  // the end of the stream in the machine register, forced by the
  // ?recovery= URL param.
  terminal.classList.add("flex", "flex-col");
  // The phone fixture renders the status line and composer in the mobile
  // dock, so the recovery register and composer are hidden there.
  // Rendered whatever the frame, exactly as live.ts renders it; the phone
  // scope hides it in CSS. A frame-conditional here was live/preview drift:
  // the preview omitted what the live app drew, and the capture certified a
  // screen the app did not have.
  const register = recoveryRegisterHtml(recovery);
  const composer = state.frame === "phone" ? "" : recoveryComposerHtml(recovery);
  terminal.innerHTML = `
    ${recoveryBannerHtml(recovery)}
    <div data-terminal-scrollback data-recovery-scrollback class="min-h-0 flex-1 overflow-y-auto ${RECOVERY_MONO} text-(--t-dim)">
      ${previewScrollbackHtml(
        state.frame === "phone" ? "phone" : "desktop",
        !(state.frame === "phone" && recovery.state === "restarting"),
      )}
      ${recoveryStreamHtml(recovery)}
    </div>
    ${composer}
    ${register}
  `;
  const terminalTheme = terminalThemeName();
  const terminalSlots = terminalTheme === "custom"
    ? customThemeChromeSlots(customThemeSlots())
    : terminalChromePalette(terminalTheme, resolveTerminalTheme(terminalTheme));
  applyTerminalChromeVars(terminal, terminalSlots);
  terminal.style.backgroundColor = terminalSlots.bg;
  terminalCard.style.backgroundColor = terminalSlots.bg;
}

// The phone fixture mounts the bottom dock on every phone screen, because the
// dock is what sizes the terminal above it: a screen that drops the dock lets
// the terminal grow into its space and shifts every line of the scrollback the
// comp draws behind a sheet. Only the input row is withheld when the session is
// not live. The terminal itself is static fixture output,
// so the soft keys and compose are wired to no-op handlers; only the visual
// anatomy and a11y labels matter here.
function mountPreviewMobileDock(live: boolean): void {
  // The same condition the live app mounts on, and the one app.css paints the
  // dock at. A phone frame drawn inside a wide review page is below the
  // boundary in its own box but not in the viewport the query reads, and
  // mounting there would put a strip of keys in the a11y tree with nothing on
  // screen.
  if (!window.matchMedia("(max-width: 600px)").matches) return;
  const status = region(root, "terminal-status");
  status.innerHTML = `
    <span aria-hidden="true" class="text-(--color-console-accent)">▶▶</span>
    <span class="text-(--color-console-accent)">accept edits on · 1 agent</span>
  `;
  // The same receiver the live app binds a recovery strip to. A fixture that
  // builds its own describes chrome the app does not have.
  const softKeys = new MobileTerminalSoftKeys(region(root, "terminal-soft-keys"), inertSoftKeyTerminal());
  region(root, "terminal-dock").toggleAttribute("data-dock-mounted", true);
  // The screenshot fixture pops the arrow pad on the phone's primary screens,
  // matching the comp reference; the live app keeps it closed until the
  // operator asks. The pad is presentation, so a session that is not live
  // shows it too — only the input row below is withheld.
  const isDefaultPhoneScreen = state.frame === "phone" &&
    state.panel === null &&
    state.menu === null &&
    state.dialog === null &&
    state.empty === null;
  const popArrowPad = (focusInput: (() => void) | null): void => {
    if (!isDefaultPhoneScreen) return;
    requestAnimationFrame(() => {
      softKeys.openArrowPad();
      focusInput?.();
      // The popped arrow pad is absolute above the dock; add the same
      // vertical space at the end of the scrollback so the fixture content
      // stops at the pad's top edge instead of running underneath it.
      const pad = region(root, "terminal-soft-keys").querySelector<HTMLElement>("[data-terminal-arrow-pad-popover]");
      const scrollback = terminal.querySelector<HTMLElement>("[data-terminal-scrollback]");
      if (pad !== null && scrollback !== null) {
        scrollback.style.paddingBottom = `${Math.ceil(pad.getBoundingClientRect().height)}px`;
      }
    });
  };
  // A session that is not live carries no input surface: there is nothing to
  // type to. The status row and the key strip stay, because the comp draws
  // them and because they are presentation, not input authority.
  if (!live) {
    setSoftKeysInert(region(root, "terminal-soft-keys"), true);
    return;
  }
  const composeHost = region(root, "terminal-compose");
  composeHost.innerHTML = mobileComposeMarkup();
  const compose = new MobileTerminalCompose({ paste: () => {}, sendInput: () => {} });
  const input = composeHost.querySelector<HTMLTextAreaElement>("[data-mobile-compose-input]")!;
  const form = composeHost.querySelector<HTMLFormElement>("[data-mobile-compose-form]")!;
  input.addEventListener("beforeinput", (event) => {
    if (!isComposeSubmitIntent((event as InputEvent).inputType)) return;
    event.preventDefault();
    compose.flush(input.value);
    input.value = "";
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    compose.flush(input.value);
    input.value = "";
    input.focus();
  });
  popArrowPad(() => input.focus());
}

if (emptyState === null && state.frame === "phone") {
  mountPreviewMobileDock(state.recovery === "live");
}

// The preview's static scrollback is already at the live end, so no
// jump-to-live pill renders in the fixture.


// The two docked panels, on the fixture client: the same components the
// live app mounts, driven by the same coordinator, so exactly one of them
// is open and the terminal beside it keeps its own pixels.
let tutorialPanel: TutorialPanel | null = null;
const tutorial = new TutorialModel(api, [...defaultTutorialCatalog, ...firstProjectCatalog, ...exploreTutorialCatalog], {
  onChange: () => tutorialPanel?.update(tutorial.state, panels.open !== null),
});
const panels = new DockedPanels(
  (name) => root.querySelector<HTMLElement>(`[data-region="${name}"]`),
  {
    onChange: () => tutorialPanel?.update(tutorial.state, panels.open !== null),
    onOpen: (name) => {
      if (name === "files") void files.open();
      else if (name === "chats") void chats.open().then(() => paintChatFacts());
      else void tm.refresh();
    },
    onClose: (name) => {
      if (name === "files") files.close();
      else if (name === "chats") {
        chats.close();
        paintChatFacts();
      }
    },
  },
);
const tutorialProject = new TutorialProjectView(root, api, {
  changed: () => tutorialPanel?.update(tutorial.state, panels.open !== null),
  captureSelection: () => () => false,
  insert: () => false,
  selectSession: async () => {},
});
tutorialPanel = new TutorialPanel(root, tutorial, {
  renderStep: (lesson) => exploreChoice(lesson.id, tutorialProject.render(lesson.id)),
  onAction: (action) => {
    if (selectExplore(tutorial, action)) return;
    void tutorialProject.action(action);
  },
  showStep: () => { panels.close(); tutorial.expand(); },
  onClose: () => root.querySelector<HTMLElement>("[data-titlebar-more]")?.focus(),
});
// Existing reference states depict returning operators; tutorial states opt in.
void (async () => {
  if (params.get("tutorial") !== "open") {
    await api.saveTutorial({ version: 1, dismissed: true, lesson: "welcome", step: 0, done: [] });
  }
  tutorial.load();
})();
// The Chats ledger on the fixture: the comp's live room with an uncertain
// recipient, read for the selected session's agent (handoff §23).
const chatsModel = new ChatsPanelModel(api, previewSession.id);
const chats = new ChatsPanel(region(root, "chats-body"), chatsModel, {
  onClose: () => { panels.close(); focusPanelTrigger(root, "titlebar", "chats"); },
});
// The sidebar marks every session in a live chat from the content-free
// index, as the live shell does. The selected session's mark reads the
// panel model's own seen state, so opening the panel clears both accents
// in the same tick; the other sessions have seen nothing in the fixture.
let chatIndex: ChatIndex | null = null;
const paintChatMarks = (): void => {
  if (chatIndex === null) return;
  const sessions = Object.values(fixtureSessions).flat();
  sidebar.setChatMarks(chatMarks(chatIndex, chatHandles(chatIndex, sessions), (sessionID, chatID) =>
    sessionID === previewSession.id ? chatsModel.seenLastRow(chatID) : undefined));
};
const paintChatFacts = (): void => {
  for (const trigger of root.querySelectorAll<HTMLElement>('[data-titlebar-chats], [data-titlebar-panels], [data-panel-choice="chats"]')) trigger.setAttribute("data-unseen", chatsModel.unseen && !panels.isOpen("chats") ? "true" : "false");
  root.querySelector<HTMLElement>("[data-titlebar-chats]")?.setAttribute("aria-pressed", panels.isOpen("chats") ? "true" : "false");
  infoBar.setNews(chatsModel.news);
  paintChatMarks();
};
void chats.refresh().then(paintChatFacts);
void api.listChats().then((index) => {
  chatIndex = index;
  paintChatMarks();
});
const tmModel = new TaskmasterPanelModel(api, fixtureProject.id);
const tm = new TaskmasterPanel(region(root, "tasks-body"), tmModel, {
  onClose: () => panels.close(),
});
const filesModel = new FilesPanelModel(api, fixtureProject.id, fixtureProject.canonical_path, {
  onChange: () => files.render(), onProgress: (record) => files.progress(record),
});
const files = new FilesPanel(region(root, "files-body"), filesModel, {
  onClose: () => {
    panels.close();
    focusPanelTrigger(root, "titlebar", "files");
  },
});
// The no-project titlebar carries no panel triggers, so the binds are
// optional: the hooks simply are not there to find.
root.querySelector("[data-titlebar-sessions]")?.addEventListener("click", () => sidebar.open());
root.querySelector("[data-titlebar-tasks]")?.addEventListener("click", () => panels.toggle("tasks"));
root.querySelector("[data-titlebar-files]")?.addEventListener("click", () => panels.toggle("files"));
root.querySelector("[data-titlebar-chats]")?.addEventListener("click", () => panels.toggle("chats"));

// The comp's resting state is both panels closed: the terminal is the app
// and a panel is something the operator asks for. The ?panel= param opens
// one explicitly, through the same coordinator the triggers use.
if (state.panel === "files") panels.set("files");
else if (state.panel === "tasks") panels.set("tasks");
else panels.close();

// More control: anchored popover with click-away. Dismissal is
// click-away-ONLY: the handler sits on the fixed full-viewport backdrop
// and closes only when the backdrop itself is the event target, so a
// click that lands inside the panel never bubbles into a close. The panel
// renders in the shared popover region, separate from the titlebar.
const popovers = region(root, "popovers");
let panelsMenuCleanup: (() => void) | null = null;
const closePopover = (): void => {
  panelsMenuCleanup?.();
  panelsMenuCleanup = null;
  popovers.replaceChildren();
};
const anchorPopover = (panel: string, rect: DOMRect): void => {
  popovers.innerHTML = `<div class="absolute inset-0" data-popover-backdrop>${panel}</div>`;
  const backdrop = popovers.querySelector("[data-popover-backdrop]")!;
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closePopover();
  });
  const menu = popovers.querySelector<HTMLElement>("[data-more-popover]");
  if (menu === null) return;
  menu.style.top = `${rect.bottom + 6}px`;
  menu.style.left = `${Math.max(8, rect.right - menu.offsetWidth)}px`;
};
// The ⋯ panel is the REAL More menu (session-menu.ts, shared with
// app/live.ts) so screenshot comparisons against the design exercise the
// shipped chrome, not a stand-in. State is preview-local on
// purpose: the preview must not persist font/theme/preference changes into
// the storage the live app reads.
let menuFontSize = terminalFontSize();
let menuTheme: TerminalThemeName = terminalThemeName();
let themeFlyoutOpen = false;
// Preview-local, like the font and theme above: the preview must never
// write the live console's settings or the live info-bar preference.
let previewSkipPermissions = false;
let previewConfirmingYolo = false;
let previewSkipCloseConfirm = false;
let previewSkipRemoveProjectConfirm = false;
let previewShowInfoBar = infoBar.isShown;
// The rail toggle is preview-local like the info bar above: it drives
// the real sidebar shell but persists nothing.
let previewShowSidePanel = !sidebar.isCollapsed;
// The custom slots are preview-local like the theme pick above: Apply
// paints the fixture's terminal but never writes the storage the live
// workspace reads.
let previewCustomSlots = customThemeSlots();
let previewAutoColor = showAutoColorProjects();

const openMore = (): void => {
  closePopover();
  const trigger = root.querySelector<HTMLButtonElement>("[data-titlebar-more]");
  if (trigger === null) return;
  anchorPopover(sessionMenuHtml({
    fontSize: menuFontSize,
    themeName: menuTheme,
    themeFlyoutOpen,
    customSlots: previewCustomSlots,
    showSidePanel: previewShowSidePanel,
    showInfoBar: previewShowInfoBar,
    autoColorProjects: previewAutoColor,
    skipPermissions: previewSkipPermissions,
    confirmingYolo: previewConfirmingYolo,
    skipCloseConfirm: previewSkipCloseConfirm,
    skipRemoveProjectConfirm: previewSkipRemoveProjectConfirm,
  }), trigger.getBoundingClientRect());
  const menu = popovers.querySelector<HTMLElement>("[data-more-popover]");
  if (menu === null) return;
  const stepFont = (delta: number): void => {
    menuFontSize = Math.min(
      MAX_TERMINAL_FONT_SIZE,
      Math.max(MIN_TERMINAL_FONT_SIZE, menuFontSize + delta),
    );
    const label = menu.querySelector("[data-font-size]");
    if (label !== null) label.textContent = String(menuFontSize);
  };
  menu.querySelector("[data-font-dec]")?.addEventListener("click", () => stepFont(-1));
  menu.querySelector("[data-font-inc]")?.addEventListener("click", () => stepFont(1));
  // Toggle rows: real buttons so the whole row is the hit target and the
  // keyboard toggles it for free; state is the label colour.
  const toggle = (selector: string, apply: () => void): void => {
    menu.querySelector(selector)?.addEventListener("click", apply);
  };
  toggle("[data-show-side-panel]", () => {
    sidebar.toggleCollapsed();
    previewShowSidePanel = !sidebar.isCollapsed;
    openMore();
  });
  toggle("[data-show-tutorial]", () => {
    closePopover();
    panels.close();
    tutorial.reopen();
  });
  toggle("[data-show-info-bar]", () => {
    previewShowInfoBar = !previewShowInfoBar;
    openMore();
  });
  toggle("[data-confirm-before-closing]", () => {
    previewSkipCloseConfirm = !previewSkipCloseConfirm;
    openMore();
  });
  toggle("[data-confirm-before-removing]", () => {
    previewSkipRemoveProjectConfirm = !previewSkipRemoveProjectConfirm;
    openMore();
  });
  const toggleYolo = (): void => {
    if (!previewSkipPermissions) { previewConfirmingYolo = true; openMore(); return; }
    previewSkipPermissions = false;
    openMore();
  };
  menu.querySelector("[data-skip-permissions]")?.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (
      target.closest("[data-yolo-cancel]") !== null ||
      target.closest("[data-yolo-confirm]") !== null
    ) {
      return;
    }
    toggleYolo();
  });
  menu.querySelector("[data-yolo-cancel]")?.addEventListener("click", () => {
    previewConfirmingYolo = false;
    openMore();
  });
  menu.querySelector("[data-yolo-confirm]")?.addEventListener("click", () => {
    previewSkipPermissions = true;
    previewConfirmingYolo = false;
    openMore();
  });
  menu.querySelector("[data-auto-color]")?.addEventListener("click", () => {
    previewAutoColor = !previewAutoColor;
    sidebarModel.setAutoColorProjects(previewAutoColor);
    sidebar.render();
    openMore();
  });
  // The fixture mirrors the live menu's pushed navigation: focus is placed
  // by hand because each push and pop remounts the menu, and Escape steps
  // back one level rather than dismissing the whole surface.
  const focusInMore = (selector: string): void => {
    document
      .querySelector<HTMLElement>(`[data-region="popovers"] [data-more-popover] ${selector}`)
      ?.focus();
  };
  const menuIsNarrow = (): boolean =>
    window.matchMedia("(max-width: 600px)").matches
    || root.closest("[data-viewport=\"narrow\"]") !== null;
  menu.querySelector("[data-theme-flyout]")?.addEventListener("click", () => {
    themeFlyoutOpen = !themeFlyoutOpen;
    openMore();
    if (menuIsNarrow()) {
      focusInMore(themeFlyoutOpen ? "[data-theme-back]" : "[data-theme-flyout]");
    }
  });
  menu.querySelector("[data-theme-back]")?.addEventListener("click", () => {
    const wasNarrow = menuIsNarrow();
    themeFlyoutOpen = false;
    openMore();
    if (wasNarrow) focusInMore("[data-theme-flyout]");
  });
  // Escape is caught from anywhere in the menu, at every width, because
  // that is the contract the rest of the app's menus follow — gating it on
  // the narrow scope would leave a desktop keyboard with no way out and
  // make the two surfaces disagree about the same key.
  menu.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    if (themeFlyoutOpen && menuIsNarrow()) {
      themeFlyoutOpen = false;
      openMore();
      focusInMore("[data-theme-flyout]");
      return;
    }
    closePopover();
    document.querySelector<HTMLElement>("[data-titlebar-more]")?.focus();
  });
  menu.querySelector("[data-theme-close]")?.addEventListener("click", () => {
    closePopover();
  });
  menu.querySelector("[data-settings-sheet-close]")?.addEventListener("click", () => {
    closePopover();
    document.querySelector<HTMLElement>("[data-titlebar-more]")?.focus();
  });
  menu.querySelectorAll<HTMLButtonElement>("[data-theme-pick]").forEach((button) => {
    button.addEventListener("click", () => {
      menuTheme = button.dataset.themePick as TerminalThemeName;
      openMore();
    });
  });
  menu.querySelector("[data-theme-custom-open]")?.addEventListener("click", () => {
    closePopover();
    new ThemeDialog(region(root, "modals"), previewCustomSlots, (slots) => {
      previewCustomSlots = slots;
      menuTheme = "custom";
      const chrome = customThemeChromeSlots(slots);
      applyTerminalChromeVars(terminal, chrome);
      terminal.style.backgroundColor = chrome.bg;
      terminalCard.style.backgroundColor = chrome.bg;
    });
  });
  menu.querySelector("[data-github-connect]")?.addEventListener("click", () => { closePopover(); openGitHubPreview(); });
  menu.querySelector("[data-git-identities]")?.addEventListener("click", () => {
    closePopover();
    sidebar.openGitIdentitySettings();
  });
};
// Empty-state refreshes replace the titlebar and its menu button.
root.addEventListener("click", (event) => {
  if (event.target instanceof Element && event.target.closest("[data-titlebar-more]")) openMore();
  if (event.target instanceof Element && event.target.closest("[data-titlebar-panels]")) {
    closePopover();
    panelsMenuCleanup = mountPanelsMenu(root, "titlebar", closePopover, (panel) => panels.toggle(panel));
  }
});

void (async () => {
  // The unanswered read never settles, so the shell is drawn from the
  // model's initial state and the page marks itself ready there.
  if (emptyState === "loading") {
    void sidebarModel.refresh();
    sidebar.render();
    renderEmptySurfaces();
    markPreviewState();
    return;
  }
  await sidebarModel.refresh();
  sidebarModel.setAutoColorProjects(previewAutoColor);
  // The comp's resting selection is the claude row; selecting through the
  // model puts the wash on the row the terminal already presents. The
  // empty states hold no selection: nothing is open, so nothing renders
  // selected, and the pane repaints from the settled groups.
  if (emptyState === null) {
    sidebarModel.select(previewSession.id);
    sidebar.render();
    // Fixture parity with the reference session rows (handoff §7): the
    // codex row is the one actively running, so it keeps a spinner instead
    // of its age tick. The preview is static, so the streaming window is
    // primed once and held — no output edges arrive to retrigger it.
    sidebar.setStreaming("sess-2", true);
    await tmModel.refresh();
    tm.render();
  } else {
    sidebar.render();
    renderEmptySurfaces();
  }
  try {
    await applyPreviewState();
  } catch (err) {
    // A state that cannot be reached must say so on the page: the harness
    // reads this attribute, and an unmarked page is indistinguishable from a
    // slow one.
    document.documentElement.dataset.previewError =
      err instanceof Error ? err.message : String(err);
    throw err;
  }
  markPreviewState();
  // The live workspace's sidebar poll, on demand: refresh the model, then
  // render. The interval starts only after the page has settled and marked
  // its state, so a tick never interleaves with the settle's own renders;
  // state the settle changed after its last render (the primed streaming
  // spinner) shows up in the first tick's markup and repaints then.
  if (state.sidebarPollMS !== null) {
    window.setInterval(() => {
      void sidebar.refresh();
    }, state.sidebarPollMS);
  }
})();

// applyPreviewState reaches the URL-requested presentation. Each
// branch mirrors the exact state the corresponding operator gesture produces,
// so a capture driven by a bare URL cannot silently land on the default view.
async function applyPreviewState(): Promise<void> {
  if (state.projectPreview !== null) {
    if (state.projectPreview.startsWith("menu-")) {
      if (sidebar.isCollapsed) sidebar.toggleCollapsed();
      sidebar.openProjectMenu(fixtureProject.id);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      (document.activeElement as HTMLElement | null)?.blur();
    } else {
      const opening = sidebar.openProjectPreviewSettings(fixtureProject.id);
      if (state.projectPreview !== "loading") {
        const dialog = await opening;
        if (dialog !== null) await applyProjectPreviewFixture(dialog, state.projectPreview, state.projectPreviewDetails);
      }
    }
  }
  // Files panel navigation and viewer, on top of the ?panel=files selection.
  // filesSelect admits on its own: a selection asked for at the root is a
  // supported combination, and leaving it out meant an unresolved name never
  // reached the check below — the page rendered an unselected list and marked
  // itself reached, which is the false state this axis exists to prevent.
  if (state.filesDepth !== null || state.filesSelect !== null || state.viewer !== null || state.filesConflict || state.filesUpload !== null) {
    panels.set("files");
    await files.open();
    if (state.filesDepth !== null) {
      await filesModel.openDirectory(FILES_DEPTH_PATHS[state.filesDepth] ?? "");
    }
    if (state.filesSelect !== null) {
      const entry = filesModel.entries().find((candidate) =>
        !candidate.dir && candidate.name === state.filesSelect
      );
      // A name that matches nothing must stop the capture. Selecting silently
      // renders the unselected list, which is a different screen wearing the
      // requested state's name.
      if (entry === undefined) {
        throw new Error(
          `files-select ${JSON.stringify(state.filesSelect)} matches no file in ` +
            `${JSON.stringify(FILES_DEPTH_PATHS[state.filesDepth ?? 0] ?? "")}`,
        );
      }
      filesModel.selected = entry;
      filesModel.view = null;
    }
    // The files panel places focus on its first row for keyboard users; the
    // comp's screenshot is a resting, pointer-driven state with no focus ring.
    (document.activeElement as HTMLElement | null)?.blur();
    if (state.filesUpload !== null) {
      const specs = [
        { name: "screenshots.zip", status: state.filesUpload === "unconfirmed" ? "unconfirmed" : "uploading", sent: 10_065_510, total: 29_779_558 },
        { name: "fixtures.json", status: "confirming", sent: 819_200, total: 819_200 },
        { name: "labels.csv", status: "queued", sent: 0, total: 512_000 },
        { name: "model-weights.bin", status: "too-large", sent: 0, total: 35_000_000 },
      ] as const;
      filesModel.uploadRecords = specs.map((spec, index) => ({
        ...spec, id: index + 1, file: new File([], spec.name), destDir: "", error: null,
        position: index + 1, batchSize: specs.length, replaces: false,
      }));
      if (state.filesUpload !== "live") filesModel.selectUpload(filesModel.uploadRecords[0]!);
    }
    if (state.filesConflict) {
      // The ask reached the way an operator reaches it: a two-file pick
      // whose names the fixture already holds. The session, the 1 of 2
      // position, the suggestions and the same-choice offer are all the
      // model's own — the same renderer and copy the live panel runs.
      await filesModel.upload([
        new File([new Uint8Array(5000)], "prd.md", { type: "text/markdown" }),
        new File(["module noisedeck\n\ngo 1.24\n"], "go.mod", { type: "text/plain" }),
      ]);
    }
    if (state.viewer !== null) {
      // "code" views a file below the root, the way the operator reaches it:
      // navigate to its directory first, then open it. An entry that cannot
      // be found stops the page — the viewer showing some other file is a
      // different screen wearing the requested state's name.
      if (state.viewer === "code") {
        await filesModel.openDirectory("internal/provider");
      }
      const path = state.viewer === "text"
        ? "README.md"
        : state.viewer === "binary"
          ? "noisefloor-mark.png"
          : state.viewer === "code"
            ? "internal/provider/provider.go"
            : "empty.txt";
      const entry = filesModel.entries().find((candidate) => !candidate.dir && candidate.path === path);
      if (entry === undefined) {
        throw new Error(`viewer ${JSON.stringify(state.viewer)} matches no file at ${JSON.stringify(path)}`);
      }
      await filesModel.activate(entry);
    }
    files.render();
  }

  // A task's detail, reached the way an operator reaches it: the rendered
  // card is clicked, so the same handler that guards the live gesture guards
  // the capture. An id that matches no card must stop the page — rendering
  // the list under the requested state's name is a different screen wearing
  // its label.
  if (state.task !== null) {
    panels.set("tasks");
    const card = document.querySelector<HTMLButtonElement>(
      `[data-tm-task="${CSS.escape(state.task)}"]`,
    );
    if (card === null) {
      throw new Error(`task ${JSON.stringify(state.task)} matches no card in the tasks panel`);
    }
    card.click();
  }

  // Menus.
  if (state.menu === "settings") openMore();
  else if (state.menu === "theme") {
    themeFlyoutOpen = true;
    openMore();
  } else if (state.menu === "project" || state.menu === "session" || state.menu === "projects") {
    // The fixture opens row menus after layout settles, because it depicts
    // the state an operator reaches, not the one that exists mid-render.
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (state.menu === "project") sidebar.openProjectMenu(fixtureProject.id);
    else if (state.menu === "projects") {
      sidebar.openProjectsMenu();
    } else sidebar.openSessionMenu(previewSession.id);
    // The fixture depicts the mouse-opened state, because that is what the comp draws.
    (document.activeElement as HTMLElement | null)?.blur();
  }

  // Dialogs. rename-project is normalized to rename=project at parse time
  // (handoff §8.8: rename is inline, not a dialog).
  if (state.dialog === "new-session") sidebar.openNewSession(fixtureProject.id);
  else if (state.dialog === "open-project") { sidebar.openNewProject(); sidebar.presetNewProjectPath(""); }
  else if (state.dialog === "choose-directory") await sidebar.openDirectoryPicker();
  else if (state.dialog === "git-identity") sidebar.openGitIdentitySettings();
  else if (state.dialog === "choose-git-identity") sidebar.openProjectGitIdentitySetup(fixtureProject.id);
  else if (state.dialog === "add-prd") tm.openAddPrd();
  else if (state.dialog === "custom-theme") openCustomThemeDialog();
  else if (state.dialog === "remove-project") sidebar.openRemoveProjectConfirm("proj-2");
  else if (state.dialog === "close-session") sidebar.openCloseSessionConfirm("sess-3");
  // A pre-chosen path fills the open dialog's field after the dialog it
  // belongs to is up; it is an axis on top of a dialog, not a dialog.
  if (state.projectPath !== null) sidebar.presetNewProjectPath(state.projectPath);

  // Hover: the marker drives the forced-hover CSS in styles/app.css.
  if (state.hover !== null) root.dataset.previewHover = state.hover;

  // Inline rename.
  if (state.rename === "project") sidebar.startRenameProject(fixtureProject.id);
  else if (state.rename === "session") sidebar.startRenameSession(previewSession.id);

  // Phone sessions sheet: on a narrow viewport the sidebar overlays the
  // terminal, so uncollapse it to render the sheet the comp draws (mobile-r5
  // screen 02). This is distinct from the docked panels above.
  if (state.sidebar === "open" && sidebar.isCollapsed) sidebar.toggleCollapsed();
}

// openCustomThemeDialog mounts the custom terminal theme editor
// exactly as the More menu's Custom… entry does, but preview-local: Apply
// paints the fixture terminal and persists nothing.
function openCustomThemeDialog(): void {
  new ThemeDialog(region(root, "modals"), previewCustomSlots, (slots) => {
    previewCustomSlots = slots;
    menuTheme = "custom";
    const chrome = customThemeChromeSlots(slots);
    applyTerminalChromeVars(terminal, chrome);
    terminal.style.backgroundColor = chrome.bg;
    terminalCard.style.backgroundColor = chrome.bg;
  });
}

// markPreviewState verifies the requested state actually rendered and marks
// the page so the capture harness can tell a reached state from a failed
// one. A state that did not render carries data-preview-error, never the
// default view.
function markPreviewState(): void {
  const { name, ready } = describeState(state);
  if (document.querySelector(ready) === null) {
    document.documentElement.dataset.previewError = `${name}: ${ready} not found`;
    return;
  }
  document.documentElement.dataset.previewState = name;
}


// previewScrollbackHtml is the fixture's static CLI scrollback. It ends where
// the live output does: the recovery states (app/recovery.ts) own the final
// stream line, so this stops at the matrix line and leaves the Thinking row
// to whichever recovery presentation is forced. The phone comp draws the
// welcome card as a single column; the desktop comp splits it into two.
function previewScrollbackHtml(frame: "desktop" | "phone" = "desktop", welcome = true): string {
  const phoneWelcome = frame === "phone"
    ? `
      <div class="flex flex-col gap-[2px]">
        <div class="font-semibold text-(--t-fg)">Welcome back Alex!</div>
        <div class="mt-[5px] text-(--t-dim)">Fable 5 · Claude Max</div>
        <div class="text-(--t-dim)">/workspace/field-notes</div>
        <div class="mt-[5px] w-full border-t border-(--t-rule) pt-[5px] text-(--t-dim)">/init · /resume · /release-notes</div>
      </div>`
    : "";
  const desktopWelcome = frame === "desktop"
    ? `
      <div class="flex max-w-[236px] min-w-0 flex-1 flex-col items-center justify-center gap-[2px] text-center">
        <div class="font-semibold text-(--t-fg)">Welcome back</div>
        <div class="font-semibold text-(--t-fg)">Alex!</div>
        <div class="mt-[5px] text-(--t-dim)">Fable 5 · Claude Max</div>
        <div class="text-(--t-dim)">alex@deck.test's Organization</div>
        <div class="text-(--t-dim)">/workspace/field-notes</div>
        <div class="mt-[5px] w-full border-t border-(--t-rule) pt-[5px] text-(--t-dim)">/init · /resume · /release-notes</div>
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-px border-l border-(--t-rule) pl-[16px]">
        <div class="font-semibold text-(--t-accent)">Tips for getting started</div>
        <div class="text-(--t-fg)">Run /init to create a CLAUDE.md file with instructions for Claude</div>
        <div class="truncate text-(--t-fg)">Note: Sessions resume with /resume. Run /doctor if the CLI misbehaves…</div>
        <div class="mt-[7px] border-t border-(--t-rule) pt-[7px] font-semibold text-(--t-accent)">What's new</div>
        <div class="text-(--t-fg)">Bug fixes and reliability improvements</div>
        <div class="truncate text-(--t-fg)">Added Claude Opus 5 (\`claude-opus-5\`), now the default Opus model – 1M context</div>
        <div class="font-normal italic text-(--t-faint)">/release-notes for more</div>
      </div>`
    : "";
  const ellipsis = frame === "phone" ? "· · · scrollback continues · · ·" : "· · · scrollback continues above · · ·";
  // The session banner is the top of the scrollback, so it is only in view
  // while the transcript is short. A session that has been running long enough
  // to lose its connection has scrolled past it, and the reconnecting comp
  // draws the transcript alone.
  const banner = welcome
    ? `<div class="relative flex gap-[16px] rounded-[6px] border border-(--t-accent) pb-[9px] pl-[13px] pr-[13px] pt-[10px] mb-[11px]">
      <span class="absolute left-[11px] top-[-9px] bg-(--t-bg) px-[5px] text-(--t-accent)">Claude Code v2.1.220</span>
      ${phoneWelcome}${desktopWelcome}
    </div>`
    : "";
  return `
    ${banner}
    <div class="text-(--t-faint)">${ellipsis}</div>
    <div class="mt-[10px]"><span class="text-(--t-accent)">●</span><span class="text-(--t-fg)"> Running: go test ./internal/provider</span></div>
    <div class="text-(--t-faint)">  ⎿ ok · 214 tests · 2m 14s</div>
    <div class="mt-[8px]"><span class="text-(--t-accent)">●</span><span class="text-(--t-fg)"> Spike notes → docs/spikes.md</span></div>
    <div class="text-(--t-faint)">  ⎿ 96 lines · feat/task7-phase0</div>
    <div class="mt-[8px]"><span class="text-(--t-accent)">●</span><span class="text-(--t-fg)"> Next I'll wire the kimi descriptor and</span></div>
    <div><span class="text-(--t-fg)">  re-run the matrix. Kicking it off now.</span></div>`;
}

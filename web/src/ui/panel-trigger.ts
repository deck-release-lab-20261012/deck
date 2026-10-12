import { activateMenu } from "./dialog-focus.ts";
import { escapeHtml } from "../lib/escape.ts";
import { SECONDARY_SM_TYPE } from "./controls.ts";
import { lucideIcon } from "./icons.ts";
import * as hints from "../lib/hints.ts";

export type PanelTriggerSurface = "live" | "titlebar";
export type PanelTrigger = "files" | "tasks" | "chats";

// The docked-panel triggers are Blueprint secondary sm buttons (handoff §2):
// a 28px pill on the card surface, --radius-control-sm, a --border-strong
// hairline, 10px side padding, 13px medium text, and a --space-1 icon gap.
// The hint is verb-first (handoff §4) and is read by the info bar
// (handoff §6), not a tooltip.
const PANEL_HINT: Record<PanelTrigger, string> = {
  files: hints.BROWSE_FILES,
  tasks: hints.OPEN_TASK_BOARD,
  chats: hints.WATCH_CHATS,
};

const PANEL_LABEL: Record<PanelTrigger, string> = { files: "Files", tasks: "Project tasks", chats: "Chats" };
const PANEL_TEXT: Record<PanelTrigger, string> = { files: "Files", tasks: "Tasks", chats: "Chats" };
const PANEL_ICON: Record<PanelTrigger, "folder" | "columns-2" | "message-square"> = {
  files: "folder",
  tasks: "columns-2",
  chats: "message-square",
};

// Panel contents own their counts; the navigation trigger has no badge.
export function panelTriggerHtml(
  surface: PanelTriggerSurface,
  trigger: PanelTrigger,
  options: { pressed?: boolean; unseen?: boolean; hint?: string } = {},
): string {
  const hook = `data-${surface}-${trigger}`;
  const label = PANEL_LABEL[trigger];
  const icon = lucideIcon(PANEL_ICON[trigger], 14);
  const text = PANEL_TEXT[trigger];
  const pressed = options.pressed === undefined ? "" : ` aria-pressed="${options.pressed}"`;
  // unseen is the Chats trigger's one extra fact (handoff §23): accent while
  // a live chat holds messages the operator has not seen. No count.
  const unseen = options.unseen === undefined ? "" : ` data-unseen="${options.unseen}"`;
  // A catalogue hint is authored text; a caller-supplied one carries agent
  // data (the handle in "Watch the chats codex-9f2a is in") and is escaped
  // at this boundary.
  const hint = options.hint === undefined ? PANEL_HINT[trigger] : escapeHtml(options.hint);
  return `<button ${hook} aria-label="${label}" data-hint="${hint}"${pressed}${unseen}
    class="group/panel-trigger flex h-7 flex-none items-center justify-center text-text-primary ${SECONDARY_SM_TYPE}">
    <span data-panel-trigger-visual class="relative flex h-7 items-center gap-1 rounded-control-sm border border-border-strong bg-surface-card px-2.5 transition-colors group-hover/panel-trigger:bg-wash-hover">
      ${icon}<span>${text}</span>
    </span>
  </button>`;
}

export function focusPanelTrigger(root: HTMLElement, surface: PanelTriggerSurface, panel: PanelTrigger): void {
  const mobile = root.querySelector<HTMLElement>(`[data-${surface}-panels]`);
  (mobile && mobile.getClientRects().length ? mobile : root.querySelector<HTMLElement>(`[data-${surface}-${panel}]`))?.focus();
}

export function mountPanelsMenu(
  root: HTMLElement,
  surface: PanelTriggerSurface,
  close: () => void,
  select: (panel: PanelTrigger) => void,
): () => void {
  const trigger = root.querySelector<HTMLElement>(`[data-${surface}-panels]`);
  const host = root.querySelector<HTMLElement>('[data-region="popovers"]');
  if (!trigger || !host) return () => {};
  const items = (["files", "tasks", "chats"] as const).filter((panel) => root.querySelector(`[data-${surface}-${panel}]`));
  const rows = items.map((panel) => {
    const current = root.querySelector(`[data-${surface}-${panel}]`)?.getAttribute("aria-pressed") === "true";
    const unseen = panel === "chats" && trigger.dataset.unseen === "true";
    return `<button type="button" role="menuitem" data-panel-choice="${panel}"
      aria-current="${current}" data-unseen="${unseen}"
      class="flex min-h-11 w-full items-center gap-2 rounded-control-sm px-3 text-body-sm text-text-primary hover:bg-wash-hover focus-visible:bg-wash-hover">
      ${lucideIcon(PANEL_ICON[panel], 16)}<span class="flex-1 text-left">${PANEL_TEXT[panel]}</span>
      ${current ? lucideIcon("check", 16) : ""}
    </button>`;
  }).join("");
  host.innerHTML = `<div class="absolute inset-0 pointer-events-auto" data-panels-backdrop>
    <div role="menu" aria-label="Panels" data-panels-menu
      class="absolute min-w-44 rounded-control border border-border bg-surface-overlay p-1 shadow-lg">${rows}</div>
  </div>`;
  const menu = host.querySelector<HTMLElement>('[data-panels-menu]')!;
  const rect = trigger.getBoundingClientRect();
  const bounds = host.getBoundingClientRect();
  menu.style.top = `${rect.bottom - bounds.top + 4}px`;
  menu.style.left = `${Math.max(8, Math.min(rect.right - bounds.left - menu.offsetWidth, bounds.width - menu.offsetWidth - 8))}px`;
  trigger.setAttribute("aria-expanded", "true");
  const dismiss = (restore: boolean): void => {
    close();
    if (restore) focusPanelTrigger(root, surface, "files");
  };
  host.querySelector('[data-panels-backdrop]')?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) dismiss(true);
  });
  for (const item of menu.querySelectorAll<HTMLElement>('[data-panel-choice]')) {
    item.addEventListener("click", () => {
      const panel = item.dataset.panelChoice as PanelTrigger;
      dismiss(true);
      select(panel);
    });
  }
  const releaseFocus = activateMenu(menu, dismiss);
  const onResize = (): void => dismiss(true);
  window.addEventListener("resize", onResize);
  return () => {
    releaseFocus();
    window.removeEventListener("resize", onResize);
    root.querySelector(`[data-${surface}-panels]`)?.setAttribute("aria-expanded", "false");
  };
}

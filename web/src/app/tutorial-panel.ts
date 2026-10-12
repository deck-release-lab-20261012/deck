import { escapeHtml } from "../lib/escape.ts";
import { TutorialModel, type TutorialState, type TutorialLesson } from "./tutorial.ts";

export class TutorialPanel {
  private readonly panel: HTMLElement;
  private readonly mobileBar: HTMLElement;
  private readonly boundary = window.matchMedia("(max-width: 600px)");
  private readonly resize: ResizeObserver;
  private state: TutorialState | null = null;
  private otherPanelOpen = false;
  private lessonsOpen = false;
  private disposed = false;
  private swipeStart: number | null = null;

  constructor(private readonly root: HTMLElement, private readonly model: TutorialModel,
    private readonly callbacks: {
      showStep(): void;
      onClose?(): void;
      sharedPreferences?: boolean;
      renderStep?(lesson: TutorialLesson, step: number): string;
      onAction?(action: string, button: HTMLElement): void;
    }) {
    this.panel = root.querySelector<HTMLElement>('[data-region="tutorial"]')!;
    this.mobileBar = root.querySelector<HTMLElement>('[data-region="tutorial-mobile-bar"]')!;
    root.addEventListener("click", this.onClick);
    this.panel.addEventListener("pointerdown", this.onPointerDown);
    this.panel.addEventListener("pointerup", this.onPointerUp);
    this.panel.addEventListener("pointercancel", this.cancelSwipe);
    this.boundary.addEventListener("change", this.onBoundary);
    this.resize = new ResizeObserver(this.positionSheet);
    const dock = root.querySelector('[data-region="terminal-dock"]');
    if (dock) this.resize.observe(dock);
  }
  private readonly positionSheet = (): void => {
    const dock = this.root.querySelector<HTMLElement>('[data-region="terminal-dock"]');
    this.panel.style.setProperty("--tutorial-dock-bottom", `${dock?.getBoundingClientRect().height ?? 0}px`);
  };
  private readonly onBoundary = (): void => {
    if (this.state) this.update(this.state, this.otherPanelOpen);
  };
  private readonly cancelSwipe = (): void => { this.swipeStart = null; };
  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" || !(event.target instanceof Element) || !event.target.closest("[data-tutorial-handle]")) return;
    this.swipeStart = event.clientY;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  };
  private readonly onPointerUp = (event: PointerEvent): void => {
    const start = this.swipeStart;
    this.swipeStart = null;
    if (start !== null && event.clientY - start > 45) this.model.collapse();
  };
  private readonly onClick = (event: MouseEvent): void => {
    if (this.disposed || !(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLElement>("[data-tutorial-action]");
    if (!button || !this.root.contains(button)) return;
    switch (button.dataset.tutorialAction) {
      case "close": this.model.close(); this.callbacks.onClose?.(); break;
      case "collapse": this.model.collapse(); this.mobileBar.querySelector<HTMLElement>("button")?.focus(); break;
      case "show": this.callbacks.showStep(); break;
      case "next": this.model.next(); if (this.model.state.dismissed) this.callbacks.onClose?.(); break;
      case "back": this.model.back(); break;
      case "lessons": this.lessonsOpen = !this.lessonsOpen; this.onBoundary(); break;
      case "lesson": this.lessonsOpen = false; this.model.selectLesson(button.dataset.lesson ?? ""); break;
      default: this.callbacks.onAction?.(button.dataset.tutorialAction ?? "", button);
    }
  };
  update(state: TutorialState, otherPanelOpen: boolean): void {
    if (this.disposed) return;
    this.state = state;
    this.otherPanelOpen = otherPanelOpen;
    // Framed previews use the same phone layout without resizing the browser.
    const mobile = this.boundary.matches || this.root.querySelector('[data-viewport="narrow"]') !== null;
    this.root.dataset.tutorialMobile = String(mobile);
    // Failed reads open only by explicit request; suspended controllers stay hidden.
    const active = state.phase === "ready"
      && !state.dismissed
      && (!state.loadError || state.visible || state.collapsed);
    // An open Files, Tasks or Chats panel hides the tutorial completely;
    // closing that panel restores it. Collapse affects only phone sheets.
    const full = active && !otherPanelOpen && (!state.collapsed || !mobile);
    const focused = this.panel.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.tutorialAction
      : undefined;
    const focusedBar = document.activeElement instanceof Element
      ? document.activeElement.closest<HTMLElement>('[data-region="tutorial-mobile-bar"]') : null;
    this.panel.dataset.open = String(full);
    this.panel.setAttribute("aria-hidden", String(!full));
    this.panel.inert = !full;
    const lesson = this.model.catalog.find((entry) => entry.id === state.lesson) ?? this.model.catalog[0]!;
    const step = lesson.steps[state.step] ?? lesson.steps[0]!;
    const count = `${state.step + 1} of ${lesson.steps.length}`;
    const button = (action: string, label: string, extra = "") => `<button type="button" data-tutorial-action="${action}" ${extra}>${escapeHtml(label)}</button>`;
    const last = this.model.finishing;
    this.panel.innerHTML = `
      <div data-tutorial-handle aria-hidden="true"><span></span></div>
      <header class="tutorial-header"><h2>Tutorial</h2>${button("lessons", "All lessons", `aria-expanded="${this.lessonsOpen}"`)}${button("collapse", "⌄", 'class="tutorial-collapse" aria-label="Collapse tutorial"')}${button("close", "×", 'aria-label="Close tutorial"')}</header>
      <div class="tutorial-body">
        ${state.unsupportedVersion ? '<p role="status">These preferences were saved by a newer version of Deck. Changes here will not be saved.</p>' : ""}
        ${state.loadError ? '<p role="status">Tutorial preferences could not be loaded. Changes here will not be saved.</p>' : ""}
        ${state.saveError ? '<p role="status">Your latest tutorial changes could not be saved.</p>' : ""}
        ${state.scope === "installation" || this.callbacks.sharedPreferences ? '<p class="tutorial-scope">Tutorial preferences are shared by everyone using this installation.</p>' : ""}
        ${this.lessonsOpen ? `<nav aria-label="Tutorial lessons">${this.lessonNav(lesson)}</nav>` : `
          <div class="tutorial-lesson"><span>${escapeHtml(lesson.title)}</span><span>Step ${count}</span></div>
          <div class="tutorial-progress" aria-hidden="true">${lesson.steps.map((_, index) => `<span data-complete="${index <= state.step}"></span>`).join("")}</div>
          <h3>${escapeHtml(step.title)}</h3><p>${escapeHtml(step.body)}</p>${this.callbacks.renderStep?.(lesson, state.step) ?? ""}`}
      </div>
      ${this.lessonsOpen ? "" : `<footer class="tutorial-footer">${button("back", "Back", this.model.starting ? "disabled" : "")}${button("next", last ? "Finish" : "Next")}</footer>`}`;
    if (full && focused) {
      const restored = this.panel.querySelector<HTMLButtonElement>(
        `[data-tutorial-action="${focused === "lesson" ? "next" : focused}"]`,
      );
      // Back becomes disabled at the first step, so keep keyboard navigation usable.
      const target = restored && !restored.disabled
        ? restored
        : this.panel.querySelector<HTMLButtonElement>('[data-tutorial-action="next"]');
      target?.focus();
    }
    const barHtml = `<span class="tutorial-bar-label">${escapeHtml(lesson.title)} <span>Step ${count}</span></span>${button("show", "Show step")}`;
    this.mobileBar.hidden = !(active && state.collapsed && !otherPanelOpen && mobile);
    this.mobileBar.setAttribute("role", "region");
    this.mobileBar.setAttribute("aria-label", "Tutorial progress");
    this.mobileBar.innerHTML = barHtml;
    if (focusedBar && !focusedBar.hidden) focusedBar.querySelector<HTMLElement>("button")?.focus();
    this.positionSheet();
  }

  // The lesson picker groups the guided course under Get started and the
  // optional chapters under Explore Deck; a catalog without optional
  // lessons keeps the flat list.
  private lessonNav(current: TutorialLesson): string {
    const button = (entry: TutorialLesson) => `<button type="button" data-tutorial-action="lesson" data-lesson="${escapeHtml(entry.id)}" ${entry.id === current.id ? 'aria-current="step"' : ""}>${escapeHtml(entry.title)}</button>`;
    const started = this.model.catalog.filter((entry) => !entry.optional);
    const explore = this.model.catalog.filter((entry) => entry.optional);
    if (explore.length === 0) return started.map(button).join("");
    return [
      started.length > 0 ? `<p class="tutorial-lesson-group">Get started</p>${started.map(button).join("")}` : "",
      `<p class="tutorial-lesson-group">Explore Deck</p>${explore.map(button).join("")}`,
    ].filter(Boolean).join("");
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeEventListener("click", this.onClick);
    this.panel.removeEventListener("pointerdown", this.onPointerDown);
    this.panel.removeEventListener("pointerup", this.onPointerUp);
    this.panel.removeEventListener("pointercancel", this.cancelSwipe);
    this.boundary.removeEventListener("change", this.onBoundary);
    this.resize.disconnect();
  }
}

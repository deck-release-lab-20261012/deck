import { type ApiClient, type TutorialPreference, type TutorialRecord } from "../api/client.ts";

// The default catalog provides neutral welcome and navigation lessons. Live
// and preview surfaces append guided and optional lessons. Steps contain
// presentation copy; the hosting surface owns their explicit actions.

export interface TutorialStep {
  title: string;
  body: string;
}

export interface TutorialLesson {
  // id is the catalog key the preference record persists in its lesson and
  // done fields; the backend bounds it to short lowercase ids, never prose.
  id: string;
  title: string;
  // Optional lessons (the Explore Deck chapters) ship after the guided
  // course but are never entered by Next: the last step of either group
  // finishes the walkthrough, and only an explicit lesson choice opens an
  // optional one.
  optional?: boolean;
  steps: readonly TutorialStep[];
}

export const defaultTutorialCatalog: readonly TutorialLesson[] = [
  {
    id: "welcome",
    title: "Welcome to Deck",
    steps: [
      {
        title: "Your tutorial",
        body: "This panel keeps your place as you move through tutorial lessons. You can close it at any time.",
      },
      {
        title: "Move through a lesson",
        body: "Use Next and Back to move through a lesson. These controls only change your tutorial progress.",
      },
      {
        title: "Close any time",
        body: "Close saves your place. Choose Show tutorial from the global menu to return to it.",
      },
    ],
  },
  {
    id: "navigation",
    title: "Finding your way",
    steps: [
      {
        title: "The sidebar",
        body: "Projects and their sessions sit in the sidebar. Select a session to bring its console forward.",
      },
      {
        title: "Panels hide the tutorial",
        body: "Opening Files, Tasks or Chats hides the tutorial. Close the panel to return to your place.",
      },
      {
        title: "Collapse or close",
        body: "On a small screen, Collapse keeps the tutorial available in a bar. Close dismisses it until you choose Show tutorial again.",
      },
    ],
  },
];

export type TutorialPhase = "loading" | "ready" | "suspended" | "disposed";

export interface TutorialState {
  phase: TutorialPhase;
  // The panel is on screen now: not pending the initial read, not
  // persistently dismissed, and not collapsed for this session.
  visible: boolean;
  dismissed: boolean;
  // Session-only collapse: hides the panel without writing a dismissal, so
  // a reload brings it back.
  collapsed: boolean;
  lesson: string;
  step: number;
  done: readonly string[];
  scope: "operator" | "installation" | null;
  loadError: string | null;
  saveError: string | null;
  // The stored record speaks a version this build does not. Nothing is
  // written and the record is left exactly as read.
  unsupportedVersion: boolean;
}

export interface TutorialHost {
  onChange?: (state: TutorialState) => void;
  // A failed save is reported here even once the panel is closed, so the
  // operator still learns their position was not kept. Fired once per
  // failed write; there is no automatic retry.
  onSaveError?: (message: string) => void;
}

const KNOWN_TUTORIAL_VERSION = 1;

// DOM-free model for the walkthrough panel: it owns presentation state and
// its persistence, nothing else. The server owns the record; every write
// replaces the whole document, and saves are serialized so only the latest
// gesture's state goes out. Races are fenced per concern — a slow initial
// read can neither reopen a panel the operator closed nor re-dismiss one
// they reopened, and it cannot move a position the operator is navigating.
export class TutorialModel {
  private readonly api: ApiClient;
  readonly catalog: readonly TutorialLesson[];
  private readonly host: TutorialHost;

  private phase: TutorialPhase = "loading";
  private started = false;
  // Bumped by every lifecycle edge (load, suspend, resume, dispose); async
  // continuations act only while their generation is still current.
  private generation = 0;
  private dismissed = false;
  private collapsed = false;
  private lessonIndex = 0;
  private step = 0;
  private done: string[] = [];
  private scope: TutorialRecord["scope"] | null = null;
  private loadError: string | null = null;
  private saveError: string | null = null;
  private unsupportedVersion = false;

  // Gesture fences for a slow initial read: once the operator has spoken,
  // the stored answer does not speak over them. close/reopen own dismissal;
  // next/back own position. Suspension clears both — the gestures whose
  // writes it drops no longer outrank the record resume() re-reads.
  private visibilitySpoken = false;
  private positionSpoken = false;

  private loadAbort: AbortController | null = null;
  // One save in flight at most; later gestures only mark state pending, and
  // the document is built from state when the request actually goes out, so
  // intermediate gestures collapse into the latest one.
  private saveInFlight = false;
  private savePending = false;
  private saveAbort: AbortController | null = null;

  constructor(
    api: ApiClient,
    catalog: readonly TutorialLesson[] = defaultTutorialCatalog,
    host: TutorialHost = {},
  ) {
    this.api = api;
    this.catalog = catalog;
    this.host = host;
  }

  get state(): TutorialState {
    return {
      phase: this.phase,
      visible: this.phase === "ready" && (!this.loadError || this.visibilitySpoken) && !this.dismissed && !this.collapsed,
      dismissed: this.dismissed,
      collapsed: this.collapsed,
      lesson: this.catalog[this.lessonIndex]?.id ?? "",
      step: this.step,
      done: [...this.done],
      scope: this.scope,
      loadError: this.loadError,
      saveError: this.saveError,
      unsupportedVersion: this.unsupportedVersion,
    };
  }

  // The initial read. Gestures may land before it returns; adopt() fences
  // them per concern.
  load(): void {
    if (this.started || this.phase === "disposed") return;
    this.started = true;
    void this.read();
  }

  close(): void {
    if (!this.mutable()) return;
    this.dismissed = true;
    this.visibilitySpoken = true;
    this.save();
    this.changed();
  }

  // Reopening resumes exactly where the record says the operator stood.
  reopen(): void {
    if (!this.mutable()) return;
    this.dismissed = false;
    this.collapsed = false;
    this.visibilitySpoken = true;
    this.save();
    this.changed();
  }

  collapse(): void {
    if (!this.mutable()) return;
    this.collapsed = true;
    this.changed();
  }

  expand(): void {
    if (!this.mutable()) return;
    this.collapsed = false;
    this.changed();
  }

  selectLesson(id: string): void {
    if (!this.mutable()) return;
    const index = this.catalog.findIndex((lesson) => lesson.id === id);
    if (index < 0) return;
    this.lessonIndex = index;
    this.step = 0;
    this.positionSpoken = true;
    this.save();
    this.changed();
  }

  next(): void {
    if (!this.mutable()) return;
    const lesson = this.catalog[this.lessonIndex];
    if (lesson === undefined) return;
    this.positionSpoken = true;
    if (this.step < lesson.steps.length - 1) {
      this.step += 1;
    } else {
      // Next never crosses between the guided course and the optional
      // Explore Deck chapters: the last step of either group finishes.
      const follower = this.catalog[this.lessonIndex + 1];
      if (follower !== undefined && (follower.optional ?? false) === (lesson.optional ?? false)) {
        if (!this.done.includes(lesson.id)) this.done.push(lesson.id);
        this.lessonIndex += 1;
        this.step = 0;
      } else {
        // Leaving the group's last step finishes the walkthrough.
        if (!this.done.includes(lesson.id)) this.done.push(lesson.id);
        this.dismissed = true;
        this.visibilitySpoken = true;
      }
    }
    this.save();
    this.changed();
  }

  back(): void {
    if (!this.mutable() || this.starting) return;
    if (this.step > 0) {
      this.positionSpoken = true;
      this.step -= 1;
    } else {
      const previous = this.catalog[this.lessonIndex - 1]!;
      this.positionSpoken = true;
      this.lessonIndex -= 1;
      this.step = Math.max(previous.steps.length - 1, 0);
    }
    this.save();
    this.changed();
  }

  // Back stops at the first step of the guided course or optional chapters.
  get starting(): boolean {
    const lesson = this.catalog[this.lessonIndex];
    if (lesson === undefined) return true;
    if (this.step !== 0) return false;
    const previous = this.catalog[this.lessonIndex - 1];
    return previous === undefined || (previous.optional ?? false) !== (lesson.optional ?? false);
  }

  // True when Next would finish the walkthrough rather than advance — the
  // last step of the guided course or of the optional chapters. The panel
  // labels that button Finish.
  get finishing(): boolean {
    const lesson = this.catalog[this.lessonIndex];
    if (lesson === undefined || this.step !== lesson.steps.length - 1) return false;
    const follower = this.catalog[this.lessonIndex + 1];
    return follower === undefined || (follower.optional ?? false) !== (lesson.optional ?? false);
  }

  // Controller loss: interest in in-flight work ends here. An aborted write
  // may still have been accepted server-side — nothing assumes it was not.
  // Queued work is dropped, and resume() re-reads the record rather than
  // replaying it. The session-only collapse survives; a controller blip
  // within one page must not pop a collapsed panel back open.
  suspend(): void {
    if (this.phase === "disposed" || this.phase === "suspended") return;
    this.generation++;
    this.phase = "suspended";
    this.saveInFlight = false;
    this.savePending = false;
    this.saveAbort?.abort();
    this.saveAbort = null;
    this.loadAbort?.abort();
    this.loadAbort = null;
    this.saveError = null;
    this.visibilitySpoken = false;
    this.positionSpoken = false;
    this.changed();
  }

  // Controller regained: adopt the server's record wholesale. Another
  // client may have written since, and an aborted write may have landed.
  resume(): void {
    if (this.phase !== "suspended") return;
    void this.read();
  }

  dispose(): void {
    if (this.phase === "disposed") return;
    this.generation++;
    this.phase = "disposed";
    this.saveInFlight = false;
    this.savePending = false;
    this.saveAbort?.abort();
    this.saveAbort = null;
    this.loadAbort?.abort();
    this.loadAbort = null;
    this.changed();
  }

  // Gestures are accepted while the initial read is still out — that race
  // is exactly what the fences exist for — but not once suspended or
  // disposed.
  private mutable(): boolean {
    return this.phase === "loading" || this.phase === "ready";
  }

  private changed(): void {
    this.host.onChange?.(this.state);
  }

  private async read(): Promise<void> {
    this.started = true;
    const generation = ++this.generation;
    this.phase = "loading";
    this.loadError = null;
    const abort = new AbortController();
    this.loadAbort = abort;
    this.changed();
    let settled = false;
    try {
      const record = await this.api.getTutorial(abort.signal);
      if (generation === this.generation) {
        settled = true;
        this.adopt(record);
      }
    } catch (err) {
      if (generation === this.generation) {
        settled = true;
        // A failed read cannot establish first use or a safe document to
        // replace. Manual opening remains available without persistence.
        this.loadError = err instanceof Error ? err.message : String(err);
      }
    } finally {
      if (settled) {
        this.phase = "ready";
        this.loadAbort = null;
        if (this.savePending && !this.loadError && !this.unsupportedVersion) this.beginSave();
        this.changed();
      }
    }
  }

  private adopt(record: TutorialRecord | null): void {
    this.unsupportedVersion = false;
    if (record === null) {
      this.scope = null;
      if (!this.visibilitySpoken) this.dismissed = false;
      if (!this.positionSpoken) {
        this.lessonIndex = 0;
        this.step = 0;
        this.done = [];
      }
      return;
    }
    this.scope = record.scope;
    if (record.version !== KNOWN_TUTORIAL_VERSION) {
      // A record from a build this one cannot speak. Read-only: the panel
      // stays closed (an operator with a stored record has met a tutorial)
      // and no write goes out that could clobber it.
      this.unsupportedVersion = true;
      if (!this.visibilitySpoken) this.dismissed = true;
      return;
    }
    if (!this.visibilitySpoken) {
      this.dismissed = record.dismissed === true;
    }
    if (!this.positionSpoken) {
      // Missing lessons (a catalog this build no longer ships) restart at
      // the beginning; a stored step past the lesson's end clamps to its
      // last step. Dismissal is unaffected either way.
      const found = this.catalog.findIndex((lesson) => lesson.id === record.lesson);
      this.lessonIndex = found >= 0 ? found : 0;
      const lesson = this.catalog[this.lessonIndex];
      const last = lesson === undefined ? 0 : Math.max(lesson.steps.length - 1, 0);
      this.step = Number.isInteger(record.step) ? Math.min(Math.max(record.step, 0), last) : 0;
      this.done = Array.isArray(record.done) ? [...record.done] : [];
    }
  }

  private save(): void {
    if (this.phase === "suspended" || this.phase === "disposed" || this.unsupportedVersion || this.loadError) return;
    // A whole-document write must wait until the stored progress and
    // version are known; closing during load must not reset the lesson.
    if (this.phase === "loading") {
      this.savePending = true;
      return;
    }
    if (this.saveInFlight) {
      this.savePending = true;
      return;
    }
    this.beginSave();
  }

  private beginSave(): void {
    const generation = this.generation;
    const abort = new AbortController();
    this.saveAbort = abort;
    this.saveInFlight = true;
    this.savePending = false;
    const document = this.preference();
    void this.api.saveTutorial(document, abort.signal).then(
      () => this.saveSettled(abort, generation, null),
      (err: unknown) => this.saveSettled(abort, generation, err),
    );
  }

  private saveSettled(abort: AbortController, generation: number, err: unknown): void {
    // Another lifecycle edge or a newer save cycle owns the slot: this
    // result is late and decides nothing, including whether the write
    // landed.
    if (this.saveAbort !== abort) return;
    this.saveAbort = null;
    this.saveInFlight = false;
    if (generation !== this.generation) return;
    if (err !== null) {
      // No automatic retry: the failure is reported and only a newer
      // gesture writes again.
      this.saveError = err instanceof Error ? err.message : String(err);
      this.host.onSaveError?.(this.saveError);
    } else {
      this.saveError = null;
    }
    if (this.savePending) {
      this.beginSave();
      return;
    }
    this.changed();
  }

  private preference(): TutorialPreference {
    return {
      version: KNOWN_TUTORIAL_VERSION,
      dismissed: this.dismissed,
      lesson: this.catalog[this.lessonIndex]?.id ?? "",
      step: this.step,
      done: [...new Set(this.done)],
    };
  }
}

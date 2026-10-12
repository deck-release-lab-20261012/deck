import { test } from "node:test";
import assert from "node:assert/strict";
import { TutorialModel, defaultTutorialCatalog, type TutorialLesson } from "./tutorial.ts";
import { ApiError, type ApiClient, type Project, type TutorialPreference, type TutorialRecord } from "../api/client.ts";
import { firstProjectCatalog } from "./tutorial-first-project.ts";
import { exploreTutorialCatalog } from "./tutorial-explore.ts";

// A settings call the test settles by hand: the promise is part of the
// handle so a test can await exactly the continuation it released. Built
// with the executor form because the project's lib is ES2022, which has
// no Promise.withResolvers.
function held<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (cause: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Stands in for the settings endpoints with exactly their contract: a read
// answers null when nothing was written, a write replaces the whole
// document. manualLoad/manualSave hold calls until the test settles them,
// which is how the deferred-answer races are driven.
class FakeTutorialApi {
  stored: TutorialRecord | null = null;
  saved: TutorialPreference[] = [];
  loadSignals: (AbortSignal | undefined)[] = [];
  saveSignals: (AbortSignal | undefined)[] = [];
  loads = 0;
  saves = 0;
  manualLoad = false;
  manualSave = false;
  failLoads: unknown[] = [];
  failSaves: unknown[] = [];
  listProjectsCalls = 0;
  projects: Project[] = [];
  pendingLoad: { promise: Promise<TutorialRecord | null>; resolve: (value: TutorialRecord | null) => void; reject: (cause: unknown) => void } | null = null;
  pendingSaves: Array<{ promise: Promise<TutorialRecord>; resolve: (value: TutorialRecord) => void; reject: (cause: unknown) => void; doc: TutorialPreference }> = [];
  private outstanding: Promise<unknown>[] = [];

  getTutorial(signal?: AbortSignal): Promise<TutorialRecord | null> {
    this.loads += 1;
    this.loadSignals.push(signal);
    if (this.manualLoad) {
      const call = held<TutorialRecord | null>();
      this.pendingLoad = call;
      return call.promise;
    }
    const failure = this.failLoads.shift();
    const promise = failure === undefined
      ? Promise.resolve(this.stored)
      : Promise.reject(failure);
    this.outstanding.push(promise);
    return promise;
  }

  saveTutorial(next: TutorialPreference, signal?: AbortSignal): Promise<TutorialRecord> {
    this.saves += 1;
    this.saved.push(next);
    this.saveSignals.push(signal);
    if (this.manualSave) {
      const call = held<TutorialRecord>();
      this.pendingSaves.push({ ...call, doc: next });
      return call.promise;
    }
    const failure = this.failSaves.shift();
    const record: TutorialRecord = { ...next, done: [...next.done], scope: "operator" };
    const promise = failure === undefined
      ? Promise.resolve(record).then((kept) => {
        this.stored = kept;
        return kept;
      })
      : Promise.reject(failure);
    this.outstanding.push(promise);
    return promise;
  }

  // Drains every answer the model is waiting on — including answers its own
  // continuations go on to request — without inventing clock time.
  async settle(): Promise<void> {
    while (this.outstanding.length > 0) {
      const batch = this.outstanding.splice(0);
      await Promise.allSettled(batch);
    }
  }

  async listProjects(): Promise<Project[]> {
    this.listProjectsCalls += 1;
    return this.projects;
  }
}

const asClient = (fake: FakeTutorialApi): ApiClient => fake as unknown as ApiClient;

const manyProjects: Project[] = [
  { id: "p1", name: "one", canonical_path: "/p1", last_used_at: "t" },
  { id: "p2", name: "two", canonical_path: "/p2", last_used_at: "t" },
  { id: "p3", name: "three", canonical_path: "/p3", last_used_at: "t" },
  { id: "p4", name: "four", canonical_path: "/p4", last_used_at: "t" },
  { id: "p5", name: "five", canonical_path: "/p5", last_used_at: "t" },
];

test("first use opens the walkthrough regardless of how many projects exist", async () => {
  for (const projects of [[], manyProjects]) {
    const fake = new FakeTutorialApi();
    fake.projects = projects;
    const model = new TutorialModel(asClient(fake));
    model.load();
    await fake.settle();
    const state = model.state;
    assert.equal(state.phase, "ready");
    assert.equal(state.visible, true);
    assert.equal(state.dismissed, false);
    assert.equal(state.lesson, "welcome");
    assert.equal(state.step, 0);
    assert.deepEqual(state.done, []);
    assert.equal(state.scope, null);
    assert.equal(fake.loads, 1);
    // The record decides first use, never the workspace around it.
    assert.equal(fake.listProjectsCalls, 0);
  }
});

test("a stored record restores dismissal and position, and reopen resumes it", async () => {
  const fake = new FakeTutorialApi();
  fake.stored = { version: 1, dismissed: true, lesson: "navigation", step: 2, done: ["welcome"], scope: "operator" };
  const changes: TutorialModel["state"][] = [];
  const model = new TutorialModel(asClient(fake), defaultTutorialCatalog, {
    onChange: (state) => changes.push(state),
  });
  model.load();
  await fake.settle();
  let state = model.state;
  assert.equal(state.visible, false);
  assert.equal(state.dismissed, true);
  assert.equal(state.scope, "operator");
  model.reopen();
  await fake.settle();
  state = model.state;
  assert.equal(state.visible, true);
  assert.equal(state.lesson, "navigation");
  assert.equal(state.step, 2);
  assert.deepEqual(state.done, ["welcome"]);
  // The reopen replaced the whole document, position included.
  assert.equal(fake.saves, 1);
  assert.deepEqual(fake.saved[0], { version: 1, dismissed: false, lesson: "navigation", step: 2, done: ["welcome"] });
  // A fresh page reads that document back and resumes open at the same place.
  const reloaded = new TutorialModel(asClient(fake));
  reloaded.load();
  await fake.settle();
  assert.equal(reloaded.state.visible, true);
  assert.equal(reloaded.state.lesson, "navigation");
  assert.equal(reloaded.state.step, 2);
  assert.ok(changes.length >= 3);
  assert.equal(changes.at(-1)?.visible, true);
});

test("an installation-wide record reports its shared scope", async () => {
  const fake = new FakeTutorialApi();
  fake.stored = { version: 1, dismissed: false, lesson: "welcome", step: 0, done: [], scope: "installation" };
  const model = new TutorialModel(asClient(fake));
  model.load();
  await fake.settle();
  assert.equal(model.state.scope, "installation");
  assert.equal(model.state.visible, true);
});

test("a slow initial read cannot undo a close made before it returns", async () => {
  const fake = new FakeTutorialApi();
  fake.manualLoad = true;
  fake.manualSave = true;
  const model = new TutorialModel(asClient(fake));
  model.load();
  model.close();
  assert.equal(model.state.phase, "loading");
  assert.equal(fake.saves, 0);
  const load = fake.pendingLoad;
  assert(load !== null);
  load.resolve({ version: 1, dismissed: false, lesson: "navigation", step: 1, done: ["welcome"], scope: "operator" });
  await load.promise;
  const state = model.state;
  assert.equal(state.phase, "ready");
  // The operator's close stands; the read cannot reopen the panel.
  assert.equal(state.visible, false);
  assert.equal(state.dismissed, true);
  // The close spoke only for dismissal: the stored place is still adopted,
  // so a reopen resumes where the record says the operator stood.
  assert.equal(state.lesson, "navigation");
  assert.equal(state.step, 1);
  assert.deepEqual(state.done, ["welcome"]);
  const save = fake.pendingSaves[0];
  assert(save !== undefined);
  assert.deepEqual(save.doc, { version: 1, dismissed: true, lesson: "navigation", step: 1, done: ["welcome"] });
  save.resolve({ ...save.doc, scope: "operator" });
  await save.promise;
  model.reopen();
  const resumed = model.state;
  assert.equal(resumed.visible, true);
  assert.equal(resumed.lesson, "navigation");
  assert.equal(resumed.step, 1);
});

test("a slow initial read cannot undo a manual reopen", async () => {
  const fake = new FakeTutorialApi();
  fake.manualLoad = true;
  const model = new TutorialModel(asClient(fake));
  model.load();
  model.reopen();
  const load = fake.pendingLoad;
  assert(load !== null);
  load.resolve({ version: 1, dismissed: true, lesson: "welcome", step: 0, done: [], scope: "operator" });
  await load.promise;
  const state = model.state;
  assert.equal(state.phase, "ready");
  assert.equal(state.dismissed, false);
  assert.equal(state.visible, true);
});

test("navigation during a slow read keeps the operator's position", async () => {
  const fake = new FakeTutorialApi();
  fake.manualLoad = true;
  const model = new TutorialModel(asClient(fake));
  model.load();
  model.next();
  const load = fake.pendingLoad;
  assert(load !== null);
  load.resolve({ version: 1, dismissed: false, lesson: "navigation", step: 2, done: ["welcome"], scope: "operator" });
  await load.promise;
  const state = model.state;
  assert.equal(state.phase, "ready");
  assert.equal(state.visible, true);
  assert.equal(state.lesson, "welcome");
  assert.equal(state.step, 1);
  assert.deepEqual(state.done, []);
});

test("saves serialize and coalesce to the latest pending state", async () => {
  const fake = new FakeTutorialApi();
  fake.manualSave = true;
  const model = new TutorialModel(asClient(fake));
  model.load();
  await fake.settle();
  assert.equal(fake.saves, 0);
  model.next();
  assert.equal(fake.saves, 1);
  assert.deepEqual(fake.saved[0], { version: 1, dismissed: false, lesson: "welcome", step: 1, done: [] });
  // Two more gestures while the first write is still out: neither gets its
  // own request; the latest state alone follows the in-flight one.
  model.next();
  model.next();
  assert.equal(fake.saves, 1);
  const first = fake.pendingSaves[0];
  assert(first !== undefined);
  first.resolve({ ...first.doc, scope: "operator" });
  await first.promise;
  assert.equal(fake.saves, 2);
  assert.deepEqual(fake.saved[1], { version: 1, dismissed: false, lesson: "navigation", step: 0, done: ["welcome"] });
  const second = fake.pendingSaves[1];
  assert(second !== undefined);
  second.resolve({ ...second.doc, scope: "operator" });
  await second.promise;
  assert.equal(fake.saves, 2);
  assert.equal(model.state.saveError, null);
});

test("a failed write is reported once and not retried", async () => {
  const fake = new FakeTutorialApi();
  fake.failSaves.push(new ApiError(500, "internal", "could not save tutorial preference"));
  const errors: string[] = [];
  const model = new TutorialModel(asClient(fake), defaultTutorialCatalog, {
    onSaveError: (message) => errors.push(message),
  });
  model.load();
  await fake.settle();
  model.close();
  await fake.settle();
  // The panel is closed, yet the failure is still reported to the host.
  assert.equal(model.state.visible, false);
  assert.equal(model.state.saveError, "could not save tutorial preference");
  assert.deepEqual(errors, ["could not save tutorial preference"]);
  assert.equal(fake.saves, 1);
  // A newer gesture writes again and its success clears the error.
  model.reopen();
  await fake.settle();
  assert.equal(fake.saves, 2);
  assert.equal(model.state.saveError, null);
  assert.deepEqual(errors, ["could not save tutorial preference"]);
});

test("controller loss aborts in-flight work and resume adopts what the server kept", async () => {
  const fake = new FakeTutorialApi();
  fake.manualSave = true;
  const model = new TutorialModel(asClient(fake));
  model.load();
  await fake.settle();
  model.close();
  model.next();
  model.suspend();
  assert.equal(model.state.phase, "suspended");
  assert.equal(model.state.visible, false);
  assert.equal(fake.saveSignals[0]?.aborted, true);
  // Gestures while the controller is lost are ignored.
  model.reopen();
  assert.equal(model.state.phase, "suspended");
  // The server had already accepted the in-flight write when the abort
  // arrived; the abort cannot undo that, and the model does not pretend
  // otherwise — resume re-reads the record instead of replaying the drop.
  const doc = fake.saved[0];
  assert(doc !== undefined);
  fake.stored = { ...doc, done: [...doc.done], scope: "operator" };
  const save = fake.pendingSaves[0];
  assert(save !== undefined);
  save.resolve(fake.stored);
  await save.promise;
  // The queued follow-up was dropped, and nothing retried it.
  assert.equal(fake.saves, 1);
  model.resume();
  await fake.settle();
  const state = model.state;
  assert.equal(fake.loads, 2);
  assert.equal(state.phase, "ready");
  assert.equal(state.dismissed, true);
  assert.equal(state.visible, false);
});

test("dispose ignores late answers and later gestures", async () => {
  const fake = new FakeTutorialApi();
  fake.manualLoad = true;
  fake.manualSave = true;
  const errors: string[] = [];
  const model = new TutorialModel(asClient(fake), defaultTutorialCatalog, {
    onSaveError: (message) => errors.push(message),
  });
  model.load();
  model.next();
  model.dispose();
  assert.equal(model.state.phase, "disposed");
  assert.equal(fake.loadSignals[0]?.aborted, true);
  assert.equal(fake.saves, 0);
  // The withdrawn requests still answer; nothing they say is applied and
  // no failure is reported for work that was deliberately abandoned.
  const load = fake.pendingLoad;
  assert(load !== null);
  load.resolve({ version: 1, dismissed: true, lesson: "navigation", step: 2, done: ["welcome"], scope: "operator" });
  await load.promise;

  const state = model.state;
  assert.equal(state.phase, "disposed");
  assert.equal(state.visible, false);
  assert.equal(state.lesson, "welcome");
  assert.equal(state.scope, null);
  assert.deepEqual(errors, []);
  model.reopen();
  model.next();
  assert.equal(fake.saves, 0);
  assert.equal(model.state.phase, "disposed");
});

test("an unknown stored version is read-only and preserved", async () => {
  const fake = new FakeTutorialApi();
  fake.stored = { version: 2, dismissed: false, lesson: "welcome", step: 0, done: [], scope: "operator" };
  const model = new TutorialModel(asClient(fake));
  model.load();
  await fake.settle();
  const state = model.state;
  assert.equal(state.unsupportedVersion, true);
  assert.equal(state.visible, false);
  assert.equal(state.scope, "operator");
  // Presentation still moves locally, but nothing is ever written over
  // the record the newer build owns.
  model.reopen();
  assert.equal(model.state.visible, true);
  model.next();
  model.close();
  await fake.settle();
  assert.equal(fake.saves, 0);
  assert.deepEqual(fake.stored, { version: 2, dismissed: false, lesson: "welcome", step: 0, done: [], scope: "operator" });
});

test("a record naming lessons the catalog no longer ships falls back without losing dismissal", async () => {
  const fake = new FakeTutorialApi();
  fake.stored = { version: 1, dismissed: true, lesson: "first-project", step: 99, done: ["first-project"], scope: "operator" };
  const singleLesson: readonly TutorialLesson[] = [
    { id: "welcome", title: "Welcome", steps: [{ title: "Only step", body: "Body." }] },
  ];
  const model = new TutorialModel(asClient(fake), singleLesson);
  model.load();
  await fake.settle();
  let state = model.state;
  assert.equal(state.dismissed, true);
  assert.equal(state.visible, false);
  assert.equal(state.lesson, "welcome");
  assert.equal(state.step, 0);
  assert.deepEqual(state.done, ["first-project"]);
  model.reopen();
  await fake.settle();
  state = model.state;
  assert.equal(state.visible, true);
  assert.equal(state.lesson, "welcome");
  assert.equal(state.step, 0);
  assert.deepEqual(fake.saved[0], { version: 1, dismissed: false, lesson: "welcome", step: 0, done: ["first-project"] });

  // The same fallback against the shipped catalog: a stored step past the
  // lesson's end clamps to its last step.
  const fake2 = new FakeTutorialApi();
  fake2.stored = { version: 1, dismissed: true, lesson: "welcome", step: 99, done: [], scope: "operator" };
  const model2 = new TutorialModel(asClient(fake2));
  model2.load();
  await fake2.settle();
  assert.equal(model2.state.dismissed, true);
  assert.equal(model2.state.lesson, "welcome");
  assert.equal(model2.state.step, 2);
});

test("navigation walks lessons, records progress, and finishes at the end", async () => {
  const fake = new FakeTutorialApi();
  const model = new TutorialModel(asClient(fake));
  model.load();
  await fake.settle();
  model.next();
  model.next();
  let state = model.state;
  assert.equal(state.lesson, "welcome");
  assert.equal(state.step, 2);
  assert.deepEqual(state.done, []);
  model.next();
  state = model.state;
  assert.equal(state.lesson, "navigation");
  assert.equal(state.step, 0);
  assert.deepEqual(state.done, ["welcome"]);
  model.back();
  state = model.state;
  assert.equal(state.lesson, "welcome");
  assert.equal(state.step, 2);
  // Going back does not unfinish a lesson.
  assert.deepEqual(state.done, ["welcome"]);
  model.back();
  model.back();
  assert.equal(model.state.step, 0);
  const savesBefore = fake.saves;
  model.back();
  assert.equal(fake.saves, savesBefore);
  // Walking off the catalog's last step finishes the walkthrough.
  for (let i = 0; i < 10; i++) model.next();
  await fake.settle();
  state = model.state;
  assert.equal(state.dismissed, true);
  assert.equal(state.visible, false);
  assert.deepEqual(state.done, ["welcome", "navigation"]);
  assert.deepEqual(fake.saved.at(-1), { version: 1, dismissed: true, lesson: "navigation", step: 2, done: ["welcome", "navigation"] });
  // A fresh page reads that back finished.
  const reloaded = new TutorialModel(asClient(fake));
  reloaded.load();
  await fake.settle();
  assert.equal(reloaded.state.visible, false);
  assert.deepEqual([...reloaded.state.done], ["welcome", "navigation"]);
});

test("collapse hides the panel for the session only and never writes", async () => {
  const fake = new FakeTutorialApi();
  const model = new TutorialModel(asClient(fake));
  model.load();
  await fake.settle();
  const savesBefore = fake.saves;
  model.collapse();
  let state = model.state;
  assert.equal(state.visible, false);
  assert.equal(state.dismissed, false);
  assert.equal(state.collapsed, true);
  assert.equal(fake.saves, savesBefore);
  // Collapse is not persisted: a fresh page shows the panel again.
  const reloaded = new TutorialModel(asClient(fake));
  reloaded.load();
  await fake.settle();
  assert.equal(reloaded.state.visible, true);
  // Within the session, expanding restores it without a write.
  model.expand();
  state = model.state;
  assert.equal(state.visible, true);
  assert.equal(state.collapsed, false);
  assert.equal(fake.saves, savesBefore);
  // A controller-loss round trip in the same page must not pop a
  // collapsed panel back open.
  model.collapse();
  model.suspend();
  model.resume();
  await fake.settle();
  assert.equal(model.state.collapsed, true);
  assert.equal(model.state.visible, false);
});

test("a failed read neither establishes first use nor overwrites unknown progress", async () => {
  const fake = new FakeTutorialApi();
  fake.failLoads.push(new ApiError(500, "internal", "could not read tutorial preference"));
  const model = new TutorialModel(asClient(fake));
  model.load();
  await fake.settle();
  assert.equal(model.state.phase, "ready");
  assert.equal(model.state.visible, false);
  assert.equal(model.state.loadError, "could not read tutorial preference");
  model.reopen();
  assert.equal(model.state.visible, true);
  model.close();
  await fake.settle();
  assert.equal(model.state.visible, false);
  assert.equal(fake.saves, 0);
});

test("a gesture before an unknown-version read never sends a replacement", async () => {
  const fake = new FakeTutorialApi();
  fake.manualLoad = true;
  const model = new TutorialModel(asClient(fake));
  model.load();
  model.close();
  model.reopen();
  assert.equal(fake.saves, 0);
  fake.pendingLoad!.resolve({ version: 2, dismissed: true, lesson: "future", step: 8, done: [], scope: "operator" });
  await fake.settle();
  assert.equal(model.state.unsupportedVersion, true);
  assert.equal(fake.saves, 0);
  assert.equal(model.state.visible, true, "the pending manual reopen still takes effect without a write");
});

test("manual reopening expands a previously collapsed tutorial", async () => {
  const fake = new FakeTutorialApi();
  const model = new TutorialModel(asClient(fake));
  model.load();
  await fake.settle();
  model.collapse();
  model.close();
  model.reopen();
  assert.equal(model.state.collapsed, false);
  assert.equal(model.state.visible, true);
});

test("dispose aborts a write and drops queued gestures without a late error", async () => {
  const fake = new FakeTutorialApi();
  fake.manualSave = true;
  const errors: string[] = [];
  const model = new TutorialModel(asClient(fake), defaultTutorialCatalog, {
    onSaveError: (message) => errors.push(message),
  });
  model.load();
  await fake.settle();
  model.next();
  model.close();
  assert.equal(fake.saves, 1);
  model.dispose();
  assert.equal(fake.saveSignals[0]?.aborted, true);
  fake.pendingSaves[0]!.reject(new Error("late failure"));
  await fake.pendingSaves[0]!.promise.catch(() => {});
  assert.equal(fake.saves, 1);
  assert.deepEqual(errors, []);
});

test("a superseded write cannot clear a new generation's queued save", async () => {
  const fake = new FakeTutorialApi();
  fake.manualSave = true;
  const model = new TutorialModel(asClient(fake));
  model.load();
  await fake.settle();
  model.next();
  const old = fake.pendingSaves[0]!;
  model.suspend();
  model.resume();
  await fake.settle();
  model.selectLesson("navigation");
  model.next();
  old.resolve({ ...old.doc, scope: "operator" });
  await old.promise;
  assert.equal(fake.saves, 2);
  const current = fake.pendingSaves[1]!;
  current.resolve({ ...current.doc, scope: "operator" });
  await current.promise;
  assert.equal(fake.saves, 3);
  assert.equal(fake.saved[2]!.lesson, "navigation");
  assert.equal(fake.saved[2]!.step, 1);
});

// The composed catalog live and preview both mount: the guided course
// (default lessons plus the first-project curriculum) followed by the
// optional Explore Deck chapters.
const liveCatalog: readonly TutorialLesson[] = [
  ...defaultTutorialCatalog,
  ...firstProjectCatalog,
  ...exploreTutorialCatalog,
];

const stepsOf = (lessons: readonly TutorialLesson[]): number =>
  lessons.reduce((total, lesson) => total + lesson.steps.length, 0);

test("explore chapter ids are unique and disjoint from the guided course", () => {
  const ids = liveCatalog.map((lesson) => lesson.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(exploreTutorialCatalog.every((lesson) => lesson.optional === true));
  assert.ok(liveCatalog.slice(0, defaultTutorialCatalog.length + firstProjectCatalog.length)
    .every((lesson) => lesson.optional !== true));
});

test("Finish at the last guided step dismisses without entering optional chapters", async () => {
  const fake = new FakeTutorialApi();
  const model = new TutorialModel(asClient(fake), liveCatalog);
  model.load();
  await fake.settle();
  const guidedSteps = stepsOf(liveCatalog) - stepsOf(exploreTutorialCatalog);
  for (let taken = 1; taken < guidedSteps; taken++) {
    // Only the final guided step may offer Finish on the way there.
    if (taken < guidedSteps - 1) assert.equal(model.finishing, false);
    model.next();
  }
  await fake.settle();
  assert.equal(model.state.lesson, "first-project-finish");
  assert.equal(model.finishing, true);
  assert.equal(model.state.dismissed, false);
  model.next();
  await fake.settle();
  assert.equal(model.state.dismissed, true);
  assert.equal(model.state.visible, false);
  // The dismissal happened on the guided course's last step, not past it.
  assert.equal(model.state.lesson, "first-project-finish");
  assert.ok(fake.saved.every((doc) => !doc.lesson.startsWith("explore-")));
  assert.deepEqual(fake.saved.at(-1)?.done.slice(-1), ["first-project-finish"]);
});

test("an explicit choice opens, walks and persists an optional chapter", async () => {
  const fake = new FakeTutorialApi();
  const model = new TutorialModel(asClient(fake), liveCatalog);
  model.load();
  await fake.settle();
  model.selectLesson("explore-recovery");
  await fake.settle();
  let state = model.state;
  assert.equal(state.visible, true);
  assert.equal(state.dismissed, false);
  assert.equal(state.lesson, "explore-recovery");
  assert.equal(state.step, 0);
  assert.equal(fake.saved.at(-1)?.lesson, "explore-recovery");
  // A fresh page resumes the optional chapter from the saved record.
  const reloaded = new TutorialModel(asClient(fake), liveCatalog);
  reloaded.load();
  await fake.settle();
  assert.equal(reloaded.state.visible, true);
  assert.equal(reloaded.state.lesson, "explore-recovery");
  // Within the chosen chapters, Next walks steps and neighbors, and the
  // last optional step is the only other place the walkthrough finishes.
  while (!reloaded.finishing) reloaded.next();
  await fake.settle();
  state = reloaded.state;
  assert.equal(state.lesson, "explore-workflow");
  assert.equal(state.step, exploreTutorialCatalog.at(-1)!.steps.length - 1);
  reloaded.next();
  await fake.settle();
  assert.equal(reloaded.state.dismissed, true);
  assert.equal(reloaded.state.lesson, "explore-workflow");
});

test("the default catalog still finishes only at its own last step", async () => {
  const fake = new FakeTutorialApi();
  const model = new TutorialModel(asClient(fake));
  model.load();
  await fake.settle();
  let seen = 0;
  while (!model.finishing) {
    model.next();
    seen += 1;
  }
  await fake.settle();
  assert.equal(seen, stepsOf(defaultTutorialCatalog) - 1);
  assert.equal(model.state.lesson, "navigation");
  model.next();
  await fake.settle();
  assert.equal(model.state.dismissed, true);
  assert.deepEqual([...model.state.done], ["welcome", "navigation"]);
});

test("Back stops at the optional course boundary without another preference write", async () => {
  const fake = new FakeTutorialApi();
  const model = new TutorialModel(asClient(fake), liveCatalog);
  model.load();
  await fake.settle();
  model.selectLesson("explore-projects");
  await fake.settle();
  const writes = fake.saved.length;
  assert.equal(model.starting, true);
  model.back();
  await fake.settle();
  assert.equal(model.state.lesson, "explore-projects");
  assert.equal(model.state.step, 0);
  assert.equal(fake.saved.length, writes);
  model.next();
  assert.equal(model.starting, false);
  model.back();
  assert.equal(model.starting, true);
  model.selectLesson("explore-terminal");
  model.back();
  assert.equal(model.state.lesson, "explore-projects");
  assert.equal(model.state.step, exploreTutorialCatalog[0]!.steps.length - 1);
});

import assert from "node:assert/strict";
import test from "node:test";
import type { ApiClient, FileApiClient, FileListing, Project, SessionSummary, TmTask } from "../api/client.ts";
import { ApiError } from "../api/client.ts";
import { firstProjectSampleFiles, firstProjectTask, firstProjectTaskFiles } from "./tutorial-first-project.ts";
import { TutorialProjectModel, tutorialManifestPath } from "./tutorial-project.ts";

// The fakes record every call in order so the tests assert what the
// workflow did and did not do — ordering, refusal, and the absence of
// follow-up writes — against observable API traffic, not model internals.

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

interface Call {
  method: string;
  args: unknown[];
}

const PRD_CONTENT = firstProjectSampleFiles.find((f) => f.path === firstProjectTaskFiles.prd)!.content;
const READ_METHODS = new Set([
  "listProjects",
  "listProviders",
  "listGitIdentities",
  "listProjectDirectories",
  "listProjectFiles",
  "viewProjectFile",
  "getTaskmasterTask",
]);

function project(id: string, path: string): Project {
  return { id, name: path.split("/").pop() ?? id, canonical_path: path, last_used_at: "2026-09-23T00:00:00Z" };
}

function session(projectId: string, provider: string): SessionSummary {
  return {
    id: `s-${projectId}-${provider}`,
    project_id: projectId,
    provider,
    display_name: "",
    status: "running",
    generation: 1,
    created_at: "2026-09-23T00:00:00Z",
    updated_at: "2026-09-23T00:00:00Z",
    recovery_capability: "none",
    recovery_state: "unavailable",
    presentation_state: "running",
  };
}

interface FakeState {
  calls: Call[];
  providers: string[];
  registered: Map<string, Project>;
  directories: Set<string>;
  files: Map<string, Map<string, string>>;
  tasks: Map<string, TmTask>;
  prds: Map<string, string>;
  taskmaster: Set<string>;
  sessions: Map<string, SessionSummary>;
  previewEnabled: string[];
  failOn: { method: string; arg?: unknown } | null;
  gates: Map<string, Promise<void>>;
  rootExtra: string | null;
  loseDirectoryResponse: boolean;
  loseRegistrationResponse: boolean;
}

function fakeState(): FakeState {
  return {
    calls: [],
    providers: ["claude", "opencode"],
    registered: new Map(),
    directories: new Set(),
    files: new Map(),
    tasks: new Map(),
    prds: new Map(),
    taskmaster: new Set(),
    sessions: new Map(),
    previewEnabled: [],
    failOn: null,
    gates: new Map(),
    rootExtra: null,
    loseDirectoryResponse: false,
    loseRegistrationResponse: false,
  };
}

function makeClients(state: FakeState): { api: ApiClient; files: FileApiClient } {
  const record = (method: string, args: unknown[]): void => {
    state.calls.push({ method, args });
    const fail = state.failOn;
    if (fail && fail.method === method && (fail.arg === undefined || fail.arg === args[1] || fail.arg === args[0])) {
      state.failOn = null;
      throw new ApiError(500, "boom", `${method} exploded`);
    }
  };
  const gate = (method: string): Promise<void> | null => state.gates.get(method) ?? null;
  const dirFor = (projectID: string): Map<string, string> => {
    const p = state.registered.get(projectID);
    if (!p) throw new ApiError(404, "not_found", "no such project");
    return state.files.get(p.canonical_path)!;
  };

  const api = {
    listProjects() {
      record("listProjects", []);
      return [...state.registered.values()];
    },
    listProviders() {
      record("listProviders", []);
      return state.providers;
    },
    listGitIdentities() {
      record("listGitIdentities", []);
      return {
        profiles: [{ id: "id-1", name: "Op", email: "op@example.com", revision: 1, created_at: "", updated_at: "" }],
        default_profile_id: "id-1",
        revision: 1,
      };
    },
    listProjectDirectories() {
      record("listProjectDirectories", []);
      return { current_path: "/srv/projects", parent_path: null, directories: [] };
    },
    async createProjectDirectory(path: string, name: string) {
      record("createProjectDirectory", [path, name]);
      await gate("createProjectDirectory");
      const full = `${path}/${name}`;
      if (state.directories.has(full)) throw new ApiError(409, "exists", "directory already exists");
      state.directories.add(full);
      state.files.set(full, new Map());
      if (state.loseDirectoryResponse) throw new Error("directory response lost");
      return { path: full };
    },
    async createProject(name: string, path: string, _profile: unknown) {
      record("createProject", [name, path]);
      await gate("createProject");
      const p = project(`p-${state.registered.size + 1}`, path);
      state.registered.set(p.id, p);
      dirFor(p.id).set(".git", "");
      if (state.rootExtra) dirFor(p.id).set(state.rootExtra, "stray");
      if (state.loseRegistrationResponse) throw new Error("registration response lost");
      return { ...p, git_author_name: "Op" };
    },
    async deleteProject(projectID: string) {
      record("deleteProject", [projectID]);
      for (const s of [...state.sessions.values()]) if (s.project_id === projectID) state.sessions.delete(s.id);
      state.registered.delete(projectID);
    },
    async createSession(projectID: string, provider: string) {
      record("createSession", [projectID, provider]);
      if (!state.providers.includes(provider)) throw new ApiError(400, "bad_provider", `unknown provider ${provider}`);
      const s = session(projectID, provider);
      state.sessions.set(s.id, s);
      return s;
    },
    async initializeTaskmaster(projectID: string) {
      record("initializeTaskmaster", [projectID]);
      state.taskmaster.add(projectID);
      return { path: "/store", tag: "master", already_initialized: false };
    },
    getTaskmasterTask(projectID: string, taskID: string) {
      record("getTaskmasterTask", [projectID, taskID]);
      const t = state.tasks.get(taskID);
      if (!t) throw new ApiError(404, "not_found", "no such task");
      return t;
    },
    addTaskmasterTask(projectID: string, input: { title: string; description: string; details: string; priority: "high" | "medium" | "low" }) {
      record("addTaskmasterTask", [projectID, input]);
      const id = String(state.tasks.size + 1);
      state.tasks.set(id, { id, title: input.title, description: input.description, status: "pending" });
      return { id };
    },
    async uploadPrd(projectID: string, name: string, content: string) {
      record("uploadPrd", [projectID, name, content]);
      state.prds.set(`${projectID}/${name}`, content);
    },
    async enableProjectPreview(projectID: string) {
      record("enableProjectPreview", [projectID]);
      state.previewEnabled.push(projectID);
      return { enabled: true, url: "https://preview.example", managed: false };
    },
  } as unknown as ApiClient;

  const files = {
    listProjectFiles(projectID: string, path: string): FileListing {
      state.calls.push({ method: "listProjectFiles", args: [projectID, path] });
      const names = [...dirFor(projectID).keys()];
      return {
        path,
        at_root: path === "",
        entries: names.map((name) => ({ name, path: name, dir: false, mode: "-rw-r--r--", mtime: "2026-09-23T00:00:00Z" })),
      };
    },
    viewProjectFile(projectID: string, path: string) {
      state.calls.push({ method: "viewProjectFile", args: [projectID, path] });
      const content = dirFor(projectID).get(path);
      if (content === undefined) throw new ApiError(404, "not_found", "no such file");
      return { content };
    },
    async uploadProjectFile(projectID: string, destPath: string, body: Blob) {
      state.calls.push({ method: "uploadProjectFile", args: [projectID, destPath] });
      const fail = state.failOn;
      if (fail && fail.method === "uploadProjectFile" && fail.arg === destPath) {
        state.failOn = null;
        throw new ApiError(500, "boom", "upload exploded");
      }
      dirFor(projectID).set(destPath, await body.text());
      return { path: destPath, size: 0 };
    },
  } as unknown as FileApiClient;

  return { api, files };
}

function makeModel(state = fakeState()) {
  const { api, files } = makeClients(state);
  return { state, model: new TutorialProjectModel(api, files) };
}

// Registers a fully seeded tutorial project the way a successful create
// leaves it, and returns the pieces tests need.
function seeded(state: FakeState, id = "p-seed", path = "/srv/projects/my-readings") {
  state.registered.set(id, project(id, path));
  state.files.set(path, new Map(firstProjectSampleFiles.map((f) => [f.path, f.content])));
  state.tasks.set("1", { id: "1", title: firstProjectTask.title, description: firstProjectTask.description, status: "pending" });
  const manifest = { version: 1, sample: "reading-list", projectId: id, canonicalPath: path, taskId: "1" };
  state.files.get(path)!.set(tutorialManifestPath, JSON.stringify(manifest));
  return { id, path, manifest };
}

function writeMethodNames(state: FakeState): string[] {
  return state.calls.filter((c) => !READ_METHODS.has(c.method)).map((c) => c.method);
}

test("loadChoices fills providers, identities, and the default parent", async () => {
  const { model } = makeModel();
  await model.loadChoices();
  assert.deepEqual(model.state.providers, ["claude", "opencode"]);
  assert.equal(model.state.defaultParent, "/srv/projects");
  assert.equal(model.state.defaultIdentityId, "id-1");
  assert.equal(model.state.busy, false);
  assert.equal(model.state.error, null);
});

test("an already-registered directory is refused with no directory creation, registration, or uploads", async () => {
  const { state, model } = makeModel();
  await model.loadChoices();
  state.registered.set("p-old", project("p-old", "/srv/projects/my-readings"));
  await model.create("/srv/projects", "my-readings", "id-1");
  assert.ok(model.state.error?.includes("already registered"));
  assert.deepEqual(writeMethodNames(state), []);
  assert.equal(state.directories.size, 0);
});

test("an existing unregistered directory refuses registration and uploads", async () => {
  const { state, model } = makeModel();
  await model.loadChoices();
  state.directories.add("/srv/projects/my-readings");
  state.files.set("/srv/projects/my-readings", new Map());
  await model.create("/srv/projects", "my-readings", "id-1");
  assert.ok(model.state.error?.includes("stopped"));
  assert.deepEqual(writeMethodNames(state), ["createProjectDirectory"]);
  assert.equal(state.registered.size, 0);
});

test("create without a valid selected Git identity never writes", async () => {
  const { state, model } = makeModel();
  await model.loadChoices();
  const before = state.calls.length;
  await model.create("/srv/projects", "x", null);
  await model.create("/srv/projects", "x", "missing-id");
  assert.equal(state.calls.length, before);
  assert.ok(model.state.error?.includes("Git identity"));
});

test("a nonempty fresh directory refuses all writes but stays registered for honest removal", async () => {
  const state = fakeState();
  state.rootExtra = "README.md";
  const { model } = makeModel(state);
  await model.loadChoices();
  await model.create("/srv/projects", "my-readings", "id-1");
  assert.match(model.state.error ?? "", /not empty/);
  assert.deepEqual(writeMethodNames(state), ["createProjectDirectory", "createProject"]);
  assert.equal(model.state.partialProject?.canonical_path, "/srv/projects/my-readings");
  assert.equal(state.files.get("/srv/projects/my-readings")?.get("README.md"), "stray");
  await model.remove();
  assert.equal(state.registered.size, 0);
  assert.equal(state.files.get("/srv/projects/my-readings")?.get("README.md"), "stray");
});

test("one failing request stops every follow-up write and never writes the manifest", async () => {
  const { state, model } = makeModel();
  await model.loadChoices();
  state.failOn = { method: "initializeTaskmaster" };
  await model.create("/srv/projects", "my-readings", "id-1");
  const writes = writeMethodNames(state);
  assert.equal(writes.filter((m) => m === "uploadProjectFile").length, firstProjectSampleFiles.length - 1);
  assert.deepEqual(writes.slice(writes.indexOf("initializeTaskmaster")), ["initializeTaskmaster"]);
  assert.equal(state.files.get("/srv/projects/my-readings")!.has(tutorialManifestPath), false);
  assert.ok(model.state.error);
});

test("successful create seeds in canonical order with the manifest last, bound to real ids", async () => {
  const { state, model } = makeModel();
  await model.loadChoices();
  await model.create("/srv/projects", "my-readings", "id-1");
  assert.equal(model.state.error, null);
  assert.ok(model.state.notice?.includes("Created"));
  const names = writeMethodNames(state);
  assert.equal(names.filter((m) => m === "uploadProjectFile").length, firstProjectSampleFiles.length);
  assert.equal(names.lastIndexOf("uploadProjectFile"), names.length - 1);
  assert.ok(names.indexOf("initializeTaskmaster") < names.indexOf("uploadPrd"));
  assert.ok(names.indexOf("uploadPrd") < names.indexOf("addTaskmasterTask"));
  assert.ok(names.indexOf("addTaskmasterTask") < names.lastIndexOf("uploadProjectFile"));
  const manifestUpload = state.calls.filter((c) => c.method === "uploadProjectFile").at(-1)!;
  assert.equal(manifestUpload.args[1], tutorialManifestPath);
  const dir = state.files.get("/srv/projects/my-readings")!;
  assert.match(dir.get("LICENSE")!, /Copyright \(c\) 2026 Doug Doan/);
  const manifest = JSON.parse(dir.get(tutorialManifestPath)!) as Record<string, unknown>;
  const registered = [...state.registered.values()][0]!;
  assert.equal(manifest.projectId, registered.id);
  assert.equal(manifest.canonicalPath, "/srv/projects/my-readings");
  assert.equal(manifest.taskId, "1");
  assert.equal(manifest.sample, "reading-list");
  assert.equal(manifest.version, 1);
  assert.equal(model.state.verified?.project.id, registered.id);
  assert.equal(String(model.state.verified?.task.id), "1");
  assert.equal(state.prds.get(`${registered.id}/reading-list.md`), PRD_CONTENT);
});

test("suspending while the directory creation is in flight causes zero registration", async () => {
  const state = fakeState();
  const { api, files } = makeClients(state);
  const published: { busy: boolean; notice: string | null }[] = [];
  const model = new TutorialProjectModel(api, files, () => {
    published.push({ busy: model.state.busy, notice: model.state.notice });
  });
  await model.loadChoices();
  const { promise, resolve } = deferred();
  state.gates.set("createProjectDirectory", promise);
  const pending = model.create("/srv/projects", "my-readings", "id-1");
  await new Promise(setImmediate);
  model.suspend();
  assert.equal(published.at(-1)?.busy, false);
  assert.match(published.at(-1)?.notice ?? "", /interrupted/);
  resolve();
  await pending;
  assert.equal(state.registered.size, 0);
  assert.deepEqual(writeMethodNames(state), ["createProjectDirectory"]);
  assert.equal(model.state.busy, false);
  model.resumeLifecycle();
});

test("disposing after a deferred registration causes zero uploads", async () => {
  const { state, model } = makeModel();
  await model.loadChoices();
  const { promise, resolve } = deferred();
  state.gates.set("createProject", promise);
  const pending = model.create("/srv/projects", "my-readings", "id-1");
  await new Promise(setImmediate);
  model.dispose();
  resolve();
  await pending;
  assert.equal(state.registered.size, 1);
  assert.deepEqual(writeMethodNames(state), ["createProjectDirectory", "createProject"]);
});

test("spoofed, wrong-version, copied, and extra-key manifests are refused without mutation", async () => {
  const cases: { label: string; body: string | null }[] = [
    { label: "missing manifest", body: null },
    { label: "wrong version", body: JSON.stringify({ version: 2, sample: "reading-list", projectId: "p-seed", canonicalPath: "/srv/projects/my-readings", taskId: "1" }) },
    { label: "wrong sample", body: JSON.stringify({ version: 1, sample: "other", projectId: "p-seed", canonicalPath: "/srv/projects/my-readings", taskId: "1" }) },
    { label: "copied from another project", body: JSON.stringify({ version: 1, sample: "reading-list", projectId: "p-elsewhere", canonicalPath: "/srv/elsewhere", taskId: "1" }) },
    { label: "extra key", body: JSON.stringify({ version: 1, sample: "reading-list", projectId: "p-seed", canonicalPath: "/srv/projects/my-readings", taskId: "1", lessons: [] }) },
    { label: "non-string task id", body: JSON.stringify({ version: 1, sample: "reading-list", projectId: "p-seed", canonicalPath: "/srv/projects/my-readings", taskId: 7 }) },
  ];
  for (const testCase of cases) {
    const { state, model } = makeModel();
    const seed = seeded(state);
    if (testCase.body === null) state.files.get(seed.path)!.delete(tutorialManifestPath);
    else state.files.get(seed.path)!.set(tutorialManifestPath, testCase.body);
    await model.resume(seed.id);
    assert.ok(model.state.error, testCase.label);
    assert.equal(model.state.verified, null, testCase.label);
    assert.deepEqual(writeMethodNames(state), [], testCase.label);
  }
});

test("a task with the wrong title, or tampered starter files, refuse the resume", async () => {
  const titleState = fakeState();
  const seedA = seeded(titleState);
  titleState.tasks.set("1", { id: "1", title: "Something else entirely", status: "pending" });
  const titleClients = makeClients(titleState);
  const titleModel = new TutorialProjectModel(titleClients.api, titleClients.files);
  await titleModel.resume(seedA.id);
  assert.ok(titleModel.state.error?.includes("title"));
  assert.equal(titleModel.state.verified, null);

  for (const path of [firstProjectTaskFiles.tests, firstProjectTaskFiles.prd]) {
    const { state, model } = makeModel();
    const seed = seeded(state);
    state.files.get(seed.path)!.set(path, "tampered");
    await model.resume(seed.id);
    assert.ok(model.state.error?.includes(path), path);
    assert.equal(model.state.verified, null);
  }
});

test("a successful resume verifies project and task with no writes", async () => {
  const { state, model } = makeModel();
  const seed = seeded(state);
  await model.resume(seed.id);
  assert.equal(model.state.error, null);
  assert.equal(model.state.verified?.project.id, seed.id);
  assert.equal(model.state.verified?.task.title, firstProjectTask.title);
  assert.deepEqual(writeMethodNames(state), []);
  await model.refreshTask();
  assert.equal(model.state.verified?.task.id, "1");
  assert.deepEqual(writeMethodNames(state), []);
});

test("resume preserves the previous starter license without writing files", async () => {
  const { state, model } = makeModel();
  const seed = seeded(state);
  const files = state.files.get(seed.path)!;
  const previousLicense = files.get("LICENSE")!.replace("Copyright (c) 2026 Doug Doan", "Copyright (c) 2026 Deck contributors");
  files.set("LICENSE", previousLicense);
  const originalFiles = new Map(files);

  await model.resume(seed.id);

  assert.equal(model.state.error, null);
  assert.equal(model.state.verified?.project.id, seed.id);
  assert.equal(model.state.verified?.task.id, "1");
  assert.deepEqual(files, originalFiles);
  assert.deepEqual(writeMethodNames(state), []);
});

test("connect refuses a provider absent from the runtime inventory without starting a session", async () => {
  const { state, model } = makeModel();
  const seed = seeded(state);
  await model.resume(seed.id);
  assert.equal(await model.connect("cursorware"), null);
  assert.ok(model.state.error?.includes("not available"));
  assert.equal(state.sessions.size, 0);
});

test("connect reverifies registration and manifest, then starts the session", async () => {
  const { state, model } = makeModel();
  const seed = seeded(state);
  await model.resume(seed.id);
  const result = await model.connect("claude");
  assert.equal(result?.project_id, seed.id);
  assert.equal(model.state.createdSession?.project_id, seed.id);
  assert.equal(model.state.error, null);

  const tampered = makeModel();
  const seedB = seeded(tampered.state);
  await tampered.model.resume(seedB.id);
  tampered.state.files.get(seedB.path)!.set(tutorialManifestPath, JSON.stringify({ ...seedB.manifest, taskId: "task-9" }));
  assert.equal(await tampered.model.connect("claude"), null);
  assert.equal(tampered.state.sessions.size, 0);
});

test("enablePreview reverifies and enables for the bound project only", async () => {
  const { state, model } = makeModel();
  const seed = seeded(state);
  await model.resume(seed.id);
  await model.enablePreview();
  assert.deepEqual(state.previewEnabled, [seed.id]);
  assert.equal(model.state.error, null);
});

test("remove unregisters exactly the bound project, notices that files remain, and only fires once", async () => {
  const { state, model } = makeModel();
  const seed = seeded(state);
  const active = session(seed.id, "claude");
  state.sessions.set(active.id, active);
  await model.resume(seed.id);
  await model.remove();
  assert.deepEqual(writeMethodNames(state), ["deleteProject"]);
  assert.ok(model.state.notice?.includes("files remain"));
  assert.ok(model.state.notice?.includes("unregistered"));
  assert.equal(state.registered.size, 0);
  assert.equal(state.sessions.size, 0);
  assert.equal(model.state.verified, null);
  await model.remove();
  assert.ok(model.state.error);
  assert.equal(writeMethodNames(state).length, 1);
});

test("remove refuses when the recorded id is re-registered under a different path", async () => {
  const { state, model } = makeModel();
  const seed = seeded(state);
  await model.resume(seed.id);
  state.registered.set(seed.id, project(seed.id, "/somewhere/else"));
  await model.remove();
  assert.ok(model.state.error?.includes("recorded path"));
  assert.equal(state.registered.size, 1);
});

test("a partially seeded create can still be removed by its recorded id and path", async () => {
  const { state, model } = makeModel();
  await model.loadChoices();
  state.failOn = { method: "initializeTaskmaster" };
  await model.create("/srv/projects", "my-readings", "id-1");
  assert.equal(state.registered.size, 1);
  const registered = [...state.registered.values()][0]!;
  assert.match(model.state.error!, /remove the registration from this panel/);
  const beforeFreshChoice = state.calls.length;
  assert.equal(model.chooseAnotherFolder(), false, "registered partial cleanup target cannot be forgotten");
  assert.equal(state.calls.length, beforeFreshChoice);
  assert.equal(model.state.partialProject?.id, registered.id);
  await model.remove();
  assert.deepEqual(writeMethodNames(state).slice(-1), ["deleteProject"]);
  assert.equal(state.registered.size, 0);
  assert.ok(state.files.has(registered.canonical_path));
});

test("a failed resume leaves nothing removable and starts no session", async () => {
  const { state, model } = makeModel();
  seeded(state);
  await model.resume("p-unknown");
  assert.ok(model.state.error);
  assert.equal(model.state.verified, null);
  await model.remove();
  assert.ok(model.state.error?.includes("no tutorial project bound"));
  assert.deepEqual(writeMethodNames(state), []);
});

test("suspended and disposed gestures issue no calls and do not throw", async () => {
  const { state, model } = makeModel();
  await model.loadChoices();
  model.suspend();
  const before = state.calls.length;
  await model.create("/srv/projects", "new", "id-1");
  await model.resume("anything");
  await model.loadChoices();
  await model.refreshTask();
  await model.enablePreview();
  await model.remove();
  assert.equal(await model.connect("claude"), null);
  assert.equal(state.calls.length, before);
  model.dispose();
  model.resumeLifecycle();
  await model.create("/srv/projects", "new", "id-1");
  assert.equal(state.calls.length, before);
});

test("a late rejected request cannot overwrite a resumed lifecycle", async () => {
  const { state, model } = makeModel();
  await model.loadChoices();
  const gate = deferred();
  state.gates.set("createProjectDirectory", gate.promise);
  const pending = model.create("/srv/projects", "new", "id-1");
  await new Promise(setImmediate);
  model.suspend();
  model.resumeLifecycle();
  const notice = model.state.notice;
  gate.reject(new Error("late failure"));
  await pending;
  assert.equal(model.state.error, null);
  assert.equal(model.state.notice, notice);
  assert.equal(state.registered.size, 0);
});

test("a failed explicit resume clears the previous target", async () => {
  const { state, model } = makeModel();
  const seed = seeded(state);
  await model.resume(seed.id);
  assert.ok(model.state.verified);
  await model.resume("not-the-tutorial");
  assert.equal(model.state.verified, null);
  await model.connect("claude");
  await model.remove();
  assert.deepEqual(writeMethodNames(state), []);
});

test("a changed completion manifest refuses removal", async () => {
  const { state, model } = makeModel();
  const seed = seeded(state);
  await model.resume(seed.id);
  state.files.get(seed.path)!.set(tutorialManifestPath, JSON.stringify({ ...seed.manifest, projectId: "different" }));
  await model.remove();
  assert.match(model.state.error ?? "", /manifest/);
  assert.deepEqual(writeMethodNames(state), []);
  assert.ok(state.registered.has(seed.id));
});

test("a second create cannot discard the partial cleanup target", async () => {
  const { state, model } = makeModel();
  await model.loadChoices();
  state.failOn = { method: "initializeTaskmaster" };
  await model.create("/srv/projects", "first", "id-1");
  const partial = model.state.partialProject;
  assert.ok(partial);
  const count = state.calls.length;
  await model.create("/srv/projects", "second", "id-1");
  assert.equal(state.calls.length, count);
  assert.equal(model.state.partialProject, partial);
  await model.remove();
  assert.equal(state.registered.size, 0);
});

test("the directory index supplies an allowed root when no directory is selected", async () => {
  const state = fakeState();
  const { api, files } = makeClients(state);
  api.listProjectDirectories = async () => ({ current_path: "", parent_path: null, directories: [{ name: "Projects", path: "/srv/projects" }] });
  const model = new TutorialProjectModel(api, files);
  await model.loadChoices();
  assert.equal(model.state.defaultParent, "/srv/projects");
});


test("an uncertain directory response preserves the folder without claiming registration", async () => {
  const { state, model } = makeModel();
  await model.loadChoices();
  state.loseDirectoryResponse = true;
  await model.create("/srv/projects", "uncertain", "id-1");
  assert.equal(state.directories.has("/srv/projects/uncertain"), true);
  assert.match(model.state.error!, /Directory creation was not confirmed/);
  assert.match(model.state.error!, /No registration request was sent/);
  assert.doesNotMatch(model.state.error!, /remove the registration/);
  assert.deepEqual(writeMethodNames(state), ["createProjectDirectory"]);
});

for (const committed of [false, true]) {
  test(`fresh-folder recovery preserves an uncertain registration (committed=${committed})`, async () => {
    const { state, model } = makeModel();
    await model.loadChoices();
    if (committed) state.loseRegistrationResponse = true;
    else state.failOn = { method: "createProject" };
    await model.create("/srv/projects", "uncertain", "id-1");
    assert.match(model.state.error!, /Registration was not confirmed/);
    assert.match(model.state.error!, /may already be registered/);
    assert.doesNotMatch(model.state.error!, /remove the registration/);
    assert.equal(model.state.partialProject, null);
    assert.equal(model.state.partialPath, "/srv/projects/uncertain");
    assert.deepEqual(writeMethodNames(state), ["createProjectDirectory", "createProject"]);
    const preserved = [...state.files.get("/srv/projects/uncertain")!];
    const beforeRecovery = state.calls.length;
    assert.equal(model.chooseAnotherFolder(), true);
    assert.equal(state.calls.length, beforeRecovery, "fresh choice makes no API calls");
    assert.equal(model.state.partialPath, null);
    assert.match(model.state.notice!, /registration is unknown/);
    assert.equal(state.registered.size, committed ? 1 : 0);
    state.loseRegistrationResponse = false;
    const beforeOldPath = writeMethodNames(state).length;
    await model.create("/srv/projects", "uncertain", "id-1");
    assert.deepEqual(writeMethodNames(state).slice(beforeOldPath), committed ? [] : ["createProjectDirectory"], "old path is never registered or reseeded");
    assert.deepEqual([...state.files.get("/srv/projects/uncertain")!], preserved);
    await model.create("/srv/projects", "fresh", "id-1");
    assert.equal(model.state.verified?.project.canonical_path, "/srv/projects/fresh");
    assert.deepEqual([...state.files.get("/srv/projects/uncertain")!], preserved);
    assert.equal(writeMethodNames(state).includes("deleteProject"), false);
  });
}

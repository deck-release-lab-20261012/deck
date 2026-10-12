import {
  ApiError,
  type ApiClient,
  type FileApiClient,
  type GitIdentityProfile,
  type Project,
  type SessionSummary,
  type TmTask,
} from "../api/client.ts";
import {
  firstProjectSampleFiles,
  firstProjectSampleVersion,
  firstProjectTask,
  firstProjectTaskFiles,
} from "./tutorial-first-project.ts";

// The tutorial first-project workflow, as an ordinary state machine over
// the typed API clients. No DOM, no terminal, no command execution, no
// provider output interpretation, no localStorage: every fact comes from a
// real API call and every mutation is one of the client's own write
// methods. The UI (live.ts / tutorial-panel.ts) observes state through
// onChange; it never drives the sequence itself.

export const tutorialManifestPath = "tutorial.json";
const manifestVersion = firstProjectSampleVersion;
const manifestSample = "reading-list";
const manifestKeys = ["canonicalPath", "projectId", "sample", "taskId", "version"] as const;

// The completion marker written last. It binds the actual project id, the
// actual canonical path, and the actual task id the engine assigned —
// never names, which a copy into another directory would satisfy.
export interface TutorialManifest {
  version: number;
  sample: string;
  projectId: string;
  canonicalPath: string;
  taskId: string;
}

export interface TutorialVerifiedProject {
  project: Project;
  task: TmTask;
}

export interface TutorialProjectModelState {
  busy: boolean;
  partialPath: string | null;
  partialProject: Project | null;
  error: string | null;
  notice: string | null;
  projects: readonly Project[];
  providers: readonly string[];
  identities: readonly GitIdentityProfile[];
  defaultIdentityId: string | null;
  defaultParent: string | null;
  verified: TutorialVerifiedProject | null;
  createdSession: SessionSummary | null;
}

function joinPath(parent: string, name: string): string {
  return `${parent.replace(/\/+$/, "")}/${name}`;
}

// Parsing is strict and bounded on purpose: the manifest is a completion
// marker the operator's agent could have touched, so anything outside the
// exact shape — an extra key, a wrong version, a copied body — is a
// refusal, not a best-effort read.
function parseManifest(text: string): TutorialManifest | null {
  if (text.length > 8192) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== manifestKeys.length || manifestKeys.some((k, i) => keys[i] !== k)) return null;
  if (record.version !== manifestVersion) return null;
  if (record.sample !== manifestSample) return null;
  for (const key of ["projectId", "canonicalPath", "taskId"]) {
    if (typeof record[key] !== "string" || record[key] === "" || (record[key] as string).length > 4096) return null;
  }
  if (!/^[1-9]\d*(?:\.\d+)*$/.test(record.taskId as string)) return null;
  return {
    version: record.version as number,
    sample: record.sample as string,
    projectId: record.projectId as string,
    canonicalPath: record.canonicalPath as string,
    taskId: record.taskId as string,
  };
}

class Halted extends Error {}

export class TutorialProjectModel {
  readonly state: TutorialProjectModelState = {
    busy: false,
    partialPath: null,
    partialProject: null,
    error: null,
    notice: null,
    projects: [],
    providers: [],
    identities: [],
    defaultIdentityId: null,
    defaultParent: null,
    verified: null,
    createdSession: null,
  };

  // The partial record kept when a create stopped partway: the id and path
  // that are known to have been created by this model, so removal can be
  // offered honestly for exactly that directory and nothing else.
  private partial: { projectId: string; canonicalPath: string } | null = null;

  private generation = 0;
  private suspended = false;
  private disposed = false;

  private readonly api: ApiClient;
  private readonly files: FileApiClient;
  private readonly onChange: () => void;

  constructor(api: ApiClient, files: FileApiClient, onChange: () => void = () => {}) {
    this.api = api;
    this.files = files;
    this.onChange = onChange;
  }

  // Every in-flight chain fences against this: an await that resolves
  // after a suspend, dispose, or newer operation must not issue the next
  // request or publish state. Requests the server already accepted may
  // have committed; nothing here retries or undoes them silently.
  private live(gen: number): void {
    if (this.disposed || this.suspended || gen !== this.generation) throw new Halted();
  }

  private publish(gen: number, patch: Partial<TutorialProjectModelState>): void {
    this.live(gen);
    Object.assign(this.state, patch);
    this.onChange();
  }

  private fail(gen: number, message: string): void {
    if (this.disposed || this.suspended || gen !== this.generation) return;
    this.publish(gen, { busy: false, error: message, notice: null });
  }

  private started(gen: number): void {
    this.publish(gen, { busy: true, error: null, notice: null });
  }

  private errorMessage(err: unknown): string {
    if (err instanceof ApiError) return err.message;
    if (err instanceof Error) return err.message;
    return String(err);
  }

  async loadChoices(): Promise<void> {
    if (this.disposed || this.suspended || this.state.busy) return;
    const gen = ++this.generation;
    try {
      this.started(gen);
      const projects = await this.api.listProjects();
      this.live(gen);
      const providers = await this.api.listProviders();
      this.live(gen);
      const identities = await this.api.listGitIdentities();
      this.live(gen);
      const root = await this.api.listProjectDirectories();
      this.live(gen);
      this.publish(gen, {
        busy: false,
        projects,
        providers,
        identities: identities.profiles,
        defaultIdentityId: identities.default_profile_id,
        defaultParent: root.current_path || root.directories[0]?.path || null,
      });
    } catch (err) {
      if (err instanceof Halted) return;
      this.fail(gen, `Could not read the current setup: ${this.errorMessage(err)}`);
    }
  }

  async create(parent: string, name: string, profileId: string | null): Promise<void> {
    if (this.disposed || this.suspended || this.state.busy) return;
    const gen = ++this.generation;
    if (this.state.partialPath || this.state.verified) {
      this.fail(gen, this.state.partialPath && !this.state.partialProject
        ? "Registration of the partial folder is unknown. Choose another folder to leave it unchanged; it will not be reseeded."
        : "A tutorial project is already bound here. Keep it or remove its registration before creating another; a partial directory is never reseeded.");
      return;
    }
    if (!name.trim() || name === "." || name === ".." || /[\/\\\u0000-\u001f]/u.test(name) || !parent.startsWith("/")) {
      this.fail(gen, "Name the project before creating it.");
      return;
    }
    const profile = profileId === null ? null : this.state.identities.find((p) => p.id === profileId) ?? null;
    if (!profile) {
      this.fail(gen, "Pick a Git identity before creating the project; the tutorial never writes one on your behalf.");
      return;
    }
    let stage: "check" | "directory" | "registration" | "seed" = "check";
    const target = joinPath(parent, name);
    try {
      this.started(gen);
      const registered = await this.api.listProjects();
      this.live(gen);
      if (registered.some((p) => p.canonical_path === target)) {
        this.fail(gen, `${target} is already registered as a project; the tutorial never reseeds an existing directory.`);
        return;
      }
      // A fresh empty directory is a precondition, not a cleanup step: a
      // directory that already exists was not created for this tutorial
      // and is never registered, seeded, or retried.
      stage = "directory";
      const created = await this.api.createProjectDirectory(parent, name);
      this.live(gen);
      this.publish(gen, { partialPath: created.path });
      stage = "registration";
      const project = await this.api.createProject(name, created.path, profile);
      this.live(gen);
      this.partial = { projectId: project.id, canonicalPath: project.canonical_path };
      this.publish(gen, { partialProject: project, projects: [...registered, project] });
      stage = "seed";
      const root = await this.files.listProjectFiles(project.id, "");
      this.live(gen);
      const rootNames = root.entries.map((e) => e.name);
      if (root.truncated || !(rootNames.length === 1 && rootNames[0] === ".git")) {
        this.fail(
          gen,
          `The new project directory is not empty (found ${rootNames.join(", ") || "nothing where .git was expected"}); nothing was written to it.`,
        );
        return;
      }
      for (const file of firstProjectSampleFiles) {
        if (file.path === tutorialManifestPath) continue;
        await this.files.uploadProjectFile(project.id, file.path, new Blob([file.content]));
        this.live(gen);
      }
      await this.api.initializeTaskmaster(project.id);
      this.live(gen);
      await this.api.uploadPrd(project.id, "reading-list.md", firstProjectSampleFiles.find((f) => f.path === firstProjectTaskFiles.prd)!.content, false);
      this.live(gen);
      const task = await this.api.addTaskmasterTask(project.id, {
        title: firstProjectTask.title,
        description: firstProjectTask.description,
        details: firstProjectTask.details.join("\n"),
        priority: "medium",
      });
      this.live(gen);
      if (!/^[1-9]\d*(?:\.\d+)*$/.test(task.id)) throw new Error("The task engine returned an invalid task id.");
      const canonical = await this.api.getTaskmasterTask(project.id, task.id);
      this.live(gen);
      if (String(canonical.id) !== task.id || canonical.title !== firstProjectTask.title) throw new Error("The created task could not be verified.");
      // The manifest lands last and binds what actually exists: the
      // registered id, the canonical path, and the engine-assigned task
      // id. Until it is written, the directory is honestly incomplete.
      const manifest: TutorialManifest = {
        version: manifestVersion,
        sample: manifestSample,
        projectId: project.id,
        canonicalPath: project.canonical_path,
        taskId: task.id,
      };
      await this.files.uploadProjectFile(project.id, tutorialManifestPath, new Blob([JSON.stringify(manifest)]));
      this.live(gen);
      this.partial = null;
      this.publish(gen, {
        busy: false, partialPath: null, partialProject: null,
        verified: { project, task: canonical }, createdSession: null,
        notice: `Created ${project.canonical_path} and seeded the reading-list tutorial.`,
      });
    } catch (err) {
      if (err instanceof Halted) return;
      const recovery = stage === "check"
        ? "No directory or registration request was sent. Refresh choices before trying again."
        : stage === "directory"
          ? `Directory creation was not confirmed for ${target}. Check that folder before choosing a new name. No registration request was sent.`
          : stage === "registration"
            ? `Registration was not confirmed for ${this.state.partialPath}. It may already be registered; check the project list. No starter files were sent. Choose another folder to leave it unchanged.`
            : "The directory and any files remain in place. You can remove the registration from this panel.";
      this.fail(gen, `Creating the tutorial project stopped: ${this.errorMessage(err)} ${recovery}`);
    }
  }

  chooseAnotherFolder(): boolean {
    if (this.disposed || this.suspended || this.state.busy || !this.state.partialPath || this.state.partialProject || this.state.verified) return false;
    const path = this.state.partialPath;
    this.publish(++this.generation, {
      partialPath: null,
      error: null,
      notice: `Left ${path} unchanged. Its registration is unknown; check the project list. Enter a different new folder name to continue.`,
    });
    return true;
  }

  async resume(projectId: string): Promise<void> {
    if (this.disposed || this.suspended || this.state.busy) return;
    const gen = ++this.generation;
    if (this.state.partialPath) {
      this.fail(gen, this.state.partialProject
        ? "A partial tutorial directory remains. Remove its registration before choosing another project; it will not be reseeded."
        : "Registration of the partial folder is unknown. Choose another folder to leave it unchanged before resuming a project.");
      return;
    }
    this.publish(gen, { verified: null, createdSession: null });
    try {
      this.started(gen);
      const registered = await this.api.listProjects();
      this.live(gen);
      const project = registered.find((p) => p.id === projectId);
      if (!project) {
        this.fail(gen, "That project is not registered; nothing was read or changed.");
        return;
      }
      const view = await this.files.viewProjectFile(project.id, tutorialManifestPath);
      this.live(gen);
      const manifest = parseManifest(view.content);
      if (!manifest) {
        this.fail(gen, "The tutorial manifest in that project is missing or not the exact shape this tutorial writes; it was not resumed.");
        return;
      }
      if (manifest.projectId !== project.id || manifest.canonicalPath !== project.canonical_path) {
        this.fail(gen, "The tutorial manifest names a different project or directory; it was not resumed.");
        return;
      }
      const task = await this.api.getTaskmasterTask(project.id, manifest.taskId);
      this.live(gen);
      if (String(task.id) !== manifest.taskId || task.title !== firstProjectTask.title) {
        this.fail(gen, "The tutorial task in that project no longer carries its original title; it was not resumed.");
        return;
      }
      // The starter files the exercise depends on must still be the
      // originals: a tampered test file would make the lesson lie.
      for (const path of [firstProjectTaskFiles.tests, firstProjectTaskFiles.prd]) {
        const starter = firstProjectSampleFiles.find((f) => f.path === path)!.content;
        const current = await this.files.viewProjectFile(project.id, path);
        this.live(gen);
        if (current.content !== starter) {
          this.fail(gen, `${path} no longer matches the tutorial starter; it was not resumed.`);
          return;
        }
      }
      this.publish(gen, { busy: false, verified: { project, task } });
    } catch (err) {
      if (err instanceof Halted) return;
      this.fail(gen, `Resuming the tutorial project stopped: ${this.errorMessage(err)}`);
    }
  }

  private async reverify(gen: number): Promise<TutorialVerifiedProject | null> {
    const registered = await this.api.listProjects();
    this.live(gen);
    const project = registered.find((p) => p.id === this.state.verified?.project.id);
    const verified = this.state.verified;
    if (!verified || !project || project.canonical_path !== verified.project.canonical_path) {
      this.fail(gen, "The tutorial project is no longer registered as this panel knows it; the action was refused.");
      return null;
    }
    const view = await this.files.viewProjectFile(project.id, tutorialManifestPath);
    this.live(gen);
    const manifest = parseManifest(view.content);
    if (!manifest || manifest.projectId !== project.id || manifest.canonicalPath !== project.canonical_path || manifest.taskId !== String(verified.task.id)) {
      this.fail(gen, "The tutorial manifest no longer matches the registered project; the action was refused.");
      return null;
    }
    return { project, task: verified.task };
  }

  async connect(provider: string): Promise<SessionSummary | null> {
    if (this.disposed || this.suspended || this.state.busy) return null;
    const gen = ++this.generation;
    try {
      this.started(gen);
      const providers = await this.api.listProviders();
      this.live(gen);
      if (!providers.includes(provider)) {
        this.fail(
          gen,
          `"${provider}" is not available in this deployment. Run the CLI from a shell yourself if it is installed but not enabled here; the tutorial starts no session on your behalf.`,
        );
        return null;
      }
      if (!this.state.verified) {
        this.fail(gen, "Resume the tutorial project before starting a session on it.");
        return null;
      }
      const verified = await this.reverify(gen);
      if (!verified) return null;
      const session = await this.api.createSession(verified.project.id, provider);
      this.live(gen);
      this.publish(gen, { busy: false, createdSession: session });
      return session;
    } catch (err) {
      if (err instanceof Halted) return null;
      this.fail(gen, `Starting the tutorial session stopped: ${this.errorMessage(err)}`);
      return null;
    }
  }

  async refreshTask(): Promise<void> {
    if (this.disposed || this.suspended || this.state.busy) return;
    const gen = ++this.generation;
    const verified = this.state.verified;
    if (!verified) {
      this.fail(gen, "No tutorial project is resumed yet.");
      return;
    }
    try {
      this.started(gen);
      const task = await this.api.getTaskmasterTask(verified.project.id, String(verified.task.id));
      this.live(gen);
      this.publish(gen, { busy: false, verified: { project: verified.project, task } });
    } catch (err) {
      if (err instanceof Halted) return;
      this.fail(gen, `Reading the tutorial task stopped: ${this.errorMessage(err)}`);
    }
  }

  async enablePreview(): Promise<void> {
    if (this.disposed || this.suspended || this.state.busy) return;
    const gen = ++this.generation;
    if (!this.state.verified) {
      this.fail(gen, "No tutorial project is resumed yet.");
      return;
    }
    if (typeof this.api.enableProjectPreview !== "function") {
      this.fail(gen, "App preview is not configured in this deployment.");
      return;
    }
    try {
      this.started(gen);
      const verified = await this.reverify(gen);
      if (!verified) return;
      await this.api.enableProjectPreview(verified.project.id);
      this.live(gen);
      this.publish(gen, { busy: false, notice: "App preview enabled for the tutorial project." });
    } catch (err) {
      if (err instanceof Halted) return;
      this.fail(gen, `Enabling app preview stopped: ${this.errorMessage(err)}`);
    }
  }

  // Removal unregisters the project and stops its sessions — that is all
  // deleteProject does. The files on disk remain, and the notice says so;
  // this model never deletes anything from the filesystem itself.
  async remove(): Promise<void> {
    if (this.disposed || this.suspended || this.state.busy) return;
    const gen = ++this.generation;
    const bound = this.state.verified
      ? { projectId: this.state.verified.project.id, canonicalPath: this.state.verified.project.canonical_path }
      : this.partial;
    if (!bound) {
      this.fail(gen, "There is no tutorial project bound to this panel to remove.");
      return;
    }
    try {
      this.started(gen);
      const registered = await this.api.listProjects();
      this.live(gen);
      const project = registered.find((p) => p.id === bound.projectId);
      if (!project || project.canonical_path !== bound.canonicalPath) {
        this.fail(gen, "That project is not registered under the recorded path; nothing was removed.");
        return;
      }
      if (this.state.verified && !await this.reverify(gen)) return;
      this.live(gen);
      await this.api.deleteProject(bound.projectId);
      this.live(gen);
      this.partial = null;
      this.publish(gen, {
        busy: false,
        verified: null,
        partialPath: null,
        partialProject: null,
        projects: registered.filter((p) => p.id !== bound.projectId),
        createdSession: null,
        notice: "Sessions stopped and the project unregistered; the files remain in place.",
      });
    } catch (err) {
      if (err instanceof Halted) return;
      this.fail(gen, `Removing the tutorial project stopped: ${this.errorMessage(err)}`);
    }
  }

  // Suspending kills every in-flight chain at its next fence; requests the
  // server already accepted may have committed, and nothing resumes them
  // automatically. resumeLifecycle lets a new operator gesture start.
  suspend(): void {
    this.generation += 1;
    this.suspended = true;
    if (this.state.busy) {
      this.state.busy = false;
      this.state.notice = "The action was interrupted. A request may have completed; inspect the project before trying another action.";
    }
    this.onChange();
  }

  resumeLifecycle(): void {
    if (this.disposed) return;
    this.generation += 1;
    this.suspended = false;
  }

  dispose(): void {
    this.generation += 1;
    this.disposed = true;
    this.state.busy = false;
  }
}

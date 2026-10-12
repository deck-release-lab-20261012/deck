// The tutorial's explicit actions use the ordinary project APIs and selected
// terminal. Lesson progress never stands in for task or test results.
import type { ApiClient, FileApiClient, SessionSummary } from "../api/client.ts";
import { escapeHtml } from "../lib/escape.ts";
import { openProjectPreview } from "./project-preview.ts";
import { firstProjectTask } from "./tutorial-first-project.ts";
import { TutorialProjectModel } from "./tutorial-project.ts";

interface TutorialProjectHost {
  changed(): void;
  captureSelection(): () => boolean;
  selectSession(session: SessionSummary): Promise<void>;
  insert(projectID: string, text: string): boolean;
}

const baseline = "git add index.html app.mjs list.mjs list.test.mjs serve.mjs PRD.md preview.json tutorial.json LICENSE && git commit -m 'Add reading-list starter'";
const tests = "node --test";
const diff = "git diff -- list.mjs";
const preview = "noise deck preview run --config preview.json";

export class TutorialProjectView {
  readonly model: TutorialProjectModel;
  private fields: Record<string, string> = { name: `reading-list-${crypto.randomUUID().slice(0, 8)}` };
  private epoch = 0;
  private disposed = false;
  private message = "";
  private choicesRequested = false;
  private source: string | null = null;
  private testsConfirmed = false;
  private previewConfirmed = false;

  constructor(private readonly root: HTMLElement, private readonly api: ApiClient & FileApiClient,
    private readonly host: TutorialProjectHost) {
    this.model = new TutorialProjectModel(api, api, () => host.changed());
    root.addEventListener("input", this.onInput);
    root.addEventListener("change", this.onInput);
  }

  private readonly onInput = (event: Event): void => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) return;
    const name = input.dataset.tutorialField;
    if (name) this.fields[name] = input.value;
  };

  private button(action: string, label: string, disabled = false): string {
    return `<button type="button" data-tutorial-action="project-${action}" ${disabled || this.model.state.busy ? "disabled" : ""}>${escapeHtml(label)}</button>`;
  }

  private command(text: string, action: string): string {
    return `<pre><code>${escapeHtml(text)}</code></pre>${this.button(action, "Copy command")}`;
  }

  private completionCommand(): string | null {
    const task = this.model.state.verified?.task;
    const id = String(task?.id ?? "");
    return task && /^[1-9]\d*(?:\.\d+)*$/.test(id) && Number.isSafeInteger(task.revision)
      ? `noise tasks set-status --revision ${task.revision} ${id} done` : null;
  }

  render(lesson: string): string {
    if (!lesson.startsWith("first-project-")) return "";
    // The first visit can follow identity setup, so read the current choices then.
    if (!this.choicesRequested) {
      this.choicesRequested = true;
      queueMicrotask(() => {
        if (!this.disposed) void this.model.loadChoices();
      });
    }
    const state = this.model.state;
    const verified = state.verified;
    const status = `<div class="tutorial-project">${state.busy ? '<p role="status">Working…</p>' : ""}${state.error ? `<p role="alert">${escapeHtml(state.error)}</p>` : ""}${state.notice ? `<p role="status">${escapeHtml(state.notice)}</p>` : ""}${this.message ? `<p role="status">${escapeHtml(this.message)}</p>` : ""}${verified ? `<p>Project: <code>${escapeHtml(verified.project.canonical_path)}</code><br>Task ${escapeHtml(String(verified.task.id))}: ${escapeHtml(verified.task.status)}</p>` : ""}`;
    const option = (value: string, label: string, selected: string) => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
    if (lesson === "first-project-create") {
      const identity = this.fields.identity ?? state.defaultIdentityId ?? "";
      return status + `<label>Parent directory<input data-tutorial-field="parent" value="${escapeHtml(this.fields.parent ?? state.defaultParent ?? "")}"></label>
        <label>New folder name<input data-tutorial-field="name" value="${escapeHtml(this.fields.name ?? "")}"></label>
        <label>Git identity<select data-tutorial-field="identity">${option("", "Choose an identity", identity)}${state.identities.map((p) => option(p.id, `${p.name} <${p.email}>`, identity)).join("")}</select></label>
        ${!state.busy && state.identities.length === 0 ? '<p>Choose Git identity… from the global menu to set up an identity, then Refresh choices here.</p>' : ""}
        ${this.button("create", "Create tutorial project", !!verified || !!state.partialPath)}
        <p>Use a new folder. Existing files are never reseeded. If setup stops, the partial directory remains.</p>
        <label>Existing tutorial project<select data-tutorial-field="resume">${option("", "Choose a project", this.fields.resume ?? "")}${state.projects.map((p) => option(p.id, `${p.name} — ${p.canonical_path}`, this.fields.resume ?? "")).join("")}</select></label>
        ${this.button("resume", "Verify and resume")}${this.button("choices", "Refresh choices")}
        ${state.partialPath ? `<p>Partial directory: <code>${escapeHtml(state.partialPath)}</code>. Files remain; it will not be reseeded.</p>` : ""}
        ${state.partialPath && !state.partialProject && !verified ? this.button("fresh-folder", "Choose another folder") : ""}
        ${this.button("remove", "Remove tutorial registration", !verified && !state.partialProject)}</div>`;
    }
    if (!verified) return status + '<p>Create or verify a tutorial project in “Create a reading list” before using these actions.</p></div>';
    if (lesson === "first-project-connect") {
      const providers = state.providers.filter((p) => p !== "shell");
      const provider = this.fields.provider ?? "";
      return status + `${this.button("shell", "Open tutorial shell", !state.providers.includes("shell"))}
        <p>In the shell, commit the starter before the agent changes it, then run the baseline tests. Expect one failing behavior.</p>
        ${this.command(baseline, "baseline")}${this.command(tests, "tests")}
        <label>Agent CLI<select data-tutorial-field="provider">${option("", "Choose an available CLI", provider)}${providers.map((p) => option(p, p, provider)).join("")}</select></label>
        ${this.button("connect", "Open agent console")}
        <p>The Codex login helper keeps sign-in in the same terminal. If OpenAI returns to a localhost error page, copy that tab’s entire address and paste it only into the helper. Use terminal instead closes the helper; Open login helper brings it back.</p>
        <p>No provider available? Use the shell and edit the file manually. Authentication and model selection stay in the native CLI.</p></div>`;
    }
    if (lesson === "first-project-implement") return status + `<pre><code>${escapeHtml(firstProjectTask.prompt)}</code></pre>
      ${this.button("copy-prompt", "Copy prompt")}${this.button("insert", "Insert into selected agent console")}
      <p>Insertion adds exactly this text without Enter. Check the selected console and its existing input first; Deck does not inspect or replace the native prompt.</p></div>`;
    if (lesson === "first-project-inspect") return status + `${this.command(tests, "tests")}${this.command(diff, "diff")}
      ${this.button("source", "Read current list.mjs")}${this.source === null ? "" : `<pre><code>${escapeHtml(this.source)}</code></pre>`}
      ${this.button("confirm-tests", this.testsConfirmed ? "Tests and diff confirmed by you" : "I ran the tests and reviewed the diff")}
      <p>This confirmation is local to this visit. It does not change the task status or claim an automated check.</p></div>`;
    if (lesson === "first-project-preview") return status + `${this.button("enable-preview", "Enable project preview")}${this.command(preview, "preview-command")}
      ${this.button("check-preview", "Check preview server")}${this.button("open-preview", "Open preview")}
      ${this.button("confirm-preview", this.previewConfirmed ? "App behavior confirmed by you" : "I checked the unread-only toggle")}</div>`;
    const command = this.completionCommand();
    return status + `<p>Tests and diff: ${this.testsConfirmed ? "confirmed by you" : "not confirmed this visit"}. App: ${this.previewConfirmed ? "confirmed by you" : "not confirmed this visit"}.</p>
      ${command ? this.command(command, "finish-command") : '<p>Refresh the task to read its current revision before recording the outcome.</p>'}
      ${this.button("refresh-task", "Refresh task status")}
      <p>Run the command in the tutorial shell only after the checks succeed. A revision or claim conflict requires reading the task again, not a retry. Tutorial navigation does not finish the task.</p>
      ${this.button("remove", "Remove tutorial registration")}
      <p>Removal stops this project’s sessions and unregisters it. Files remain on disk.</p></div>`;
  }

  async action(action: string): Promise<void> {
    if (!action.startsWith("project-") || this.disposed || this.model.state.busy) return;
    const epoch = this.epoch;
    const current = () => !this.disposed && epoch === this.epoch;
    const verified = this.model.state.verified;
    this.message = "";
    const copy = async (text: string) => {
      await navigator.clipboard.writeText(text);
      if (current()) this.message = "Copied. Review it in the intended console before submitting.";
    };
    try {
      switch (action.slice(8)) {
        case "choices": await this.model.loadChoices(); break;
        case "create":
          await this.model.create(this.fields.parent ?? this.model.state.defaultParent ?? "", this.fields.name ?? "", this.fields.identity ?? this.model.state.defaultIdentityId);
          if (current()) { this.testsConfirmed = false; this.previewConfirmed = false; this.source = null; }
          break;
        case "fresh-folder":
          if (this.model.chooseAnotherFolder()) this.fields.name = "";
          break;
        case "resume":
          await this.model.resume(this.fields.resume ?? "");
          if (current()) { this.testsConfirmed = false; this.previewConfirmed = false; this.source = null; }
          break;
        case "shell":
        case "connect": {
          const provider = action === "project-shell" ? "shell" : this.fields.provider ?? "";
          // A late creation must not replace a newer workspace selection.
          const stillSelected = this.host.captureSelection();
          const session = await this.model.connect(provider);
          if (session && current() && stillSelected()) await this.host.selectSession(session);
          break;
        }
        case "copy-prompt": await copy(firstProjectTask.prompt); break;
        case "insert":
          if (!verified || !this.host.insert(verified.project.id, firstProjectTask.prompt)) {
            this.message = "Select an attached agent console in this verified tutorial project first.";
          } else {
            this.message = "Text handed to the selected terminal without Enter. Check it and press Enter yourself; do not retry automatically.";
          }
          break;
        case "baseline": await copy(baseline); break;
        case "tests": await copy(tests); break;
        case "diff": await copy(diff); break;
        case "preview-command": await copy(preview); break;
        case "finish-command": { const command = this.completionCommand(); if (command) await copy(command); break; }
        case "source":
          if (verified) {
            const file = await this.api.viewProjectFile(verified.project.id, "list.mjs");
            if (current() && this.model.state.verified?.project.id === verified.project.id) this.source = file.content;
          }
          break;
        case "confirm-tests": this.testsConfirmed = true; break;
        case "confirm-preview": this.previewConfirmed = true; break;
        case "enable-preview": await this.model.enablePreview(); break;
        case "check-preview":
          if (verified && this.api.checkProjectPreview) {
            const result = await this.api.checkProjectPreview(verified.project.id);
            if (current() && this.model.state.verified?.project.id === verified.project.id) this.message = result.reachable ? "The preview server answered. Check the app behavior yourself." : "The preview server did not answer. Run the launcher in the tutorial shell.";
          } else this.message = "Project preview is not configured.";
          break;
        case "open-preview":
          if (verified) openProjectPreview(verified.project.id, this.api, (message) => {
            if (current()) { this.message = message; this.host.changed(); }
          });
          break;
        case "refresh-task": await this.model.refreshTask(); break;
        case "remove":
          if (window.confirm("Stop this tutorial project’s sessions and remove its Deck registration? Its files will remain on disk.")) await this.model.remove();
          break;
      }
    } catch (error) {
      if (current()) this.message = error instanceof Error ? error.message : String(error);
    }
    if (current()) this.host.changed();
  }

  dispose(): void {
    this.disposed = true;
    ++this.epoch;
    this.model.dispose();
    this.root.removeEventListener("input", this.onInput);
    this.root.removeEventListener("change", this.onInput);
  }
}

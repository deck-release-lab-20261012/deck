import type { GitHubAttempt, GitHubConnectClient, GitHubStatus } from "./client.ts";

export type GitHubConnectPhase = "idle" | "reading" | "ready" | "starting" | "cancelling" | "uncertain" | "error" | "closed";
export interface GitHubConnectState {
  phase: GitHubConnectPhase;
  status: GitHubStatus | null;
  attempt: GitHubAttempt | null;
  message: string;
}

export function connectAction(status: GitHubStatus | null): "connect" | "reconnect" | null {
  if (status === null || (status.source !== undefined && status.source !== "stored")) return null;
  if (status.outcome === "no-account") return "connect";
  if (status.outcome === "auth-issue" && status.source === "stored" && status.source_writeable === true &&
      status.active === true && status.state === "error" && Boolean(status.login)) return "reconnect";
  return null;
}

export class GitHubConnectModel {
  state: GitHubConnectState = { phase: "idle", status: null, attempt: null, message: "" };
  private client: GitHubConnectClient;
  private changed: () => void;
  private csrf = "";
  private generation = 0;
  private request: AbortController | null = null;

  constructor(client: GitHubConnectClient, changed: () => void = () => {}) {
    this.client = client;
    this.changed = changed;
  }

  get busy(): boolean { return ["reading", "starting", "cancelling"].includes(this.state.phase); }
  get canStart(): boolean {
    return this.state.phase === "ready" && connectAction(this.state.status) !== null &&
      !["running", "unavailable"].includes(this.state.attempt?.status ?? "");
  }
  get canCancel(): boolean { return this.state.phase === "ready" && this.state.attempt?.status === "running"; }

  open(): Promise<void> { return this.read(); }

  async read(): Promise<void> {
    if (this.busy || this.state.phase === "closed") return;
    const generation = ++this.generation;
    const request = new AbortController();
    this.request = request;
    this.set({ phase: "reading", message: "Reading GitHub status…" });
    const timeout = setTimeout(() => request.abort(), 15000);
    try {
      const [status, current] = await Promise.all([this.client.status(request.signal), this.client.current(request.signal)]);
      if (!this.current(generation)) return;
      if (request.signal.aborted) throw new Error("Status read timed out");
      this.csrf = current.csrf;
      this.set({ phase: "ready", status, attempt: current.attempt, message: "" });
    } catch {
      if (this.current(generation)) this.set({ phase: "error", message: "GitHub status could not be read. Read status before changing the connection." });
    } finally {
      clearTimeout(timeout);
      request.abort();
      if (this.current(generation)) this.request = null;
    }
  }

  async start(): Promise<void> {
    if (!this.canStart) return;
    await this.mutate("starting", async signal => {
      const attempt = await this.client.start(this.csrf, signal);
      return { attempt };
    });
  }

  async cancel(): Promise<void> {
    if (!this.canCancel) return;
    const attempt = this.state.attempt!;
    await this.mutate("cancelling", async signal => {
      await this.client.cancel(attempt.id, this.csrf, signal);
      return { attempt: { ...attempt, status: "cancelled" as const } };
    });
  }

  private async mutate(phase: "starting" | "cancelling", action: (signal: AbortSignal) => Promise<Partial<GitHubConnectState>>): Promise<void> {
    const generation = ++this.generation;
    const request = new AbortController();
    this.request = request;
    this.set({ phase, message: phase === "starting" ? "Starting GitHub sign-in…" : "Cancelling GitHub sign-in…" });
    const timeout = setTimeout(() => request.abort(), 20000);
    try {
      const result = await action(request.signal);
      if (request.signal.aborted) throw new Error("Mutation outcome unknown");
      if (this.current(generation)) this.set({ ...result, phase: "ready", message: "" });
    } catch {
      if (this.current(generation)) this.set({ phase: "uncertain", message: "The change could not be confirmed. Nothing was retried. Read status before taking another action." });
    } finally {
      clearTimeout(timeout);
      request.abort();
      if (this.current(generation)) this.request = null;
    }
  }

  private current(generation: number): boolean { return this.state.phase !== "closed" && generation === this.generation; }
  private set(update: Partial<GitHubConnectState>): void { this.state = { ...this.state, ...update }; this.changed(); }

  dispose(): void {
    ++this.generation;
    this.request?.abort();
    this.request = null;
    this.csrf = "";
    this.state = { phase: "closed", status: null, attempt: null, message: "" };
  }
}

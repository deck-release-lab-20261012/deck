import { AgentTerminal } from "../terminal/attach.ts";
import { createTerminal, ensureMonoFontLoaded } from "../terminal/term.ts";
import { terminalFontSize } from "../terminal/font-size.ts";
import { resolveTerminalTheme, terminalThemeName } from "../terminal/theme.ts";
import { activateDialog } from "../ui/dialog-focus.ts";
import { dialogHead, PRIMARY_MD_BUTTON, SECONDARY_MD_BUTTON, GHOST_MD_BUTTON } from "../ui/controls.ts";
import type { GitHubConnectClient, GitHubStatus } from "./client.ts";
import { GitHubConnectModel, connectAction } from "./model.ts";

export interface GitHubConnectDialogOptions { onClosed?: () => void; controllerID?: string }

export function githubStatusMessage(status: GitHubStatus | null): string {
  if (status === null) return "GitHub status has not been read.";
  const connected = status.outcome === "authenticated" ? `Connected to GitHub${status.login ? ` as ${status.login}` : ""}. ` : "";
  if (status.source === "environment") return connected + "GitHub access comes from an environment credential. Update it in your deployment; this dialog will not replace it.";
  if (status.source === "unknown") return connected + "The credential source is unknown. Resolve it with the GitHub CLI before changing the connection.";
  if (connected) return connected.trim();
  if (status.outcome === "no-account") return "No GitHub account is connected.";
  if (connectAction(status) === "reconnect") return `The stored connection for ${status.login} failed. Reconnect to sign in again.`;
  if (status.outcome === "authentication-required") return "Enable password, OIDC, or trusted-proxy authentication in Deck before connecting GitHub.";
  if (status.outcome === "missing-cli") return "The GitHub CLI is unavailable in this Deck instance.";
  if (status.outcome === "auth-issue") return "The GitHub connection needs attention. Check the GitHub CLI before changing the account.";
  return "GitHub status could not be verified. Read status again before changing the connection.";
}

export class GitHubConnectDialog {
  private host: HTMLElement;
  private options: GitHubConnectDialogOptions;
  private model: GitHubConnectModel;
  private root: HTMLElement | null = null;
  private terminal: AgentTerminal | null = null;
  private terminalID: string | null = null;
  private terminalMode: "connecting" | "connected" | "reconnect" | "takeover" = "connecting";
  private terminalMessage = "";
  private releaseFocus?: () => void;
  private opener: HTMLElement | null = null;
  private disposed = false;

  constructor(host: HTMLElement, client: GitHubConnectClient, options: GitHubConnectDialogOptions = {}) {
    this.host = host;
    this.options = options;
    this.model = new GitHubConnectModel(client, () => this.render());
  }

  open(): void {
    if (this.disposed || this.root !== null) return;
    this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.root = document.createElement("div");
    this.root.className = "scrim";
    this.root.style.zIndex = "92";
    this.root.innerHTML = `<section data-github-connect-dialog role="dialog" aria-modal="true" aria-label="Connect GitHub" class="dialog" style="width:min(720px,100%);max-height:calc(100dvh - 24px)">
      ${dialogHead("Connect GitHub", { label: "Close", attr: "data-github-close" })}
      <div class="dialog-body overflow-y-auto">
        <p data-github-status class="text-body-sm text-text-secondary"></p>
        <p data-github-message hidden role="status" class="text-body-sm text-text-secondary"></p>
        <p data-github-instructions hidden class="text-body-sm text-text-secondary">Follow the GitHub CLI’s instructions below. When you finish, choose Read status to check the connection. Closing this dialog leaves sign-in running.</p>
        <div data-github-terminal hidden style="height:min(42dvh,360px);min-height:200px;overflow:hidden"></div>
        <p data-github-terminal-status hidden role="status" class="text-body-sm text-text-secondary"></p>
        <div class="flex flex-wrap gap-2">
          <button type="button" data-github-reattach hidden class="${SECONDARY_MD_BUTTON}">Reconnect terminal</button>
          <button type="button" data-github-takeover hidden class="${SECONDARY_MD_BUTTON}">Take control</button>
        </div>
      </div>
      <footer class="dialog-foot flex-wrap">
        <button type="button" data-github-cancel hidden class="${GHOST_MD_BUTTON}">Cancel sign-in</button>
        <button type="button" data-github-read class="${SECONDARY_MD_BUTTON}">Read status</button>
        <button type="button" data-github-start hidden class="${PRIMARY_MD_BUTTON}">Connect GitHub</button>
        <button type="button" data-github-close class="${SECONDARY_MD_BUTTON}">Close</button>
      </footer>
    </section>`;
    this.host.append(this.root);
    const dialog = this.root.querySelector<HTMLElement>("[role=dialog]")!;
    this.releaseFocus = activateDialog(dialog, () => this.dispose(), ":dialog");
    this.root.addEventListener("click", event => { if (event.target === this.root) this.dispose(); });
    this.root.querySelectorAll("[data-github-close]").forEach(button => button.addEventListener("click", () => this.dispose()));
    this.root.querySelector("[data-github-read]")!.addEventListener("click", () => void this.model.read());
    this.root.querySelector("[data-github-start]")!.addEventListener("click", () => void this.model.start());
    this.root.querySelector("[data-github-cancel]")!.addEventListener("click", () => void this.model.cancel());
    this.root.querySelector("[data-github-reattach]")!.addEventListener("click", () => this.attach(false));
    this.root.querySelector("[data-github-takeover]")!.addEventListener("click", () => this.attach(true));
    this.render();
    void this.model.open();
  }

  private render(): void {
    if (this.disposed || this.root === null) return;
    const state = this.model.state;
    this.root.querySelector("[data-github-status]")!.textContent = githubStatusMessage(state.status);
    const attemptMessage = state.attempt?.status === "exited" ? "The sign-in process ended. Read status to check whether GitHub is connected."
      : state.attempt?.status === "cancelled" ? "Sign-in was cancelled."
      : state.attempt?.status === "unavailable" ? "The sign-in process could not be verified. Nothing was restarted or stopped." : "";
    const message = this.root.querySelector<HTMLElement>("[data-github-message]")!;
    message.textContent = state.message || attemptMessage;
    message.hidden = message.textContent === "";
    const start = this.root.querySelector<HTMLButtonElement>("[data-github-start]")!;
    start.hidden = !this.model.canStart;
    start.textContent = connectAction(state.status) === "reconnect" ? "Reconnect GitHub" : "Connect GitHub";
    this.root.querySelector<HTMLButtonElement>("[data-github-read]")!.disabled = this.model.busy;
    this.root.querySelector<HTMLButtonElement>("[data-github-cancel]")!.hidden = !this.model.canCancel;
    const running = state.attempt?.status === "running";
    if (!running) this.disposeTerminal();
    else if (state.phase === "ready" && this.terminalID !== state.attempt!.id) this.mountTerminal(state.attempt!.id);
    if (state.phase === "cancelling" || state.phase === "uncertain") {
      this.terminal?.disconnect();
      this.terminalMode = "reconnect";
    }
    this.root.querySelector<HTMLElement>("[data-github-terminal]")!.hidden = !running;
    this.root.querySelector<HTMLElement>("[data-github-instructions]")!.hidden = !running;
    this.renderTerminal();
  }

  private mountTerminal(id: string): void {
    this.disposeTerminal();
    if (this.root === null) return;
    this.terminalID = id;
    const container = this.root.querySelector<HTMLElement>("[data-github-terminal]")!;
    container.hidden = false;
    const current = () => !this.disposed && this.terminalID === id;
    const ended = (takeover: boolean, message: string) => {
      if (!current()) return;
      this.terminalMode = takeover ? "takeover" : "reconnect";
      this.terminalMessage = message;
      this.renderTerminal();
    };
    const fontSize = terminalFontSize();
    this.terminal = new AgentTerminal(container, {
      onAttached: () => {
        if (!current()) return;
        this.terminalMode = "connected";
        this.terminalMessage = "";
        this.renderTerminal();
      },
      onTakeoverRequired: () => ended(true, "Another browser controls this sign-in. Take control to continue here."),
      onFenced: () => ended(true, "Another browser took control of this sign-in."),
      onLeaseExpired: () => ended(false, "Terminal control expired. Reconnect to continue the same sign-in."),
      onDropped: () => ended(false, "The terminal disconnected. Reconnect to the same sign-in."),
      onError: () => ended(false, "The terminal is unavailable. Read status before continuing."),
      onClose: () => {
        if (current() && this.terminalMode !== "takeover") ended(false, "The terminal disconnected. Read status or reconnect; nothing was restarted.");
      },
      onWriteStatus: code => {
        if (code !== "sent") ended(false, "Terminal input could not be confirmed. Check the native CLI before sending it again.");
      },
    }, {
      controllerID: this.options.controllerID,
      terminalPath: attempt => `/api/github/connect/attempt/${encodeURIComponent(attempt)}/terminal`,
      mountTerminal: host => createTerminal(host, resolveTerminalTheme(terminalThemeName()), fontSize),
    });
    void ensureMonoFontLoaded(container, fontSize).then(() => {
      if (current()) this.terminal?.setFontSize(fontSize);
    }).catch(() => {});
    this.attach(false);
  }

  private attach(takeover: boolean): void {
    if (this.disposed || this.model.state.phase !== "ready" || this.model.state.attempt?.status !== "running" || this.terminalID === null) return;
    this.terminalMode = "connecting";
    this.terminalMessage = "Connecting to the sign-in terminal…";
    this.renderTerminal();
    this.terminal?.attach(this.terminalID, { takeover });
  }

  private renderTerminal(): void {
    if (this.disposed || this.root === null) return;
    const allowed = this.model.state.phase === "ready" && this.model.state.attempt?.status === "running";
    const message = this.root.querySelector<HTMLElement>("[data-github-terminal-status]")!;
    message.textContent = this.terminalMessage;
    message.hidden = this.terminalMessage === "";
    this.root.querySelector<HTMLButtonElement>("[data-github-reattach]")!.hidden = !allowed || this.terminalMode !== "reconnect";
    this.root.querySelector<HTMLButtonElement>("[data-github-takeover]")!.hidden = !allowed || this.terminalMode !== "takeover";
  }

  private disposeTerminal(): void {
    this.terminalID = null;
    this.terminal?.dispose();
    this.terminal = null;
    this.terminalMessage = "";
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.model.dispose();
    this.disposeTerminal();
    this.releaseFocus?.();
    this.root?.remove();
    this.root = null;
    if (this.opener?.isConnected) this.opener.focus({ preventScroll: true });
    this.options.onClosed?.();
  }
}

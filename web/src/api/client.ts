import { lastTerminalGeometry } from "../terminal/last-geometry.ts";

// The session API's browser client. Every call is a typed wrapper over
// the real endpoints; nothing here caches or
// reinterprets what the server returns — the server owns all state.
// ConsoleSettings mirrors internal/settings.Settings: operator choices
// the UI writes at runtime, as opposed to deployment configuration.
// Both fields name what they SKIP. PUT replaces the whole document, so
// an omitted field writes false, and false has to be the careful value.
export interface ConsoleSettings {
  skip_permissions: boolean;
  skip_close_confirm: boolean;
  skip_remove_project_confirm: boolean;
}

// SidebarLayout mirrors internal/settings.Layout: the operator's sidebar
// arrangement, stored as its own document so a Settings PUT cannot overwrite
// it. Stale ids from removed projects or sessions round-trip harmlessly.
export interface SidebarLayout {
  expanded: string[];
  projects: string[];
  sessions: Record<string, string[]>;
  // colors maps a project id to its operator color tag. Absent means no
  // tag; an empty map and a missing field read the same.
  colors?: Record<string, string>;
}

// TutorialPreference mirrors internal/settings.TutorialPreference: the
// operator-scoped record of tutorial presentation state — whether they
// closed it and where to resume. version is the contract version (this
// build speaks 1); a record read back with any other version is not
// rewritten, so the field stays a number rather than a literal. done lists
// finished lesson ids, the same ids the catalog ships.
export interface TutorialPreference {
  version: number;
  dismissed: boolean;
  lesson: string;
  step: number;
  done: string[];
}

// TutorialRecord is the GET/PUT /api/settings/tutorial answer: the stored
// document plus the server-derived scope it was read or written under.
// "installation" means an unauthenticated deployment's single shared
// record; the server ignores any client-supplied scope on write.
export interface TutorialRecord extends TutorialPreference {
  scope: "operator" | "installation";
}

export interface Project {
  id: string;
  name: string;
  canonical_path: string;
  git_author_name?: string;
  git_author_email?: string;
  git_identity_profile_id?: string;
  git_identity_profile_revision?: number;
  git_identity_setup_revision?: number;
  last_used_at: string;
}

export interface GitIdentityProfile {
  id: string;
  name: string;
  email: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface GitIdentityCatalog {
  profiles: GitIdentityProfile[];
  default_profile_id: string | null;
  revision: number;
}

// ReplacedGitIdentity names the repository-local git settings a write
// overwrote. The backend sends it only when a write actually replaced
// something, and only for values it read from the repository's own config —
// never from the operator's global git config.
export interface ReplacedGitIdentity {
  name?: string;
  email?: string;
  use_config_only?: string;
}

// ProjectWriteResult is a project as returned by a write that also sets the
// repository's git identity. It is a Project plus, when the write overwrote
// local git settings, what those settings were.
export interface ProjectWriteResult extends Project {
  replaced_git_identity?: ReplacedGitIdentity;
}

// Inspection is what the add-project field learns about what was typed,
// answered by the server from the filesystem inside the allowed roots and
// never from the network. kind decides the shape below the field.
export interface Inspection {
  kind: "absent" | "plain" | "repository" | "worktree" | "clone";
  path: string;
  exists: boolean;
  remote?: string;
  head?: string;
  parent?: ParentRepository;
  store_path?: string;
  entries: string[];
  clone_url?: string;
  same_clone?: boolean;
}

export interface ParentRepository {
  name: string;
  path: string;
}

// CloneJob is a clone in flight or at rest on the server: it outlives the
// dialog that started it, and a half-cloned directory is a state it holds.
export interface CloneJob {
  id: string;
  url: string;
  destination: string;
  name: string;
  status: "running" | "stopped" | "failed" | "done";
  failure?: "bad_or_private" | "auth" | "dest_not_empty" | "network";
  percent: number;
  line?: string;
  stderr?: string;
  partial_bytes: number;
  project_id?: string;
  started_at: string;
  updated_at: string;
}

export interface CloneStartRequest {
  githubAccount?: string;
  githubRepositoryID?: number;
  url: string;
  destination: string;
  name: string;
  profile: GitIdentityProfile | null;
}

export interface CreateProjectOptions {
  // plain registers the directory as it is, with no Git provisioning: a
  // directory that is not a repository, or one inside a repository whose
  // identity already governs it.
  plain?: boolean;
}

export interface ProjectGitIdentitySelection {
  profile_id: string;
  expected_profile_revision: number;
  expected_project_setup_revision: number;
}

export interface ProjectDirectoryEntry {
  name: string;
  path: string;
}

export interface ProjectDirectoryListing {
  current_path: string;
  parent_path: string | null;
  directories: ProjectDirectoryEntry[];
}

export interface SessionSummary {
  id: string;
  project_id: string;
  provider: string;
  codex_login_helper?: boolean;
  // display_name is the operator's own label; empty renders the
  // provider. Metadata, never identity.
  display_name: string;
  status: string;
  generation: number;
  created_at: string;
  // updated_at is the reconciled record's last-write time. The server
  // stamps it on state and input transitions; it is NOT output freshness
  // and must not be rendered as a last-output fact.
  updated_at: string;
  // last_output_at is the session's last pty-output time. It remains optional
  // API metadata; reconciliation chrome does not reinterpret it as state.
  last_output_at?: string;
  color?: string | null;
  // These content-free backend facts describe the durable automatic successor
  // path. The browser never derives them from provider, status, native
  // identity, or terminal output.
  recovery_capability: "resume" | "relaunch" | "none";
  recovery_state: "unavailable" | "automatic_pending" | "recovering";
  // resume_ended: the last generation resumed the recorded conversation and
  // ended on its own with a failure; the record is kept for the operator's
  // explicit choice between resuming again and a fresh session.
  presentation_state: "running" | "recovering" | "attachment_unavailable" | "ended" | "inactive" | "resume_ended";
}

// TaskmasterInfo is the detected project structure. A 404 with code
// not_taskmaster_project is a STATE (the project is not a Taskmaster
// project), surfaced through ApiError for the caller to classify.
// TaskmasterInitResult reports the store the project bound to. The path is
// echoed because a worktree binds to its repository family's store, which
// does not sit under the project boundary.
export interface TaskmasterInitResult {
  path: string;
  tag: string;
  already_initialized: boolean;
}

export interface TaskmasterInfo {
  path: string;
  config_path: string;
  tasks_path: string;
  docs_path: string;
}

// TmTask mirrors the Tasks JSON response. id/parentId/dependencies stay
// unknown-typed so a field shape this product does not read cannot break the
// parse.
export interface TmTask {
  id: unknown;
  parentId?: unknown;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  dependencies?: unknown[];
  details?: string;
  subtasks?: TmTask[];
  // Optional precomputed subtask progress. Real taskmaster data carries
  // subtasks (flattened into the columns); the fixture supplies counts so
  // the progress bar renders without phantom cards.
  subtasks_done?: number;
  subtasks_total?: number;
  updatedAt?: string;
  revision?: number;
  claim?: {
    owner: string;
    acquiredAt: string;
    expiresAt: string;
  };
}

// TaskmasterTasks is the engine response keyed by tag, exactly as served.
export type TaskmasterTasks = Record<string, { tasks: TmTask[] }>;

// The chat ledger (ADR-0009, handoff §23): what the console knows about
// the chats a session's agent is in, as `a2a ledger` exports it. One
// delivery state per recipient; the browser folds them, never the server.
export type ChatDeliveryState = "sent" | "delivered" | "uncertain" | "read";
export type ChatState = "invited" | "waiting" | "open" | "closing" | "closed" | "left" | "declined" | "forced";
export type ChatRowKind = "message" | "added" | "left" | "declined";

export interface ChatRow {
  id: string;
  // tag is the six-hex id the recipient sees in its terminal: a2a#3ff6ae.
  tag: string;
  kind: ChatRowKind;
  from: string;
  member: string | null;
  text: string;
  at: string;
  to: Record<string, ChatDeliveryState>;
}

export interface ChatHandshake {
  member: string;
  agreed: boolean;
  at: string | null;
  left: boolean;
  left_at: string | null;
}

export interface Chat {
  id: string;
  state: ChatState;
  waiting_s: number | null;
  forced: boolean;
  opened_by: string | null;
  opened_at: string | null;
  last: string | null;
  // The selected agent's departure time; last still describes the whole chat.
  participation_at?: string | null;
  members: string[];
  // The harness each member runs on, as its presence says; the tile
  // colours by this, never by the shape of the handle.
  harnesses?: Record<string, string>;
  left: string[];
  remaining: string[];
  close_requested_by: string | null;
  // Who ended the chat: the opener, the proposer who forced it, or the
  // member whose agreement completed the quorum. Null while the chat is
  // live, and null for a chat that ended on a departure: fewer than two
  // members remained, or everyone remaining had already agreed and the
  // departure was what completed the quorum. Nobody ended those.
  closed_by: string | null;
  // Optional for older servers; absence is not evidence of a close cause.
  close_cause?: "opener" | "quorum" | "departure" | "forced" | "declined" | null;
  messages: number;
  rows: ChatRow[];
  handshake: ChatHandshake[];
}

export interface ChatLedger {
  agent: string;
  chats: Chat[];
}

// ChatIndexEntry is the content-free index of every chat on the palace:
// enough to mark a sidebar row, never a body.
export interface ChatIndexEntry {
  id: string;
  state: ChatState;
  members: string[];
  left: string[];
  last: string | null;
  last_row: string | null;
  rows: number;
}

export interface ChatIndex {
  chats: ChatIndexEntry[];
  // sessions maps a Deck session id to the effective handle presence
  // resolved for its agent — the same identity the per-session ledger is
  // read for. Absent from an older server; the caller derives the default.
  sessions?: Record<string, string>;
}

// TmRun is one generation job record.
export interface TmRun {
  id: string;
  project_id: string;
  argv: string[];
  prd: string | null;
  status: string;
  exit_code: number | null;
  stdout?: string;
  stderr?: string;
  started_at: string;
  finished_at?: string;
  duration_ms?: number;
}

export interface AddTaskInput {
  title: string;
  description: string;
  details: string;
  priority: "high" | "medium" | "low";
}

export interface AddTaskResult {
  id: string;
}

// FileEntry is one item in a project directory listing. Path is always
// project-relative and slash-separated: the server never discloses the
// absolute layout above the project root.
export interface FileEntry {
  name: string;
  path: string;
  dir: boolean;
  // size is omitted for a zero-byte entry (Go omitempty), so a reader
  // must treat its absence as zero rather than as unknown.
  size?: number;
  mode: string;
  mtime: string;
  // change is set when git reports the entry differs from the last commit
  // (a directory: when something inside it does). Absent means unchanged,
  // or that git could not say.
  change?: "modified" | "new";
}

// FileListing is one directory inside a project. parent is absent at the
// root; truncated reports that the directory held more entries than the
// server will list — a short list must never be rendered as a complete
// one.
export interface FileListing {
  path: string;
  parent?: string;
  at_root: boolean;
  entries: FileEntry[];
  truncated?: boolean;
}

// FileView is the text viewer's payload. The server decodes and validates
// UTF-8; a file it refuses (415 not_text) has no text answer at all.
export interface FileView {
  content: string;
}

// FileUploadResult is what POST /files stored: the project-relative path
// after the server's own normalization, and the byte count it wrote.
export interface FileUploadResult {
  path: string;
  size: number;
}

// UploadConflictReason is why the server refused to place an upload: the
// name is taken ("exists"), what took it changed since a replacement was
// approved ("changed"), or it is held by something no upload may ever
// replace — a folder ("directory") or a non-regular file such as a link
// ("not_a_file").
export const UPLOAD_CONFLICT_REASONS = ["exists", "changed", "directory", "not_a_file"] as const;
export type UploadConflictReason = typeof UPLOAD_CONFLICT_REASONS[number];

// UploadConflictInfo is the ask inside the upload endpoint's 409: what
// holds the destination name, as the server observed it at the moment of
// refusal. The version is opaque; returning it as consent is what
// approves replacing the file it names.
export interface UploadConflictInfo {
  reason: UploadConflictReason;
  message: string;
  existing: {
    name: string;
    dir: boolean;
    size: number;
    mtime: string;
    version: string;
  };
}

// UploadConsent is the operator's Replace answer made specific: the
// version carried by the conflict that asked. The server recomputes the
// destination's version after staging and re-asks when it differs, so a
// target that changed after the approval is never silently overwritten.
export interface UploadConsent {
  version: string;
}

// UploadTransportOptions is the measured-upload surface: an AbortSignal
// for operator cancellation, and the two upload-side observations a
// progress UI needs. onProgress counts bytes the browser itself measured
// handing to the socket; onSent says the last byte left the browser.
// Neither is completion — only the server's response says the file was
// placed, so a caller must keep treating the upload as unconfirmed
// between onSent and the promise settling.
export interface UploadTransportOptions {
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
  onSent?: () => void;
}

// SessionDetail is the reconciled session record as served: the status
// is reconciliation-derived, never inferred client-side. Only
// fields used by the active terminal surface are typed.
export interface SessionDetail {
  id: string;
  project_id: string;
  provider: string;
  display_name: string;
  color?: string | null;
  status: string;
  generation: number;
  tmux_pane_id?: string;
  pane_pid?: number;
  exit_code?: number;
  exit_signal?: string;
  exited_at?: string;
  native_session_id?: string;
  // resume_attempts is the consumed automatic-recovery opportunity:
  // zero is open, one is durably spent. Server-presented, like the recovery
  // facts below; never inferred.
  resume_attempts?: number;
  // Seam for the replayed and failed register presentations: a
  // presentation derives from them ONLY when the server presents them
  // (the authority invariant); absent today.
  replayed?: { generation: number; native_id: string };
  failure?: {
    attempt_budget: number;
    recording_bytes: number;
    queued: number;
    resent: number;
    panic: string;
  };
  created_at: string;
  updated_at: string;
  recovery_capability: SessionSummary["recovery_capability"];
  recovery_state: SessionSummary["recovery_state"];
  presentation_state: SessionSummary["presentation_state"];
  // recovery_refusal accompanies resume_ended: "provider" when the resumed
  // process ended without continuing the conversation, "store_gone" when
  // the store it was recorded in no longer exists so nothing was launched.
  recovery_refusal?: "provider" | "store_gone";
}

// RecoveryOutcome names what an operator recover actually did: "resumed"
// continued the recorded conversation; "relaunched" started a fresh one in a
// session record that had no conversation to resume — no earlier thread
// came back, and the UI must never imply one did.
export type RecoveryOutcome = "resumed" | "relaunched";

// RecoverResult is the recover response: the revived session plus the
// outcome field.
export interface RecoverResult extends SessionDetail {
  outcome: RecoveryOutcome;
}

// ConnectionState is the browser's own attachment state for the session
// — the one state the browser DOES own (its WebSocket), supplied by the
// terminal attachment.
export type ConnectionState = "connected" | "connecting" | "disconnected";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  // conflict is the upload endpoint's 409 ask when the refusal is one:
  // what holds the destination name, and the version whose return as
  // consent approves replacing it. Null on every other error, including
  // a 409 from anywhere else.
  readonly conflict: UploadConflictInfo | null;

  // NOTE: no TS parameter properties — the node test runner strips types
  // only and cannot compile them.
  constructor(status: number, code: string, message: string, conflict: UploadConflictInfo | null = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.conflict = conflict;
  }
}

export type AuthMode = "none" | "password" | "oidc" | "builtin" | "trusted_proxy";

export async function loginWithPassword(password: string): Promise<void> {
  await readJSON<void>(await fetch("/auth/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    cache: "no-store",
    body: JSON.stringify({ password }),
  }));
}

// Password and OIDC login issue a readable, session-bound CSRF cookie alongside
// the HttpOnly session cookie. State-changing requests reflect that value in
// the header the backend verifies. Trusted-proxy deployments simply have no
// such cookie, so the header is omitted there.
export function csrfToken(cookie: string): string | null {
  const names = new Set(["__Host-noisedeck_csrf", "noisedeck_csrf"]);
  const values = new Map<string, string>();
  for (const part of cookie.split(";")) {
    const item = part.trim();
    const eq = item.indexOf("=");
    if (eq < 1 || !names.has(item.slice(0, eq))) {
      continue;
    }
    values.set(item.slice(0, eq), item.slice(eq + 1));
  }
  const encoded = values.get("__Host-noisedeck_csrf") ?? values.get("noisedeck_csrf");
  if (encoded === undefined) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

// ApiClient is the interface the sidebar consumes; HttpApiClient is the
// production implementation, tests substitute a fake.
// One harness's recorded launch history, as GET /api/harness-usage reports
// it: how many sessions were ever started on it and when the last one was.
// Removed rows are excluded server-side; ended and interrupted ones count,
// because they were launches the operator made.
export interface HarnessUsage {
  provider: string;
  launches: number;
  last_used_at: string;
}

// Both scopes in one answer: the whole installation, and the project the
// picker was opened in. The project scope is empty when no project was
// named or when nothing has been launched there.
export interface HarnessUsageReport {
  global: readonly HarnessUsage[];
  project: readonly HarnessUsage[];
}

// ProjectPreviewEntry is the Open preview answer: the exact entry
// URL the one-use ticket must be POSTed to, and the ticket itself. The
// URL is submitted as a form body, never as a URL parameter, so nothing
// here is safe to log or embed.
export interface ProjectPreviewEntry {
  url: string;
  ticket: string;
}

export interface ProjectPreviewSettings {
  configured: boolean;
  self_service: boolean;
  enabled: boolean;
  source?: "managed" | "static";
  origin?: string;
  port?: number;
  upstream?: string;
}

export interface ProjectPreviewCheck {
  reachable: boolean;
  checked_at: string;
}

export interface ApiClient {
  logout(): Promise<void>;
  getSettings(): Promise<ConsoleSettings>;
  saveSettings(next: ConsoleSettings): Promise<ConsoleSettings>;
  getLayout(): Promise<SidebarLayout | null>;
  saveLayout(next: SidebarLayout): Promise<SidebarLayout>;
  // The session the operator last opened, remembered on the server so a
  // browser on another device opens the same one. Null when nothing is
  // remembered; saving null forgets it.
  getLastSession(): Promise<string | null>;
  saveLastSession(id: string | null): Promise<void>;
  // The tutorial preference read: null when no record was ever written —
  // the UI's first-use signal. A stored record whose version this build
  // does not speak is served as read, so the caller can preserve it.
  getTutorial(signal?: AbortSignal): Promise<TutorialRecord | null>;
  saveTutorial(next: TutorialPreference, signal?: AbortSignal): Promise<TutorialRecord>;
  listProjects(): Promise<Project[]>;
  listProviders(): Promise<readonly string[]>;
  getHarnessUsage(projectID?: string): Promise<HarnessUsageReport>;
  listGitIdentities(): Promise<GitIdentityCatalog>;
  createGitIdentity(name: string, email: string): Promise<GitIdentityProfile>;
  updateGitIdentity(profileID: string, expectedRevision: number, name: string, email: string): Promise<GitIdentityProfile>;
  setDefaultGitIdentity(profileID: string, expectedCatalogRevision: number, expectedProfileRevision: number): Promise<GitIdentityCatalog>;
  deleteGitIdentity(profileID: string, expectedRevision: number, catalogRevision: number, replacement?: GitIdentityProfile): Promise<void>;
  listProjectDirectories(path?: string): Promise<ProjectDirectoryListing>;
  createProjectDirectory(path: string, name: string): Promise<{ path: string }>;
  createProject(name: string, path: string, profile: GitIdentityProfile | null, options?: CreateProjectOptions): Promise<ProjectWriteResult>;
  inspectProject(input: string, base?: string): Promise<Inspection>;
  startClone(request: CloneStartRequest): Promise<CloneJob>;
  listClones(): Promise<CloneJob[]>;
  getClone(id: string): Promise<CloneJob>;
  cancelClone(id: string): Promise<CloneJob>;
  resumeClone(id: string): Promise<CloneJob>;
  discardClone(id: string): Promise<void>;
  setProjectGitIdentity(projectID: string, selection: ProjectGitIdentitySelection): Promise<ProjectWriteResult>;
  deleteProject(projectID: string): Promise<void>;
  renameProject(projectID: string, name: string): Promise<void>;
  listSessions(projectID: string): Promise<SessionSummary[]>;
  createSession(projectID: string, provider: string): Promise<SessionSummary>;
  // recoverSession is the operator's explicit retry (POST recover): the
  // same row revives in place and the result's outcome names what
  // committed — "resumed", or "relaunched" for a row that recorded no
  // conversation to resume. A resume the provider does not continue is a
  // 409 carrying the server's specific refusal sentence; nothing is
  // relaunched in its place.
  recoverSession(sessionID: string): Promise<RecoverResult>;
  // sessionScreen is the last screen of a session's retained dead pane, as
  // bytes to show above the recovery card: the provider's own words about
  // why it stopped. Nothing derives state from it. Resolves null when no
  // screen is retained.
  sessionScreen(sessionID: string): Promise<string | null>;
  getTaskmasterInfo(projectID: string): Promise<TaskmasterInfo>;
  initializeTaskmaster(projectID: string): Promise<TaskmasterInitResult>;
  listTaskmasterTasks(projectID: string): Promise<TaskmasterTasks>;
  getTaskmasterTask(projectID: string, taskID: string): Promise<TmTask>;
  addTaskmasterTask(projectID: string, input: AddTaskInput): Promise<AddTaskResult>;
  listTaskmasterPRDs(projectID: string): Promise<string[]>;
  generateTasks(projectID: string, prd: string): Promise<TmRun>;
  uploadPrd(projectID: string, name: string, content: string, replace: boolean): Promise<void>;
  listTaskmasterRuns(projectID: string): Promise<TmRun[]>;
  // The chat ledger read path (ADR-0009). A 404 with code no_agent_handle
  // is a STATE: the session's harness has no chat handle.
  getSessionChats(sessionID: string): Promise<ChatLedger>;
  listChats(): Promise<ChatIndex>;
  getTaskmasterRun(projectID: string, runID: string): Promise<TmRun>;
  getSession(sessionID: string): Promise<SessionDetail>;
  deleteSession(sessionID: string): Promise<void>;
  renameSession(sessionID: string, name: string): Promise<void>;
  // The project app preview entry: a one-use ticket and the exact
  // URL to submit it to. Optional so fixture clients that never serve a
  // preview do not grow a method; HttpApiClient always implements it and
  // the caller treats its absence as "not configured".
  projectPreview?(projectID: string): Promise<ProjectPreviewEntry>;
  getProjectPreviewSettings?(projectID: string): Promise<ProjectPreviewSettings>;
  enableProjectPreview?(projectID: string): Promise<ProjectPreviewSettings>;
  disableProjectPreview?(projectID: string): Promise<ProjectPreviewSettings>;
  checkProjectPreview?(projectID: string): Promise<ProjectPreviewCheck>;
  setSessionColor(sessionID: string, color: string | null): Promise<void>;
}

// FileApiClient is the per-project file surface, kept separate from
// ApiClient so a fake standing in for the session API does not have to
// grow four methods it never calls. HttpApiClient satisfies both.
export interface FileApiClient {
  listProjectFiles(projectID: string, path: string): Promise<FileListing>;
  viewProjectFile(projectID: string, path: string): Promise<FileView>;
  subscribeProjectFileEvents(projectID: string, path: string, onChange: () => void): () => void;
  projectFileDownloadUrl(projectID: string, path: string): string;
  uploadProjectFile(projectID: string, destPath: string, body: Blob, consent?: UploadConsent, options?: UploadTransportOptions): Promise<FileUploadResult>;
}

// decodeUploadFailure turns an upload endpoint failure into the ApiError
// both transports reject with. A 409 is the collision question: the
// conflict envelope becomes the ask any Replace consent must quote,
// while a 409 answering with anything else stays the opaque error it
// arrived as — never an inferred ask. Every other status decodes through
// the two envelopes readJSON knows, so an error reads identically
// whichever transport carried it. body is the already-parsed JSON value
// (null when the body was not JSON).
function decodeUploadFailure(status: number, statusText: string, body: unknown): ApiError {
  const envelope = (body ?? {}) as {
    error?: unknown;
    // A flat top-level code is how the control-plane refusals answer
    // ({"code":"unlock-required"}); surfacing it keeps the upload's
    // ApiError saying what the authorization-loss read keyed on.
    code?: unknown;
    message?: unknown;
    reason?: unknown;
    existing?: { name?: unknown; dir?: unknown; size?: unknown; mtime?: unknown; version?: unknown };
  };
  if (status === 409) {
    let code = "unknown";
    let message = statusText;
    let conflict: UploadConflictInfo | null = null;
    if (envelope.error === "conflict") {
      code = "conflict";
      message = typeof envelope.message === "string" ? envelope.message : message;
      const e = envelope.existing;
      const reason = envelope.reason;
      // A reason the client does not know is not an ask: guessing
      // "exists" would hand the dialog a Replace button for a refusal it
      // did not understand, so the error stays plain and fails closed.
      if (e !== undefined && e !== null && typeof e.name === "string" && typeof e.version === "string" && e.version !== ""
          && typeof reason === "string" && (UPLOAD_CONFLICT_REASONS as readonly string[]).includes(reason)) {
        conflict = {
          reason: reason as UploadConflictReason,
          message,
          existing: {
            name: e.name,
            dir: e.dir === true,
            size: typeof e.size === "number" ? e.size : 0,
            mtime: typeof e.mtime === "string" ? e.mtime : "",
            version: e.version,
          },
        };
      }
    }
    return new ApiError(status, code, message, conflict);
  }
  let code = "unknown";
  let message = statusText;
  if (typeof envelope.error === "string") {
    code = envelope.error;
    message = typeof envelope.message === "string" ? envelope.message : message;
  } else if (envelope.error !== null && typeof envelope.error === "object") {
    const nested = envelope.error as { code?: unknown; message?: unknown };
    code = typeof nested.code === "string" ? nested.code : code;
    message = typeof nested.message === "string" ? nested.message : message;
  } else if (typeof envelope.code === "string") {
    code = envelope.code;
  }
  return new ApiError(status, code, message);
}

// uploadConflictError adapts the fetch path's Response to the shared
// failure decoder. A body that is not the conflict envelope falls back to
// the plain error shape rather than inventing an ask the server never
// made.
async function uploadConflictError(resp: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = JSON.parse(await resp.text());
  } catch {
    // a non-JSON conflict body is still an error, just an opaque one
  }
  return decodeUploadFailure(resp.status, resp.statusText, body);
}

// uploadRequestPath builds the upload endpoint's request path: the
// project id and the project-relative destination encoded separately,
// the consent as the query the server's collision check reads. One
// builder serves both transports so their requests cannot drift apart.
function uploadRequestPath(projectID: string, destPath: string, consent?: UploadConsent): string {
  const consentQuery = consent === undefined
    ? ""
    : `&replace=1&expected_version=${encodeURIComponent(consent.version)}`;
  return `/api/projects/${encodeURIComponent(projectID)}/files?path=${encodeURIComponent(destPath)}${consentQuery}`;
}

// abortError is the rejection an operator cancellation produces: named
// like the DOMException fetch rejects with when its signal fires, and
// deliberately not an ApiError — an aborted request has no server answer,
// so nothing downstream may read the outcome as one.
function abortError(): Error {
  const error = new Error("upload aborted before the server answered");
  error.name = "AbortError";
  return error;
}

async function readJSON<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    let code = "unknown";
    let message = resp.statusText;
    try {
      // The backend has two envelopes: flat {error: code, message} and
      // nested {error: {code, message}}. Both decode to the same ApiError —
      // the caller never sees the difference.
      const body = (await resp.json()) as {
        error?: string | { code?: string; message?: string };
        message?: string;
      };
      if (typeof body.error === "string") {
        code = body.error;
        message = body.message ?? message;
      } else if (body.error !== null && typeof body.error === "object") {
        code = body.error.code ?? code;
        message = body.error.message ?? message;
      }
    } catch {
      // a non-JSON error body is still an error, just an opaque one
    }
    throw new ApiError(resp.status, code, message);
  }
  // 204 No Content is a success with no body — parsing one as JSON would
  // turn a successful call into a thrown SyntaxError.
  if (resp.status === 204) {
    return undefined as T;
  }
  return (await resp.json()) as T;
}

// The 403 bodies that mean the browser lost its authorization rather
// than that the endpoint refused: the codes the control plane answers
// with while a re-authentication ceremony is pending. Both transports
// read the same list, and the Files model reads it too, so all three
// agree on what "authorization lost" means.
export const AUTHORIZATION_LOSS_CODES: readonly string[] = [
  "unlock-required", "authorization-required", "browser-grant-required",
];

export async function fetchWithAuthorization(input: RequestInfo | URL, init?: RequestInit, onAuthorizationLost?: () => void): Promise<Response> {
  const response = await fetch(input, init);
  if (onAuthorizationLost && response.status === 401) onAuthorizationLost();
  else if (onAuthorizationLost && response.status === 403) {
    let code: unknown;
    try { code = (await response.clone().json())?.code; }
    catch { return response; }
    if (typeof code === "string" && AUTHORIZATION_LOSS_CODES.includes(code)) onAuthorizationLost();
  }
  return response;
}

export class HttpApiClient implements ApiClient, FileApiClient {
  private cookie: () => string;
  workspaceSecurity: "v1" | null = null;
  onAuthorizationLost?: () => void;

  private request(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return fetchWithAuthorization(input, init, this.onAuthorizationLost);
  }

  constructor(cookie: () => string = () =>
    typeof document === "undefined" ? "" : document.cookie) {
    this.cookie = cookie;
  }

  private mutationHeaders(json = false): Headers {
    const headers = new Headers();
    if (json) {
      headers.set("Content-Type", "application/json");
    }
    const token = csrfToken(this.cookie());
    if (token !== null) {
      headers.set("X-CSRF-Token", token);
    }
    return headers;
  }

  private get(path: string, signal?: AbortSignal): Promise<Response> {
    // Session/process/outbox reads are live control-plane facts. Never let an
    // HTTP cache replay an earlier reconciliation result or authenticated
    // response after logout.
    return this.request(path, { credentials: "same-origin", cache: "no-store", signal });
  }

  subscribeProjectFileEvents(projectID: string, path: string, onChange: () => void): () => void {
    const events = new EventSource(`/api/projects/${encodeURIComponent(projectID)}/files/events?path=${encodeURIComponent(path)}`);
    events.addEventListener("files-changed", onChange);
    // The stream only reports what it observes while connected, and the
    // server baselines a fresh connection from the directory as it is now.
    // Anything that changed during a dropped connection is therefore already
    // folded into that baseline and will never arrive as an event, so a
    // reopen is itself a change: re-read once. The browser's own reconnect
    // fires this without any gesture from the caller.
    let connected = false;
    events.addEventListener("open", () => {
      if (connected) onChange();
      connected = true;
    });
    return () => events.close();
  }

  async requireSession(): Promise<AuthMode> {
    const response = await this.get("/auth/session");
    const mode = response.headers.get("X-Noisedeck-Auth-Mode");
    const security = response.headers.get("X-Deck-Workspace-Security");
    if (security !== null && security !== "v1") throw new ApiError(response.status, "unknown_security_protocol", "server identified an unsupported workspace security protocol");
    this.workspaceSecurity = security;
    if (mode !== "none" && mode !== "password" && mode !== "oidc" &&
        mode !== "builtin" && mode !== "trusted_proxy") {
      throw new ApiError(response.status, "unknown_auth_mode", "server did not identify its authentication mode");
    }
    try {
      await readJSON<void>(response);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        throw new ApiError(cause.status, `unauthorized_${mode}`, cause.message);
      }
      throw cause;
    }
    return mode;
  }

  // Console settings are read fresh whenever the menu opens: the
  // backend is the authority, and a cached copy would let the UI show a
  // permission-skipping state the next launch does not actually use.
  async getSettings(): Promise<ConsoleSettings> {
    return await readJSON<ConsoleSettings>(await this.get("/api/settings"));
  }

  async saveSettings(next: ConsoleSettings): Promise<ConsoleSettings> {
    return await readJSON<ConsoleSettings>(
      await this.request("/api/settings", {
        method: "PUT",
        headers: this.mutationHeaders(true),
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify(next),
      }),
    );
  }

  async getLayout(): Promise<SidebarLayout | null> {
    const resp = await this.get("/api/settings/layout");
    // A 404 means the operator has never saved a layout: the sidebar keeps
    // its default expansion rather than treating a missing row as an explicit
    // all-collapsed state.
    if (resp.status === 404) {
      return null;
    }
    return await readJSON<SidebarLayout>(resp);
  }

  async saveLayout(next: SidebarLayout): Promise<SidebarLayout> {
    return await readJSON<SidebarLayout>(
      await this.request("/api/settings/layout", {
        method: "PUT",
        headers: this.mutationHeaders(true),
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify(next),
      }),
    );
  }

  async getLastSession(): Promise<string | null> {
    const resp = await this.get("/api/settings/last-session");
    if (resp.status === 404) return null;
    const doc = await readJSON<{ session_id: string }>(resp);
    return doc.session_id === "" ? null : doc.session_id;
  }

  async saveLastSession(id: string | null): Promise<void> {
    await this.request("/api/settings/last-session", {
      method: "PUT",
      headers: this.mutationHeaders(true),
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({ session_id: id ?? "" }),
    });
  }

  async getTutorial(signal?: AbortSignal): Promise<TutorialRecord | null> {
    const resp = await this.get("/api/settings/tutorial", signal);
    // A 404 means no record was ever written: the tutorial's first-use
    // behavior, not an error.
    if (resp.status === 404) {
      return null;
    }
    return await readJSON<TutorialRecord>(resp);
  }

  async saveTutorial(next: TutorialPreference, signal?: AbortSignal): Promise<TutorialRecord> {
    return await readJSON<TutorialRecord>(
      await this.request("/api/settings/tutorial", {
        method: "PUT",
        headers: this.mutationHeaders(true),
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify(next),
        signal,
      }),
    );
  }

  async logout(): Promise<void> {
    await readJSON<void>(
      await this.request("/auth/logout", {
        method: "POST",
        headers: this.mutationHeaders(),
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
  }

  async listProjects(): Promise<Project[]> {
    // Go's encoding/json represents a nil slice as null. Treat that one
    // server-produced empty-list shape as empty so a fresh database can reach
    // onboarding; do not let null leak into the sidebar's array contract.
    return (await readJSON<Project[] | null>(await this.get("/api/projects"))) ?? [];
  }

  // The harnesses this image can launch. Deck ships in more than one image
  // from one bundle, so the picker cannot know them from the code it was
  // served — only the process that resolved the executables knows.
  async listProviders(): Promise<readonly string[]> {
    const body = await readJSON<{ providers?: readonly string[] | null }>(
      await this.get("/api/providers"));
    return body.providers ?? [];
  }

  // Recorded launches per harness, for ranking the picker. Both scopes come
  // back in one response; a project with no history is an empty list, not an
  // error. Go's encoding/json can render an empty slice as null, so each
  // scope is defaulted rather than trusted to be an array.
  async getHarnessUsage(projectID?: string): Promise<HarnessUsageReport> {
    const query = projectID === undefined || projectID === ""
      ? ""
      : `?project=${encodeURIComponent(projectID)}`;
    const body = await readJSON<{
      global?: readonly HarnessUsage[] | null;
      project?: readonly HarnessUsage[] | null;
    }>(await this.get(`/api/harness-usage${query}`));
    return { global: body.global ?? [], project: body.project ?? [] };
  }

  async listGitIdentities(): Promise<GitIdentityCatalog> {
    return readJSON<GitIdentityCatalog>(await this.get("/api/git-identities"));
  }

  async createGitIdentity(name: string, email: string): Promise<GitIdentityProfile> {
    return readJSON<GitIdentityProfile>(await this.request("/api/git-identities", {
      method: "POST", headers: this.mutationHeaders(true), credentials: "same-origin",
      cache: "no-store", body: JSON.stringify({ name, email }),
    }));
  }

  async updateGitIdentity(profileID: string, expectedRevision: number, name: string, email: string): Promise<GitIdentityProfile> {
    return readJSON<GitIdentityProfile>(await this.request(`/api/git-identities/${encodeURIComponent(profileID)}`, {
      method: "PUT", headers: this.mutationHeaders(true), credentials: "same-origin",
      cache: "no-store", body: JSON.stringify({ name, email, expected_revision: expectedRevision }),
    }));
  }

  async setDefaultGitIdentity(profileID: string, expectedCatalogRevision: number, expectedProfileRevision: number): Promise<GitIdentityCatalog> {
    return readJSON<GitIdentityCatalog>(await this.request("/api/git-identities/default", {
      method: "PUT", headers: this.mutationHeaders(true), credentials: "same-origin",
      cache: "no-store", body: JSON.stringify({
        profile_id: profileID,
        expected_revision: expectedCatalogRevision,
        expected_profile_revision: expectedProfileRevision,
      }),
    }));
  }

  async deleteGitIdentity(profileID: string, expectedRevision: number, catalogRevision: number, replacement?: GitIdentityProfile): Promise<void> {
    await readJSON<void>(await this.request(`/api/git-identities/${encodeURIComponent(profileID)}`, {
      method: "DELETE", headers: this.mutationHeaders(true), credentials: "same-origin",
      cache: "no-store", body: JSON.stringify({
        expected_revision: expectedRevision,
        catalog_revision: catalogRevision,
        replacement_default_id: replacement?.id ?? "",
        expected_replacement_revision: replacement?.revision ?? 0,
      }),
    }));
  }

  async listProjectDirectories(path?: string): Promise<ProjectDirectoryListing> {
    const query = path === undefined ? "" : `?path=${encodeURIComponent(path)}`;
    return readJSON<ProjectDirectoryListing>(
      await this.get(`/api/project-directories${query}`),
    );
  }

  async createProjectDirectory(path: string, name: string): Promise<{ path: string }> {
    return readJSON<{ path: string }>(
      await this.request("/api/project-directories/mkdir", {
        method: "POST",
        headers: this.mutationHeaders(true),
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ path, name }),
      }),
    );
  }

  async createProject(name: string, path: string, profile: GitIdentityProfile | null, options: CreateProjectOptions = {}): Promise<ProjectWriteResult> {
    return readJSON<ProjectWriteResult>(
      await this.request("/api/projects", {
        method: "POST",
        headers: this.mutationHeaders(true),
        body: JSON.stringify({
          name,
          path,
          plain: options.plain === true,
          ...(profile === null ? {} : {
            git_identity_profile_id: profile.id,
            expected_git_identity_revision: profile.revision,
          }),
        }),
      }),
    );
  }

  async inspectProject(input: string, base = ""): Promise<Inspection> {
    const query = new URLSearchParams({ input });
    if (base !== "") query.set("base", base);
    return readJSON<Inspection>(await this.get(`/api/projects/inspect?${query.toString()}`));
  }

  async startClone(request: CloneStartRequest): Promise<CloneJob> {
    return readJSON<CloneJob>(
      await this.request("/api/projects/clone", {
        method: "POST",
        headers: this.mutationHeaders(true),
        credentials: "same-origin",
        body: JSON.stringify({
          url: request.url,
          ...(request.githubAccount === undefined ? {} : { github_account: request.githubAccount, github_repository_id: request.githubRepositoryID }),
          destination: request.destination,
          name: request.name,
          ...(request.profile === null ? {} : {
            git_identity_profile_id: request.profile.id,
            expected_git_identity_revision: request.profile.revision,
          }),
        }),
      }),
    );
  }

  async listClones(): Promise<CloneJob[]> {
    return readJSON<CloneJob[]>(await this.get("/api/project-clones"));
  }

  async getClone(id: string): Promise<CloneJob> {
    return readJSON<CloneJob>(await this.get(`/api/project-clones/${encodeURIComponent(id)}`));
  }

  async cancelClone(id: string): Promise<CloneJob> {
    return readJSON<CloneJob>(await this.request(`/api/project-clones/${encodeURIComponent(id)}/cancel`, {
      method: "POST", headers: this.mutationHeaders(), credentials: "same-origin",
    }));
  }

  async resumeClone(id: string): Promise<CloneJob> {
    return readJSON<CloneJob>(await this.request(`/api/project-clones/${encodeURIComponent(id)}/resume`, {
      method: "POST", headers: this.mutationHeaders(), credentials: "same-origin",
    }));
  }

  async discardClone(id: string): Promise<void> {
    const resp = await this.request(`/api/project-clones/${encodeURIComponent(id)}`, {
      method: "DELETE", headers: this.mutationHeaders(), credentials: "same-origin",
    });
    if (!resp.ok) await readJSON<never>(resp);
  }

  async setProjectGitIdentity(projectID: string, selection: ProjectGitIdentitySelection): Promise<ProjectWriteResult> {
    return readJSON<ProjectWriteResult>(await this.request(`/api/projects/${encodeURIComponent(projectID)}/git-identity`, {
      method: "PUT", headers: this.mutationHeaders(true), credentials: "same-origin",
      cache: "no-store", body: JSON.stringify({
        profile_id: selection.profile_id,
        expected_profile_revision: selection.expected_profile_revision,
        expected_project_setup_revision: selection.expected_project_setup_revision,
      }),
    }));
  }

  // deleteProject unregisters a project from the console. The backend
  // is the authority on what that means: a soft removal that never
  // touches the directory on disk and stops the project's live
  // sessions first; 409 when a session cannot be stopped
  // (session_stop_failed) or launches concurrently (live_sessions).
  async deleteProject(projectID: string): Promise<void> {
    await readJSON<void>(
      await this.request(`/api/projects/${encodeURIComponent(projectID)}`, {
        method: "DELETE",
        headers: this.mutationHeaders(),
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
  }

  // renameProject records the operator's display name for a project,
  // mirroring renameSession. Display metadata only: the registered
  // path and the directory on disk never change. An empty name resets to
  // the directory basename.
  async renameProject(projectID: string, name: string): Promise<void> {
    await readJSON<void>(
      await this.request(`/api/projects/${encodeURIComponent(projectID)}/rename`, {
        method: "POST",
        headers: this.mutationHeaders(true),
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ name }),
      }),
    );
  }

  // projectPreview requests entry to a project's registered app preview.
  // A CSRF-protected POST with no body: the backend verifies the project
  // and answers the entry URL plus its one-use ticket, or a 404 whose
  // message says previews are not configured for the project — the same
  // sentence the UI shows when it cannot ask at all.
  async projectPreview(projectID: string): Promise<ProjectPreviewEntry> {
    return readJSON<ProjectPreviewEntry>(
      await this.request(`/api/projects/${encodeURIComponent(projectID)}/preview`, {
        method: "POST",
        headers: this.mutationHeaders(),
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
  }

  async getProjectPreviewSettings(projectID: string): Promise<ProjectPreviewSettings> {
    return readJSON<ProjectPreviewSettings>(await this.get(`/api/projects/${encodeURIComponent(projectID)}/preview/settings`));
  }

  async enableProjectPreview(projectID: string): Promise<ProjectPreviewSettings> {
    return this.changeProjectPreview(projectID, "PUT");
  }

  async disableProjectPreview(projectID: string): Promise<ProjectPreviewSettings> {
    return this.changeProjectPreview(projectID, "DELETE");
  }

  private async changeProjectPreview(projectID: string, method: "PUT" | "DELETE"): Promise<ProjectPreviewSettings> {
    return readJSON<ProjectPreviewSettings>(await this.request(`/api/projects/${encodeURIComponent(projectID)}/preview/settings`, {
      method, headers: this.mutationHeaders(), credentials: "same-origin", cache: "no-store",
    }));
  }

  async checkProjectPreview(projectID: string): Promise<ProjectPreviewCheck> {
    return readJSON<ProjectPreviewCheck>(await this.request(`/api/projects/${encodeURIComponent(projectID)}/preview/check`, {
      method: "POST", headers: this.mutationHeaders(), credentials: "same-origin", cache: "no-store",
    }));
  }

  async listSessions(projectID: string): Promise<SessionSummary[]> {
    return (await readJSON<SessionSummary[] | null>(
      await this.get(`/api/projects/${encodeURIComponent(projectID)}/sessions`),
    )) ?? [];
  }

  async recoverSession(sessionID: string): Promise<RecoverResult> {
    return readJSON<RecoverResult>(
      await this.request(`/api/sessions/${encodeURIComponent(sessionID)}/recover`, {
        method: "POST",
        headers: this.mutationHeaders(),
      }),
    );
  }

  async sessionScreen(sessionID: string): Promise<string | null> {
    const res = await this.request(`/api/sessions/${encodeURIComponent(sessionID)}/screen`);
    if (res.status === 404) return null;
    if (!res.ok) {
      // readJSON decodes the error envelope and throws the ApiError; a
      // success would be text, which is read below instead.
      await readJSON<never>(res);
    }
    return res.text();
  }

  async createSession(projectID: string, provider: string): Promise<SessionSummary> {
    // The last fitted geometry rides along so the session's window is born
    // at this screen's size rather than tmux's 80x24; the
    // server treats it as an optional bounded hint.
    const geometry = lastTerminalGeometry();
    return readJSON<SessionSummary>(
      await this.request(`/api/projects/${encodeURIComponent(projectID)}/sessions`, {
        method: "POST",
        headers: this.mutationHeaders(true),
        body: JSON.stringify(geometry === null
          ? { provider }
          : { provider, cols: geometry.cols, rows: geometry.rows }),
      }),
    );
  }

  async getTaskmasterInfo(projectID: string): Promise<TaskmasterInfo> {
    return readJSON<TaskmasterInfo>(
      await this.get(`/api/projects/${encodeURIComponent(projectID)}/taskmaster`),
    );
  }

  async initializeTaskmaster(projectID: string): Promise<TaskmasterInitResult> {
    return readJSON<TaskmasterInitResult>(
      await this.request(`/api/projects/${encodeURIComponent(projectID)}/taskmaster`, {
        method: "POST",
        headers: this.mutationHeaders(false),
      }),
    );
  }

  async listTaskmasterTasks(projectID: string): Promise<TaskmasterTasks> {
    return readJSON<TaskmasterTasks>(
      await this.get(`/api/projects/${encodeURIComponent(projectID)}/taskmaster/tasks`),
    );
  }

  async getTaskmasterTask(projectID: string, taskID: string): Promise<TmTask> {
    return readJSON<TmTask>(
      await this.get(`/api/projects/${encodeURIComponent(projectID)}/taskmaster/tasks/${encodeURIComponent(taskID)}`),
    );
  }

  async addTaskmasterTask(projectID: string, input: AddTaskInput): Promise<AddTaskResult> {
    return readJSON<AddTaskResult>(
      await this.request(`/api/projects/${encodeURIComponent(projectID)}/taskmaster/tasks`, {
        method: "POST",
        headers: this.mutationHeaders(true),
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify(input),
      }),
    );
  }

  async listTaskmasterPRDs(projectID: string): Promise<string[]> {
    return readJSON<string[]>(
      await this.get(`/api/projects/${encodeURIComponent(projectID)}/taskmaster/prds`),
    );
  }

  async uploadPrd(projectID: string, name: string, content: string, replace: boolean): Promise<void> {
    await readJSON<unknown>(
      await this.request(`/api/projects/${encodeURIComponent(projectID)}/taskmaster/prds`, {
        method: "POST",
        headers: this.mutationHeaders(true),
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ name, content, replace }),
      }),
    );
  }

  async generateTasks(projectID: string, prd: string): Promise<TmRun> {
    return readJSON<TmRun>(
      await this.request(`/api/projects/${encodeURIComponent(projectID)}/taskmaster/generate`, {
        method: "POST",
        headers: this.mutationHeaders(true),
        body: JSON.stringify({ prd }),
      }),
    );
  }

  async getSessionChats(sessionID: string): Promise<ChatLedger> {
    return readJSON<ChatLedger>(
      await this.get(`/api/sessions/${encodeURIComponent(sessionID)}/chats`),
    );
  }

  async listChats(): Promise<ChatIndex> {
    return readJSON<ChatIndex>(await this.get("/api/chats"));
  }

  async listTaskmasterRuns(projectID: string): Promise<TmRun[]> {
    return readJSON<TmRun[]>(
      await this.get(`/api/projects/${encodeURIComponent(projectID)}/taskmaster/runs`),
    );
  }

  async getTaskmasterRun(projectID: string, runID: string): Promise<TmRun> {
    return readJSON<TmRun>(
      await this.get(
        `/api/projects/${encodeURIComponent(projectID)}/taskmaster/runs/${encodeURIComponent(runID)}`,
      ),
    );
  }

  async listProjectFiles(projectID: string, path: string): Promise<FileListing> {
    return readJSON<FileListing>(
      await this.get(
        `/api/projects/${encodeURIComponent(projectID)}/files?path=${encodeURIComponent(path)}`,
      ),
    );
  }

  async viewProjectFile(projectID: string, path: string): Promise<FileView> {
    return readJSON<FileView>(
      await this.get(
        `/api/projects/${encodeURIComponent(projectID)}/files/view?path=${encodeURIComponent(path)}`,
      ),
    );
  }

  // projectFileDownloadUrl is a URL, not a request: the download is a GET
  // the browser performs itself, so the response's Content-Disposition
  // names and saves the file. Reading the body into JavaScript to hand
  // back a blob would buffer the whole file in the tab for nothing.
  projectFileDownloadUrl(projectID: string, path: string): string {
    return `/api/projects/${encodeURIComponent(projectID)}/files/download?path=${encodeURIComponent(path)}`;
  }

  // uploadProjectFile POSTs one file's raw bytes. The destination is the
  // `path` query parameter — the name the operator's directory and the
  // chosen file's basename decide — never a multipart filename, which the
  // handler deliberately ignores. A raw body also keeps the request one
  // stream per file with no framing to bound.
  //
  // The content type is stated rather than inherited from the Blob: the
  // handler switches to multipart parsing on a multipart content type,
  // and the picker reports whatever type the operating system attaches to
  // the chosen file.
  //
  // A 409 is the ask, not a failure: it decodes into an ApiError carrying
  // the conflict so the caller can put the question to the operator.
  // Consent, when given, is the version that conflict reported — never a
  // bare "yes", so a request cannot destroy a file the operator never saw.
  //
  // A caller that passes no options keeps the fetch request it always
  // had; a caller that wants to watch the bytes flows through the XHR
  // below, whose request is byte-identical on the wire.
  async uploadProjectFile(
    projectID: string,
    destPath: string,
    body: Blob,
    consent?: UploadConsent,
    options?: UploadTransportOptions,
  ): Promise<FileUploadResult> {
    if (options !== undefined) {
      return this.uploadProjectFileViaXHR(projectID, destPath, body, consent, options);
    }
    const headers = this.mutationHeaders();
    headers.set("Content-Type", "application/octet-stream");
    const resp = await this.request(
      uploadRequestPath(projectID, destPath, consent),
      {
        method: "POST",
        headers,
        credentials: "same-origin",
        cache: "no-store",
        body,
      },
    );
    if (resp.status === 409) {
      throw await uploadConflictError(resp);
    }
    return readJSON<FileUploadResult>(resp);
  }

  // uploadProjectFileViaXHR is the measured-upload path. XHR, because it
  // is the one browser transport that reports upload-side progress the
  // browser itself measured — routing through fetch would leave the
  // progress UI inventing bytes. The wire contract is identical to the
  // fetch path: same path and consent query, same CSRF header, same raw
  // octet-stream Blob, cookies on the same-origin request.
  //
  // Its two observations are upload-side facts only: onProgress counts
  // bytes handed to the socket, onSent says the last byte left the
  // browser. Neither is completion — the response alone decides whether
  // the file was placed — so a request that dies after onSent rejects
  // without an ApiError: the outcome is unknown (the server may have
  // committed), and nothing here retries it on its own.
  private uploadProjectFileViaXHR(
    projectID: string,
    destPath: string,
    body: Blob,
    consent: UploadConsent | undefined,
    options: UploadTransportOptions,
  ): Promise<FileUploadResult> {
    if (typeof XMLHttpRequest === "undefined") {
      // Failing loudly beats silently reporting no progress through a
      // transport that cannot measure any.
      return Promise.reject(new Error("upload progress needs XMLHttpRequest, which this environment does not provide"));
    }
    // A signal already aborted never dispatches: there is no request to
    // cancel, so none is made — no headers, no body, nothing sent.
    if (options.signal?.aborted) {
      return Promise.reject(abortError());
    }
    const headers = this.mutationHeaders();
    headers.set("Content-Type", "application/octet-stream");
    const url = uploadRequestPath(projectID, destPath, consent);
    const signal = options.signal;
    return new Promise<FileUploadResult>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let settled = false;
      const onAbort = (): void => {
        xhr.abort();
        // An XHR aborted before send() fires no abort event of its own
        // (it never left the unsent/opened state), so the rejection comes
        // from here either way.
        fail(abortError());
      };
      const cleanup = (): void => {
        settled = true;
        xhr.upload.onprogress = null;
        xhr.upload.onload = null;
        xhr.onload = null;
        xhr.onerror = null;
        xhr.onabort = null;
        signal?.removeEventListener("abort", onAbort);
      };
      const fail = (error: unknown): void => {
        if (settled) return;
        cleanup();
        reject(error);
      };
      xhr.open("POST", url);
      // withCredentials states the fetch path's credentials:"same-origin":
      // cookies ride this request because it is same-origin by construction.
      xhr.withCredentials = true;
      headers.forEach((value, key) => xhr.setRequestHeader(key, value));
      xhr.upload.onprogress = (event: ProgressEvent) => {
        if (settled || options.onProgress === undefined) return;
        // total is the browser's own count for the body it was handed;
        // a zero means "not computable", and the Blob's size is exact.
        options.onProgress(event.loaded, event.total > 0 ? event.total : body.size);
      };
      xhr.upload.onload = () => {
        if (settled || options.onSent === undefined) return;
        options.onSent();
      };
      xhr.onload = () => {
        if (settled) return;
        let parsed: unknown = null;
        let parseError: unknown = null;
        try {
          parsed = JSON.parse(xhr.responseText);
        } catch (cause) {
          parseError = cause;
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          const error = decodeUploadFailure(xhr.status, xhr.statusText, parsed);
          // The same authorization-loss read the fetch wrapper performs:
          // a 401, or a 403 whose body names a pending ceremony.
          if (this.onAuthorizationLost !== undefined) {
            if (xhr.status === 401) {
              this.onAuthorizationLost();
            } else if (xhr.status === 403) {
              const code = (parsed as { code?: unknown } | null)?.code;
              if (typeof code === "string" && AUTHORIZATION_LOSS_CODES.includes(code)) {
                this.onAuthorizationLost();
              }
            }
          }
          fail(error);
          return;
        }
        if (parseError !== null) {
          fail(parseError instanceof Error ? parseError : new Error("upload response was not JSON"));
          return;
        }
        if (parsed === null || typeof parsed !== "object" || !("path" in parsed) || !("size" in parsed)
            || parsed.path !== destPath || parsed.size !== body.size) {
          fail(new Error("upload response did not confirm the requested file"));
          return;
        }
        cleanup();
        resolve({ path: destPath, size: body.size });
      };
      xhr.onerror = () => fail(new Error("upload failed without a server answer"));
      xhr.onabort = () => fail(abortError());
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        if (signal?.aborted) onAbort();
        else xhr.send(body);
      } catch (error) {
        fail(error);
      }
    });
  }

  async getSession(sessionID: string): Promise<SessionDetail> {
    return readJSON<SessionDetail>(
      await this.get(`/api/sessions/${encodeURIComponent(sessionID)}`),
    );
  }

  async deleteSession(sessionID: string): Promise<void> {
    await readJSON<void>(
      await this.request(`/api/sessions/${encodeURIComponent(sessionID)}`, {
        method: "DELETE",
        headers: this.mutationHeaders(),
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
  }

  async renameSession(sessionID: string, name: string): Promise<void> {
    await readJSON<void>(
      await this.request(`/api/sessions/${encodeURIComponent(sessionID)}/rename`, {
        method: "POST",
        headers: this.mutationHeaders(true),
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ name }),
      }),
    );
  }

  async setSessionColor(sessionID: string, color: string | null): Promise<void> {
    await readJSON<void>(
      await this.request(`/api/sessions/${encodeURIComponent(sessionID)}/color`, {
        method: "POST",
        headers: this.mutationHeaders(true),
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ color }),
      }),
    );
  }

}

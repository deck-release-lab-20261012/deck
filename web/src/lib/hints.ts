// Info-bar hint catalog. Every data-hint value in the panels' *-dom.ts
// and web/src/app/* lives here so the copy can be diffed against the comp and
// checked mechanically. This is not a general i18n layer: no locale loading,
// plural rules, or RTL.

// Sidebar chrome
export const COLLAPSE_PROJECT_SIDEBAR = "Collapse the project sidebar";
export const EXPAND_PROJECT_SIDEBAR = "Expand the project sidebar";
export const OPEN_DIRECTORY_AS_PROJECT = "A path on this machine, or a repository to clone";
export const OPEN_PROJECTS_MENU = "Add, sort, expand or collapse projects";
export const START_NEW_SESSION = "Start a new session";
export const ADD_WORKSPACE_DIRECTORY_AS_PROJECT = "A path on this machine, or a repository to clone";
export const SORT_PROJECTS_BY_NAME = "Reorder the projects A to Z";
export const EXPAND_ALL_PROJECTS = "Show every project's sessions";
export const COLLAPSE_ALL_PROJECTS = "Hide every project's sessions";

// Project rows
export function projectToggle(expanded: boolean, name: string): string {
  return `${expanded ? "Hide" : "Show"} the sessions in ${name}`;
}

export function projectNewSession(name: string): string {
  return `Start a new session in ${name}`;
}

export function projectMenu(name: string): string {
  return `Rename, recolor or remove ${name}`;
}

// Session rows
export function sessionSwitch(session: string, project: string): string {
  return `Switch to ${session} in ${project}`;
}

export const RENAME_RECOLOR_CLOSE_SESSION = "Rename, recolor or close this session";

// Provider picker
export function newSessionProvider(name: string): string {
  return `Start a ${name} session`;
}

export const FILTER_PROVIDER_LIST = "Filter the provider list";

// Title bar / panels
export const OPEN_PANELS = "Open Files, Tasks, or Chats";
export const OPEN_PROJECT_PANELS = "Open Files or Tasks";
export const BROWSE_FILES = "Browse the files in this project's working tree";
export const OPEN_TASK_BOARD = "Open the task board parsed from the project's PRD";
export const WATCH_CHATS = "Watch the chats this session's agent is in";
export const OPEN_TERMINAL_IDENTITY_ACCOUNT_SETTINGS = "Open terminal, identity and account settings";
export const OPEN_SESSION_LIST = "Open the session list";
export const CLOSE_SESSION_LIST = "Close the session list";
export const CLOSE_SESSION_SETTINGS = "Close session settings";
export const RETURN_TO_LIVE_END = "Return to the live end of the output";

// Terminal context menu
export const COPY_TERMINAL_SELECTION = "Copy the selected text";
export const COPY_TERMINAL_SCREEN = "Copy the text on the screen";
export const PASTE_INTO_TERMINAL = "Paste the clipboard into this session";

// More menu
export const DECREASE_TERMINAL_FONT_SIZE = "Decrease terminal font size";
export const INCREASE_TERMINAL_FONT_SIZE = "Increase terminal font size";
export const CHANGE_TERMINAL_COLOR_SCHEME = "Change the terminal color scheme";
export const GIVE_PROJECT_DISTINCT_COLOR = "Give every project a distinct color in the sidebar";
export const SHOW_PROJECT_SIDEBAR = "Show the project sidebar";
export const SHOW_HOVER_FOCUS_HINTS = "Show hover and focus hints along the bottom";
// The comp's copy for its own info-bar model, which shows ambient session
// status at rest. Ours does not - a declared divergence - so this string is
// retained for comp parity and must not be wired to a control.
export const SHOW_HOVER_HINTS_SESSION_STATUS = "Show hover hints and session status along the bottom";
// Comp ground-truth string; the info bar's hints-only copy switched to it.
export const LET_NEW_SESSIONS_SKIP_PERMISSIONS = "Let new sessions skip permission prompts";
export const ASK_BEFORE_CLOSING_SESSION = "Ask before closing a session";
export const ASK_BEFORE_REMOVING_PROJECT = "Ask before removing a project from the sidebar";
export const SET_NAME_EMAILS_COMMITS_SIGNED = "Set the name and emails your commits are signed with";
export const SIGN_OUT_BROWSER_SESSION = "Sign out of Deck in this browser";

// More menu
export const CANCEL_ENABLING_YOLO = "Cancel enabling yolo mode";
export const ENABLE_YOLO_MODE = "Enable yolo mode";

export function sessionColor(name: string): string {
  return `Set this session color to ${name}`;
}

export function projectColor(name: string): string {
  return `Set this project color to ${name}`;
}

// Theme flyout / dialog
export function themeApply(name: string): string {
  return `Apply the ${name} color scheme`;
}

export const OPEN_CUSTOM_COLOR_EDITOR = "Open the custom color editor";

export function themeSlot(label: string): string {
  return `Edit the ${label} slot`;
}

export function themeSetFrom(short: string, theme: string): string {
  return `Set ${short} from ${theme}`;
}

export const TYPE_HEX_COLOR = "Type a six-character hex color";
export const PICK_HUE_SATURATION = "Pick a hue and saturation";
export const SET_HOW_LIGHT = "Set how light the color is";
export const RETURN_SLOTS_TO_SHIPPED = "Return every slot to the shipped custom values";
export const DISCARD_DRAFT_CLOSE = "Discard the draft and close";
export const SAVE_SLOTS_USE_THEME = "Save the slots and use the custom theme";

// Row menus
export const VIEW_PROJECT_PREVIEW_SETTINGS = "View this project's preview settings";
export const SET_UP_PROJECT_PREVIEW = "Set up this project's app preview";
export const OPEN_PROJECT_PREVIEW = "Open this project's app preview in a new tab";
export const RENAME_THIS_PROJECT = "Rename this project";
export const MOVE_PROJECT_UP = "Swap places with the project above";
export const MOVE_PROJECT_TO_TOP = "Move to the top of the sidebar";
export const MOVE_PROJECT_DOWN = "Swap places with the project below";
export const PROJECT_ALREADY_FIRST = "Already first in the sidebar";
export const PROJECT_ALREADY_LAST = "Already last in the sidebar";
export const CHANGE_PROJECT_GIT_IDENTITY = "Change the git identity this project commits with";
export const REMOVE_PROJECT_FROM_SIDEBAR = "Remove this project from the sidebar";
export const RENAME_THIS_SESSION = "Rename this session";
export const END_SESSION_PROCESS_KEEP_RECORDING = "End this session's process and keep the recording";
export const APPLY_PROJECT_COLOR_TO_SESSIONS = "Apply this project color to every session in it";
export const CLEAR_PROJECT_COLOR_FROM_SESSIONS = "Clear the color from every session in this project";

// Sidebar dialogs
export const KEEP_SESSION_OPEN = "Keep the session open";
export const CLOSE_THIS_SESSION = "Close this session";
export const KEEP_PROJECT_ON_SIDEBAR = "Keep the project on the sidebar";
export const SAVE_GIT_IDENTITY = "Save this git identity";
export const ENTER_AUTHOR_NAME = "Enter the author name";
export const ENTER_AUTHOR_EMAIL = "Enter the author email";
export const CLOSE_GIT_IDENTITY_SETTINGS = "Close git identity settings";
export const EDIT_THIS_IDENTITY = "Edit this identity";
export const CANCEL_EDITING_IDENTITY = "Cancel editing the identity";
export const SAVE_EDITED_IDENTITY = "Save the edited identity";
export const KEEP_THIS_IDENTITY = "Keep this identity";
export const REMOVE_THIS_IDENTITY = "Remove this identity";
export const CHOOSE_NEW_DEFAULT_IDENTITY = "Choose the new default identity";
export const CANCEL_CHOOSING_IDENTITY = "Cancel choosing the git identity";
export const APPLY_IDENTITY_TO_PROJECT = "Apply this git identity to the project";
export const SHOW_WORKSPACE_PATH = "Show the workspace path";
export const CHOOSE_WORKSPACE_FOLDER = "Choose a workspace folder";
export const CHOOSE_GIT_IDENTITY_FOR_PROJECT = "Choose the git identity for this project";
export const TYPE_PATH_OR_REPOSITORY = "Type a path on this machine, or a repository to clone";
export const EDIT_CLONE_DESTINATION = "Change where the clone lands";
export const CHOOSE_CLONE_CONTAINER = "Choose the directory the clone lands in";
export const SHOW_PROJECT_ALREADY_IN_SIDEBAR = "Show the project that already has this path";
export const TAKE_PARENT_REPOSITORY = "Take the repository this directory belongs to";
export const CANCEL_CLONE = "Stop the clone and keep what is on disk";
export const RUN_CLONE_IN_BACKGROUND = "Keep cloning while you do something else";
export const RESUME_CLONE = "Start the fetch again";
export const DISCARD_PARTIAL_CLONE = "Delete the partial clone";
export const CREATE_EMPTY_BOARD = "Start this project's task board with no tasks";
export const CANCEL_OPENING_PROJECT = "Cancel opening the project";
export const OPEN_THIS_PROJECT = "Open this project";
export const RETURN_TO_ROOT_FOLDER_LIST = "Return to the root folder list";
export const GO_UP_ONE_FOLDER = "Go up one folder";
export const NAME_NEW_FOLDER = "Name the new folder";
export const CREATE_NEW_FOLDER = "Create the new folder";
export const ADD_NEW_FOLDER = "Add a new folder";
export const CANCEL_CHOOSING_FOLDER = "Cancel choosing a folder";
export const SELECT_THIS_FOLDER = "Select this folder";

// Git identity dialog
export const USE_EMAIL_ON_NEW_PROJECTS = "Use this email on new projects";
export const REMOVE_EMAIL_FROM_LIST = "Remove this email from the list";
export const ADD_ANOTHER_EMAIL = "Add another email you commit with";

// Files panel
export const CLICK_PROJECT_NAME_ROOT = "Click the project name to go back to the root";
export const UPLOAD_FILES_INTO_FOLDER = "Upload files into this folder";
export const CLOSE_FILES_PANEL = "Close the files panel";
export const OPEN_THIS_FOLDER = "Open this folder";
export const OPEN_THIS_FILE = "Open this file";
export const RETURN_TO_FILE_LIST = "Return to the file list";
export const WRAP_LONG_LINES = "Wrap long lines in the viewer";
// Upload collisions: each hint names what its control does to
// the one file being asked about.
export const CANCEL_THIS_UPLOAD = "Skip this file; the existing file stays as it is";
export const UPLOAD_UNDER_EDITED_NAME = "Store this file under the edited name instead";
export const REPLACE_THE_EXISTING_FILE = "Replace the existing file with this upload";

export function SAME_CHOICE_FOR_REMAINING_UPLOADS(count: number): string {
  return `Apply this choice to the other ${count} file${count === 1 ? "" : "s"} that already exist${count === 1 ? "s" : ""} in this upload`;
}

export function upTo(dir: string): string {
  return `Up to ${dir}`;
}

export function sortFiles(field: string): string {
  return `Sort files by ${field}`;
}

export const DOWNLOAD_THIS_FILE = "Download this file";
export const VIEWER_EXPAND = "Expand the panel to fill the window";
export const VIEWER_COLLAPSE = "Shrink the panel back beside the terminal";

// Task board
export const ADD_PRD_TO_BOARD = "Add the PRD this board is parsed from";
export const ADD_TASK_TO_BOARD = "Add a task to this board";
export const CLOSE_TASK_BOARD = "Close the task board";

// Chats ledger (handoff §23). The row hints are the courier's own words:
// the per-recipient breakdown is data, not prose, and is not catalogued.
export const CLOSE_CHATS = "Hide the chats panel; participation is unchanged";
export const FOLD_EARLIER_CHATS = "Fold past chats";
export const UNFOLD_EARLIER_CHATS = "Show past chats";
export const CHAT_SEEN_BY_NOBODY = "Seen by nobody yet";
export const CHAT_MEMBER_LEFT_QUORUM = "Out of the closing quorum";
export const SHOW_CHAT_DETAILS = "Show the time on every row and the chat id";
export const HIDE_CHAT_DETAILS = "Hide the time on every row and the chat id";
export function watchChatsOf(agent: string): string {
  return `Watch the chats ${agent} is in`;
}
export function chatMemberAgreed(member: string): string {
  return `${member} agreed to end the chat`;
}
export function chatMemberWaiting(member: string): string {
  return `Nothing has happened yet; ${member} has not agreed`;
}
export function chatEndedAt(at: string): string {
  return `Everyone agreed to end it at ${at}`;
}
export function chatClosedByOpenerAt(opener: string, at: string): string {
  return `${opener} opened it and ended it for everyone at ${at}`;
}
export function chatEndedByDeparturesAt(at: string): string {
  return `It ended at ${at} after a member left`;
}
export function chatClosedAt(at: string): string {
  return `It ended at ${at}`;
}
export function chatLeftAt(who: string, at: string): string {
  return `${who} left the chat${at === "" ? "" : ` at ${at}`}`;
}
export function chatDeclinedAt(who: string, at: string): string {
  return `${who} declined the invitation at ${at}`;
}
export function chatForcedAt(who: string, at: string): string {
  return `${who} forced the end at ${at}`;
}
export const OPEN_TASK_DETAILS = "Open this task's details";
export const CLOSE_TASK_DETAILS = "Close the task details";
export const ENTER_TASK_TITLE = "Enter the task title";
export const ENTER_TASK_DESCRIPTION = "Enter the task description";
export const ENTER_TASK_DETAILS = "Enter the task details";
export const CHOOSE_TASK_PRIORITY = "Choose the task priority";
export const CANCEL_ADDING_TASK = "Cancel adding the task";
export const CHOOSE_PRD_FILE = "Choose a markdown PRD file";
export const CANCEL_ADDING_PRD = "Cancel adding the PRD";
export const UPLOAD_PRD_AND_GENERATE = "Upload the PRD and generate tasks";
export const GO_BACK_AND_CHOOSE_FILE = "Go back and choose a different file";
export const REPLACE_EXISTING_PRD = "Replace the existing PRD";
export const SHOW_TASKS_WITH_PRIORITY = "Show tasks with this priority";
export const SHOW_TASKS_WITH_STATUS = "Show tasks with this status";

export function sortTasks(field: string): string {
  return `Sort tasks by ${field}`;
}

export const SEARCH_TASKS = "Search tasks by title or id";
export const FILTER_TASKS_BY_PRIORITY = "Filter tasks by priority";

// Dialogs
export const CLOSE_THIS_DIALOG = "Close this dialog";

// Live terminal
export const RECONNECT_TO_SESSION = "Reconnect to this session";
export const TAKE_CONTROL_OF_SESSION = "Take control of this session";

// Mobile terminal dock
export const SEND_ESCAPE_KEY = "Send the Escape key";
export const SEND_TAB_KEY = "Send the Tab key";
export const TOGGLE_CTRL_MODIFIER = "Toggle the Control modifier";
export const OPEN_ARROW_PAD = "Open the arrow pad";
export const SEND_FORWARD_SLASH = "Send a forward slash";
export const SEND_PIPE = "Send a pipe";
export const SEND_TILDE = "Send a tilde";
export const SEND_BACKSPACE_KEY = "Send the Backspace key";
export const SEND_ARROW_UP = "Send the up arrow";
export const SEND_CLEAR_SCREEN = "Send Ctrl+L to clear the screen";
export const SEND_ARROW_LEFT = "Send the left arrow";
export const SEND_RETURN_KEY = "Send Return";
export const SEND_ARROW_RIGHT = "Send the right arrow";
export const SEND_ARROW_DOWN = "Send the down arrow";
export const SEND_MESSAGE = "Send the message";

// Recovery
export const START_FRESH_SESSION = "Start a fresh session";
export const RETRY_THIS_SESSION = "Retry this session";
export const RESUME_THIS_SESSION = "Resume this session in place";

// Sign in
export const ENTER_PASSWORD = "Enter your password";
export const SIGN_IN_WITH_PASSWORD = "Sign in with your password";
export const SIGN_IN_WITH_GOOGLE = "Sign in with Google";

// Title bar
export const RELOAD_TO_UPDATE = "Reload to update Deck";

// Data hints: values that come from runtime data, not authored copy.
export function directoryPath(path: string): string {
  return path;
}

export function viewerFileName(name: string): string {
  return name;
}

import type { TutorialLesson, TutorialModel } from "./tutorial.ts";

// Optional Explore Deck chapters. They are static help copy only: nothing
// here launches a session, mutates a project, or talks to a provider, and
// the guided course never walks into them — the operator chooses a chapter
// from All lessons or the final first-project step's Explore Deck button.
// Steps name real surfaces (sidebar menus, panels, hints) and never invent
// buttons: where no dedicated UI exists, the copy names the CLI workflow.
export const exploreTutorialCatalog: readonly TutorialLesson[] = [
  {
    id: "explore-projects",
    title: "Projects and sessions",
    optional: true,
    steps: [
      {
        title: "Projects",
        body: "Choose Add project, then GitHub, Local folder or Repository URL. GitHub offers Search repositories, a Repository owner filter and Import or Open for each result. Connect GitHub uses its native login and requires authenticated Deck access; organization permissions still apply. Review the destination and Git identity before Clone and add.",
      },
      {
        title: "Sessions",
        body: "Start a new session in a project and pick from the agent CLIs available on this machine; the CLI's own login happens in the terminal if it is needed. Select a session in the sidebar to switch to it. Closing a session ends its process and keeps the recording.",
      },
      {
        title: "Each session is a tab",
        body: "Switch projects and sessions in the sidebar while their processes continue. Project menus rename, color, reorder or remove a registration; removing a project stops its sessions but leaves files on disk. The Projects menu sorts, expands or collapses the list.",
      },
    ],
  },
  {
    id: "explore-terminal",
    title: "The native console",
    optional: true,
    steps: [
      {
        title: "Use the native CLI",
        body: "The native CLI owns conversation, slash commands and approval prompts. On a phone, type with the input field; the key row supplies Escape, Tab, Control, arrows and other keys the keyboard may lack.",
      },
      {
        title: "Clipboard and selection",
        body: "The terminal menu copies your selection or the whole screen, and pastes the clipboard into the session. Text you paste is input like typing — check it before sending.",
      },
      {
        title: "Scrollback",
        body: "Scroll the terminal to read earlier output, and choose Jump to live to follow new output again.",
      },
    ],
  },
  {
    id: "explore-recovery",
    title: "Reconnect and recovery",
    optional: true,
    steps: [
      {
        title: "Reconnect and takeover",
        body: "Use Reconnect after a lost connection. Deck checks whether the existing pane can be attached and reports a problem if it cannot. Only one browser controls input; Take control deliberately displaces the other connection.",
      },
      {
        title: "Recovery is bounded",
        body: "When a pane's process has died, Deck offers to resume it in place, retry, or start fresh. Automatic recovery stops after two attempts in ten minutes so a failing loop cannot spend money unattended.",
      },
      {
        title: "What delivery means",
        body: "Text handed to a terminal is not proof the model understood or completed it. If delivery is uncertain, inspect the selected console before deciding what to do. Do not automatically repeat the input.",
      },
    ],
  },
  {
    id: "explore-files",
    title: "Files",
    optional: true,
    steps: [
      {
        title: "Browse and read",
        body: "Open Files for the selected project. Use folders and breadcrumbs to choose a location, then read text or images. The viewer offers wrapping, expansion and download; edit source in your editor or native CLI.",
      },
      {
        title: "Upload into this folder",
        body: "Choose Upload files or drop files into the open folder. Files are limited to 32 MiB each. If a name exists, choose Replace, Upload as with a new name, or Cancel. Applying the same choice affects only the current batch; review replacement carefully.",
      },
      {
        title: "Transfer and confirmation",
        body: "Progress measures transfer; completion still needs server confirmation. Cancel upload stops a queued or active transfer. While confirming, Stop waiting can leave Outcome unknown: the file may already exist, so inspect the folder before another attempt. Dismiss hides the progress view. Deck does not automatically retry an uncertain upload.",
      },
    ],
  },
  {
    id: "explore-tasks",
    title: "Tasks",
    optional: true,
    steps: [
      {
        title: "Work the board by hand",
        body: "Add a task with a title, description, details and priority; search by title or id, filter by status or priority, and sort the board. A task's details view shows everything recorded about it, including its dependencies. The Tasks CLI in the session shell handles the changes a form does not.",
      },
      {
        title: "From PRD to tasks",
        body: "Add PRD accepts a Markdown file and asks before replacing an existing file. Uploading and generating tasks is an explicit action that may consume provider quota or incur cost. Read generation errors and the resulting board; you can add tasks manually without generation.",
      },
    ],
  },
  {
    id: "explore-preview",
    title: "Project preview",
    optional: true,
    steps: [
      {
        title: "See the app you are building",
        body: "Choose Preview… from the project menu to set it up, or Preview settings… once preview is enabled. Preview requires configured hosting and your project server running through its launcher. Choose Check connectivity, then Open preview in a new tab. A reachable server does not prove the app works correctly.",
      },
    ],
  },
  {
    id: "explore-chats",
    title: "Chats",
    optional: true,
    steps: [
      {
        title: "Read agent chats",
        body: "When a2a is installed and configured, Chats shows this session agent’s current and earlier chats. Expand details for participants, times and identifiers. This panel is read-only; explicit chat and reply actions use the native integration.",
      },
    ],
  },
  {
    id: "explore-appearance",
    title: "Appearance and navigation",
    optional: true,
    steps: [
      {
        title: "Make it yours",
        body: "The global three-dot menu sets terminal font size and theme, including custom colors. Show side panel and Show info bar control navigation and hover/focus hints. Auto-color projects and row menus help distinguish projects and sessions.",
      },
      {
        title: "Keyboard first",
        body: "Tab through buttons and menus; use the platform-specific shortcuts printed in the global and row menus for sidebar, info bar, rename and yolo mode. Native terminal shortcuts remain the CLI’s. Show tutorial restores your saved place.",
      },
    ],
  },
  {
    id: "explore-account",
    title: "Login and security",
    optional: true,
    steps: [
      {
        title: "Two different logins",
        body: "Authenticate the selected native CLI using its own flow. The Codex login helper keeps sign-in in the same terminal. If OpenAI returns to a localhost error page, copy that tab’s entire address and paste it only into the helper. Use terminal instead closes the helper; Open login helper brings it back. Other supported logins that wait for a localhost callback use Finish harness login in the global menu. Sign out ends this browser’s Deck session and leaves running sessions alone.",
      },
      {
        title: "Identities are separate too",
        body: "Git identity sets the author name and email recorded in commits. Choose Git identity… in the global menu or Project git identity… in a project menu. GitHub authentication grants repository access and is configured separately through Connect GitHub.",
      },
      {
        title: "What the switches do",
        body: "Yolo mode lets new sessions skip permission prompts. The confirmation settings govern closing sessions and removing projects. Where configured, Lock workspace stops sessions and locks storage; Unlock methods manages access methods. Reading this lesson changes none of these settings.",
      },
    ],
  },
  {
    id: "explore-workflow",
    title: "Workflows and integrations",
    optional: true,
    steps: [
      {
        title: "Git work in the shell",
        body: "Worktrees of one repository share that repository's Tasks store, so work split across worktrees stays one backlog. Branches, pull requests and reviews are native git and gh commands in the session shell — Deck adds no workflow UI on top.",
      },
      {
        title: "Independent review",
        body: "Check your diff and tests before sharing a change. An optional independent model review uses additional provider usage. A self-check is not independent approval; follow your project’s reviewer and CI requirements. Choose a different model when independent model review is required, and verify approval and checks cover the exact change you intend to merge.",
      },
      {
        title: "Optional tools stay optional",
        body: "MemPalace memory search and checkpoints, and a2a agent chat, require installed, configured tools. Use their supplied help and choose the project and scope explicitly. Reading this lesson performs no installation, memory mining or chat action.",
      },
    ],
  },
];

// The Explore Deck choice on the final first-project step. Both live and
// preview compose their catalogs the same way, so the button and its action
// are shared here instead of restated per surface.
export const TUTORIAL_ACTION_EXPLORE = "explore-deck";

export function exploreChoice(lessonId: string, base: string): string {
  if (lessonId !== "first-project-finish") return base;
  return `${base}<p><button type="button" class="tutorial-explore" data-tutorial-action="${TUTORIAL_ACTION_EXPLORE}">Explore Deck</button></p>`;
}

// Handles the explore action for a surface's onAction callback; returns
// false when the action belongs to someone else.
export function selectExplore(model: TutorialModel, action: string): boolean {
  if (action !== TUTORIAL_ACTION_EXPLORE) return false;
  model.selectLesson(exploreTutorialCatalog[0]!.id);
  return true;
}

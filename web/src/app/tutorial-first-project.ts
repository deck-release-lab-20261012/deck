import type { TutorialLesson } from "./tutorial.ts";

// The guided first-project curriculum's starter app: a small original
// reading list with one deliberately missing behavior (the unread-only
// view filter in list.mjs). The files below are materialized verbatim
// into the operator's fresh project by the explicit tutorial action.

export const firstProjectSampleVersion = 1;

export interface FirstProjectSampleFile {
  path: string;
  content: string;
}

export const firstProjectSampleFiles: readonly FirstProjectSampleFile[] = [
  {
    path: "index.html",
    content: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reading list</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 34rem; padding: 0 1rem; }
  li.read { color: #6b7280; text-decoration: line-through; }
  li a { margin-right: 0.5rem; }
</style>
</head>
<body>
<main>
  <h1>Reading list</h1>
  <ul id="items"></ul>
  <p><label><input type="checkbox" id="unread-only"> Unread only</label></p>
</main>
<script type="module" src="app.mjs"></script>
</body>
</html>
`,
  },
  {
    path: "app.mjs",
    content: `import { sampleItems, unreadOnly } from "./list.mjs";

const list = document.querySelector("#items");
const toggle = document.querySelector("#unread-only");

function render() {
  const items = toggle.checked ? unreadOnly(sampleItems) : sampleItems;
  list.replaceChildren(
    ...items.map((item) => {
      const li = document.createElement("li");
      if (item.read) li.classList.add("read");
      const link = document.createElement("a");
      link.href = item.url;
      link.textContent = item.title;
      li.append(link);
      const note = document.createElement("span");
      note.textContent = item.note;
      li.append(note);
      return li;
    }),
  );
}

toggle.addEventListener("change", render);
render();
`,
  },
  {
    path: "list.mjs",
    content: `// Reading-list domain logic, shared by the page and the tests.
export const sampleItems = [
  { title: "The Pragmatic Programmer", url: "https://example.com/pragmatic", note: " re-read chapters 2–4", read: false },
  { title: "A Philosophy of Software Design", url: "https://example.com/aposd", note: " complexity chapters", read: false },
  { title: "The Mythical Man-Month", url: "https://example.com/mmm", note: " done", read: true },
];

// The unread-only view filter is the exercise: this version returns every
// entry, so the failing test in list.test.mjs names the missing behavior.
export function unreadOnly(items) {
  return items;
}
`,
  },
  {
    path: "list.test.mjs",
    content: `import test from "node:test";
import assert from "node:assert/strict";
import { sampleItems, unreadOnly } from "./list.mjs";

test("sample list has both unread and read entries", () => {
  assert.ok(sampleItems.some((item) => !item.read));
  assert.ok(sampleItems.some((item) => item.read));
});

test("unreadOnly returns just the unread entries", () => {
  const before = structuredClone(sampleItems);
  assert.deepEqual(unreadOnly(sampleItems), sampleItems.filter((item) => item.read === false));
  assert.deepEqual(sampleItems, before, "filter must not mutate its input");
  assert.deepEqual(unreadOnly([]), []);
  assert.deepEqual(unreadOnly([{ read: true }, {}, { read: false }]), [{ read: false }]);
});
`,
  },
  {
    path: "serve.mjs",
    content: `import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { isIP } from "node:net";
import path from "node:path";

// Serves the page on the loopback interface only. The port comes from the
// preview helper's environment; 0 asks the OS for a free port and the
// chosen port is printed so a test or operator can find it.
const port = Number(process.env.DECK_PREVIEW_PORT ?? 0);
const host = process.env.DECK_PREVIEW_HOST ?? "127.0.0.1";
if (!(isIP(host) === 4 && host.startsWith("127.")) && host !== "::1") {
  throw new Error("Preview host must be a loopback address");
}
const root = path.dirname(fileURLToPath(import.meta.url));

// Only these paths are public. Requests never reach the filesystem as
// paths, so traversal cannot escape and PRD.md, preview.json and the
// tests are never served.
const publicFiles = {
  "/": "index.html",
  "/index.html": "index.html",
  "/app.mjs": "app.mjs",
  "/list.mjs": "list.mjs",
};
const types = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8" };

const server = createServer(async (req, res) => {
  const name = publicFiles[new URL(req.url ?? "/", "http://127.0.0.1").pathname];
  if (!name) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  try {
    const body = await readFile(path.join(root, name));
    res.writeHead(200, { "content-type": types[extname(name)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
});

server.listen(port, host, () => {
  const address = server.address();
  console.log(\`reading list listening on http://\${host === "::1" ? "[::1]" : host}:\${address.port}\`);
});
`,
  },
  {
    path: "PRD.md",
    content: `# Reading list

A single-page reading list the operator maintains by hand.

- The page lists saved entries with their title, link, and a short note.
- An "Unread only" toggle hides entries already read.
- The list module is pure logic so the tests cover it without a browser.
- \`serve.mjs\` serves the page on loopback; it is for local preview only.

Done when the toggle shows only unread entries and \`node --test\` passes.
`,
  },
  {
    path: "preview.json",
    content: `{"version":1,"command":["node","serve.mjs"]}
`,
  },
  {
    path: "tutorial.json",
    content: `{"version":1,"sample":"reading-list","lessons":["create","connect","implement","inspect","preview","finish"]}
`,
  },
  {
    path: "LICENSE",
    content: `MIT License

Copyright (c) 2026 Doug Doan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
  },
];

// Filenames the curriculum refers to by name; they must match the bundle.
export const firstProjectTaskFiles = {
  source: "list.mjs",
  tests: "list.test.mjs",
  server: "serve.mjs",
  prd: "PRD.md",
  preview: "preview.json",
} as const;

// The canonical task the curriculum creates and works. Description and
// details are the text the task store carries; the prompt is the exact
// single line the operator sends to the assigned agent.
export interface FirstProjectTask {
  title: string;
  description: string;
  details: readonly string[];
  prompt: string;
}

export const firstProjectTask: FirstProjectTask = {
  title: "Add an unread-only filter to the reading list",
  description: "The sample reading list ships without its unread-only view filter; implement it in list.mjs.",
  details: [
    "Change only list.mjs so unreadOnly returns the entries whose read flag is false.",
    "Leave list.test.mjs unchanged; the tests describe the expected behavior.",
    "Run node --test in the project directory and report the test result with git diff -- list.mjs.",
  ],
  prompt:
    "Implement unreadOnly in list.mjs to return only entries with read === false; change no other file, leave list.test.mjs unchanged, run node --test and report the test result and git diff -- list.mjs.",
};

// The lesson catalog for the first project, in curriculum order. Steps are
// presentation copy only: they describe what the operator does and checks
// by hand, and never claim a command's output or exit status on the
// operator's behalf.
export const firstProjectCatalog: readonly TutorialLesson[] = [
  {
    id: "first-project-create",
    title: "Create a reading list",
    steps: [{
      title: "A small project, one missing behavior",
      body: "Create a new local reading-list repository with a short PRD and one task. It needs no GitHub account or package downloads. This directory shares the installation runtime; it is not a sandbox.",
    }],
  },
  {
    id: "first-project-connect",
    title: "Prepare your console",
    steps: [{
      title: "See the starting point",
      body: "Open a shell to commit the starter and run its tests. One behavior intentionally fails. Then choose an available agent CLI and complete its own login if needed, or continue manually without a provider. Starting a CLI does not submit a model request.",
    }],
  },
  {
    id: "first-project-implement",
    title: "Make one change",
    steps: [{
      title: "One explicit request",
      body: "The request changes only list.mjs. Copy it or insert it into the selected tutorial agent session, check the prompt, then press Enter yourself. Static guidance uses no model tokens; the selected provider determines request usage and cost. The manual path is to edit list.mjs yourself.",
    }],
  },
  {
    id: "first-project-inspect",
    title: "Check the change",
    steps: [{
      title: "Read the diff and run the tests",
      body: "Run node --test and git diff -- list.mjs in your shell. Confirm that only the intended filter changed and the tests pass. Check the output before marking this step complete. Optional review by another model uses additional usage; an unavailable review is not formal approval.",
    }],
  },
  {
    id: "first-project-preview",
    title: "Try the reading list",
    steps: [{
      title: "Check the toggle in the app",
      body: "Enable the existing project preview, then run its launcher in a shell. Open the preview and toggle Unread only: read entries should disappear and return. Keep the server shell open while using the preview.",
    }],
  },
  {
    id: "first-project-finish",
    title: "Finish the task",
    steps: [{
      title: "Record the outcome",
      body: "After checking the tests, diff and app, record the task outcome through the Tasks CLI and refresh its status here. You may keep this project. Removing it from Deck stops its sessions and unregisters it; its files remain on disk.",
    }],
  },
];

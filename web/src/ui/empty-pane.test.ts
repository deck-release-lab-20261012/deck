// The empty pane's shape (comp desktop-r16): one anatomy for every
// state, on the page surface, in the interface voice. These pin the
// copy's sentence case, the small-caps treatment (font-variant-caps,
// never text-transform), the absence of mono, the ≤44ch body, the
// optical lift, and the one primary action — and that an unread
// registry renders as its own state, never as a known-empty database
// that offers onboarding.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  emptyPaneHtml,
  emptyTitlebarHtml,
} from "./empty-pane.ts";

test("no-session renders the shared anatomy with the project interpolated", () => {
  const html = emptyPaneHtml({ kind: "no-session", projectName: "field-notes" });
  assert.ok(html.includes('data-empty-pane="no-session"'), "the pane carries its state hook");
  assert.ok(html.includes(">No session open</h2>"), "the title is the sentence-case source string");
  assert.ok(
    html.includes("Pick a session from the side panel, or start a new one in <em>field-notes</em>."),
    "the body interpolates the project so the sentence and the button agree",
  );
  assert.ok(html.includes('data-empty-action'), "exactly one primary action");
  assert.ok(html.includes(">New session</button>"), "the action names what it does");
});

test("no-project renders the same anatomy with its own copy", () => {
  const html = emptyPaneHtml({ kind: "no-project", projectName: null });
  assert.ok(html.includes('data-empty-pane="no-project"'), "the pane carries its state hook");
  assert.ok(html.includes(">No projects yet</h2>"));
  assert.ok(
    html.includes("Point Deck at a directory, an existing repository, or a repository to clone."),
  );
  assert.ok(html.includes(">Add project</button>"));
});

test("small caps is a treatment, not copy casing", async () => {
  for (const kind of ["no-session", "no-project"] as const) {
    const html = emptyPaneHtml({
      kind,
      projectName: kind === "no-session" ? "field-notes" : null,
    });
    const title = /<h2 data-empty-title class="([^"]*)"/.exec(html)![1]!;
    assert.ok(
      title.includes("font-title-caps"),
      `${kind}: the title carries the small-caps utility`,
    );
    assert.ok(
      !/\buppercase\b/.test(title),
      `${kind}: the title never uses text-transform casing`,
    );
    // The utility must be the real treatment: reading textTransform tells
    // you nothing about all-small-caps, so the stylesheet rule itself is
    // pinned here.
    const css = await readFile(new URL("../styles/app.css", import.meta.url), "utf8");
    const utility = /@utility font-title-caps \{[^}]*\}/.exec(css)?.[0] ?? "";
    assert.match(utility, /font-variant-caps:\s*var\(--type-caps\)/);
    assert.match(css, /--type-caps:\s*all-small-caps/);
  }
});

test("nothing in the empty pane is mono", () => {
  for (const kind of ["no-session", "no-project"] as const) {
    const html = emptyPaneHtml({
      kind,
      projectName: kind === "no-session" ? "field-notes" : null,
    });
    assert.ok(
      !html.includes("font-mono") && !html.includes("--font-mono"),
      `${kind}: mono is the machine voice and never marks the app's own instruction`,
    );
    assert.ok(
      html.includes("text-title-3"),
      `${kind}: the title is title-3, per the anatomy`,
    );
  }
});

test("the body is capped at 44ch and sits on the interface surface", () => {
  const html = emptyPaneHtml({ kind: "no-session", projectName: "field-notes" });
  assert.ok(
    html.includes("max-w-[44ch]"),
    "the body line is measure-capped at 44ch",
  );
  assert.ok(
    html.includes("pb-[7%]"),
    "the composition is lifted optically, not geometrically centred",
  );
});

test("the states carry their own icons", () => {
  const session = emptyPaneHtml({ kind: "no-session", projectName: "p" });
  const project = emptyPaneHtml({ kind: "no-project", projectName: null });
  // The layers icon's stacked-planes path vs the folder's single outline.
  assert.ok(session.includes("M12.83 2.18"), "no-session leads with the layers icon");
  assert.ok(project.includes("M20 20a2 2 0 0 0 2-2V8"), "no-project leads with the folder icon");
});

test("an unread registry is its own state, never a known-empty one", () => {
  const html = emptyPaneHtml({ kind: "unread", projectName: null, error: "project registry unavailable" });
  assert.ok(html.includes('data-empty-pane="unread"'), "the pane carries its state hook");
  assert.ok(html.includes(">Projects unavailable</h2>"), "the title names the failure, not an empty database");
  assert.ok(!html.includes("No projects yet"), "an unread registry must never borrow the no-project copy");
  assert.ok(html.includes(">project registry unavailable</p>"), "the body carries the failure itself");
  assert.ok(
    !html.includes("data-empty-action"),
    "no create action renders until a registry read succeeds",
  );
});

test("the unread state still speaks before any failure arrives", () => {
  const html = emptyPaneHtml({ kind: "unread", projectName: null });
  assert.ok(html.includes("The project list has not loaded yet."));
  assert.ok(!html.includes("data-empty-action"), "no create action without a successful read");
  assert.ok(html.includes("M12 9v4"), "unread leads with the triangle-alert icon");
});

test("the unread titlebar sheds identity and panels; only the account menu stays", () => {
  const html = emptyTitlebarHtml("live", {
    kind: "unread",
    project: null,
  });
  assert.ok(!html.includes("data-terminal-identity"), "no identity over an unread registry");
  assert.ok(!html.includes("data-live-files"), "Files has nothing to read");
  assert.ok(!html.includes("data-live-tasks"), "Tasks has nothing to read");
  assert.ok(!html.includes("data-live-sessions"), "Sessions has nothing to open");
  assert.ok(html.includes("data-live-more"), "the account menu stays");
});

test("a read failure replaces the body copy, not the state", () => {
  const html = emptyPaneHtml({ kind: "no-session", projectName: "p", error: "project registry unavailable" });
  assert.ok(html.includes(">No session open</h2>"), "the title still names the state");
  assert.ok(html.includes('class="max-w-[44ch] text-body-sm text-error"'));
  assert.ok(html.includes("project registry unavailable"));
  assert.ok(
    !html.includes("Pick a session from the side panel"),
    "the error does not stack a second explanation under the copy",
  );
});

test("the no-session titlebar keeps the session chrome with the project in the identity slot", () => {
  const html = emptyTitlebarHtml("live", {
    kind: "no-session",
    project: { name: "field-notes", tint: null },
  });
  assert.ok(html.includes("data-terminal-identity"));
  assert.ok(html.includes(">field-notes</span>"), "the header names the project, not the absent session");
  assert.ok(html.includes("data-live-files"));
  assert.ok(html.includes("data-live-tasks"));
  assert.ok(html.includes("data-live-sessions"), "Sessions opens the sidebar on mobile");
  assert.ok(html.includes("data-live-more"));
});

test("the no-project titlebar sheds identity and panels; only the account menu stays", () => {
  const html = emptyTitlebarHtml("titlebar", {
    kind: "no-project",
    project: null,
  });
  assert.ok(!html.includes("data-terminal-identity"), "no project identity without a project");
  assert.ok(!html.includes("data-titlebar-files"), "Files has nothing to read");
  assert.ok(!html.includes("data-titlebar-tasks"), "Tasks has nothing to read");
  assert.ok(!html.includes("data-titlebar-sessions"), "Sessions has nothing to open");
  assert.ok(html.includes("data-titlebar-more"), "the account menu stays");
});

test("project names are interpolated escaped", () => {
  const html = emptyPaneHtml({ kind: "no-session", projectName: `<b>evil & co</b>` });
  assert.ok(!html.includes("<b>evil"), "the project name is escaped into the body");
  assert.ok(html.includes("&lt;b&gt;evil &amp; co&lt;/b&gt;"));
});

test("workspace actions expose panels beside a distinct settings control", async () => {
  const { titlebarRightHtml } = await import("./empty-pane.ts");
  for (const surface of ["live", "titlebar"] as const) {
    const html = titlebarRightHtml(surface, { panels: true, sessions: true, chats: { unseen: true } });
    assert.match(html, /aria-label="Settings"/);
    assert.match(html, /aria-label="Panels" aria-haspopup="menu" aria-expanded="false" data-unseen="true"/);
    assert.match(html, /aria-label="Sessions"/);
    assert.ok(html.indexOf(`data-${surface}-sessions`) < html.indexOf(`data-${surface}-panels`));
    assert.ok(html.indexOf(`data-${surface}-panels`) < html.indexOf(`data-${surface}-more`));
    for (const panel of ["files", "tasks", "chats"]) assert.ok(html.includes(`data-${surface}-${panel}`));
    const empty = titlebarRightHtml(surface, { panels: false });
    assert.ok(!empty.includes(`data-${surface}-panels`));
    assert.match(empty, /aria-label="Settings"/);
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import { panelTriggerHtml } from "./panel-trigger.ts";

test("Files and Project tasks share one desktop trigger primitive", () => {
  for (const trigger of ["files", "tasks"] as const) {
    const html = panelTriggerHtml("live", trigger, { pressed: true });
    assert.match(html, new RegExp(`data-live-${trigger}`));
    assert.match(html, /class="group\/panel-trigger flex h-7/);
    assert.match(html, /data-panel-trigger-visual[^>]*h-7/);
    assert.match(html, /border-border-strong/);
    assert.match(html, /gap-1\b/);
    assert.match(html, /aria-pressed="true"/);
  }
});

test("the triggers are secondary sm buttons carrying a data-hint", () => {
  const files = panelTriggerHtml("live", "files");
  const tasks = panelTriggerHtml("live", "tasks");
  assert.match(files, /data-hint="Browse the files in this project's working tree"/);
  assert.match(tasks, /data-hint="Open the task board parsed from the project's PRD"/);
  assert.match(files, /bg-surface-card/);
  assert.match(files, /rounded-control-sm/);
  assert.match(files, /font-medium/);
  // The label type belongs to the button: body-sm's 1.5 line ratio would
  // break the 13px line box the secondary sm control uses.
  assert.equal(files.includes("leading-[13px]"), true);
  assert.equal(files.includes("tracking-[0.004em]"), true);
  assert.equal(files.includes("text-body-sm"), false);
  assert.match(files, /width="14" height="14"/);
  assert.match(tasks, /width="14" height="14"/);
  assert.match(tasks, /M12 3v18/);
  assert.match(files, /M20 20a2/);
});

test("desktop panel triggers keep visible labels and accessible names", () => {
  const files = panelTriggerHtml("titlebar", "files");
  const tasks = panelTriggerHtml("titlebar", "tasks");
  assert.match(files, /aria-label="Files"/);
  assert.match(tasks, /aria-label="Project tasks"/);
  assert.match(files, /<span>Files<\/span>/);
  assert.match(tasks, /<span>Tasks<\/span>/);
});

test("the Tasks trigger never renders a count badge", () => {
  const tasks = panelTriggerHtml("live", "tasks");
  assert.match(tasks, /<span>Tasks<\/span>/);
  assert.equal(tasks.includes("data-live-tasks-count"), false);
  assert.equal(tasks.includes("bg-surface-muted"), false);
});

test("a chat-derived hint is escaped at the renderer boundary", () => {
  const html = panelTriggerHtml("live", "chats", { hint: 'Watch the chats x" onmouseover="alert(1)' , unseen: true });
  assert.ok(!html.includes('" onmouseover="'), "a quote in agent data cannot close the attribute");
  assert.match(html, /data-hint="Watch the chats x&quot; onmouseover=&quot;alert\(1\)"/);
  assert.match(html, /data-unseen="true"/);
});

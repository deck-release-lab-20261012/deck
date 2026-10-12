// Real-browser probe for the Add project dialog (comp desktop-r38 to r45):
// explicit local/URL choices. It drives the built preview through the
// fixture's sample workspace and scripted clone: recognition for each kind
// of input, Browse writing back into the field, a duplicate's Show it, the
// clone's run / background / rail row / cancel / resume / done arc, and a
// refused key. Markup tests pin the decision table; this proves the wiring.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { browser as getBrowser } from "./browser.mjs";

const WEB = resolve(import.meta.dirname, "..");
const DIST = join(WEB, "dist");
const MIME = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
if (!existsSync(join(DIST, "preview.html"))) throw new Error("dist/preview.html is missing — run `pnpm build` first");

function serve(dir) {
  const server = createServer(async (req, res) => {
    const path = join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!path.startsWith(dir) || !existsSync(path)) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[extname(path)] ?? "application/octet-stream" });
    res.end(await readFile(path));
  });
  return new Promise((resolveServer) => server.listen(0, "127.0.0.1", () => resolveServer(server)));
}

const field = (page) => page.locator("[data-project-path]");
const primary = (page) => page.locator("[data-project-submit]");
const body = (page) => page.locator("[data-add-project]");

async function type(page, text) {
  await field(page).fill(text);
  // The readout states an inspection of the current input; wait for it.
  await page.waitForFunction(() => {
    const p = document.querySelector("[data-project-submit]");
    return p !== null;
  });
  await page.waitForTimeout(350);
}

async function expectText(page, text, label) {
  await page.locator(`[data-add-project]:has-text(${JSON.stringify(text)})`).waitFor({ timeout: 5000 }).catch(() => {});
  assert.ok((await body(page).textContent()).includes(text), `${label}: shows "${text}"`);
}

const server = await serve(DIST);
const origin = `http://127.0.0.1:${server.address().port}`;
const { browser, via } = await getBrowser();
console.log(`browser: ${via}`);
try {
  const page = await browser.newPage({ viewport: { width: 1502, height: 818 } });
  await page.goto(`${origin}/preview.html?dialog=open-project`, { waitUntil: "networkidle" });
  await page.locator("[data-project-form]").waitFor();

  assert.equal(await primary(page).isDisabled(), true, "empty: nothing to add");
  assert.equal(await primary(page).innerText(), "Add project");

  await type(page, "brand-new-thing");
  await expectText(page, "New directory", "absent");
  await expectText(page, "git init · no history", "absent");
  await expectText(page, "/workspace/brand-new-thing/.git/noise-tasks/tasks.sqlite", "absent store");
  assert.equal(await page.locator("[data-project-git-profile]").count(), 1, "absent: identity applies");
  assert.equal(await primary(page).isDisabled(), false);

  await type(page, "tmp");
  await expectText(page, "What is there", "plain");
  await expectText(page, "2 directories, no .git", "plain summary");
  assert.equal(await primary(page).innerText(), "Add as project");
  assert.equal(await page.locator("[data-project-git-profile]").count(), 0, "plain: identity does not apply");
  assert.ok(!(await body(page).textContent()).includes("Task store"), "plain: no store");

  await type(page, "deck");
  await expectText(page, "origin github.com/fable/deck", "repository");
  await expectText(page, "Its own repository root.", "repository");
  assert.equal(await primary(page).innerText(), "Add project");

  await type(page, "/workspace/tmp/vd-gate2");
  await expectText(page, "A linked worktree of /workspace/visual-diff.", "worktree");
  await expectText(page, "A worktree's store lives inside the parent repository's .git", "worktree warning");
  assert.equal(await primary(page).innerText(), "Add anyway");
  assert.equal(await page.locator("[data-project-take-parent]").textContent(), "Add visual-diff instead");

  await type(page, "field-notes/docs");
  await expectText(page, "This directory is inside", "inside");
  assert.equal(await page.locator("[data-project-take-parent]").textContent(), "Open field-notes");

  await type(page, "/workspace/field-notes");
  await expectText(page, "Already in the sidebar as field-notes.", "dup");
  assert.equal(await primary(page).isDisabled(), true);
  await page.locator("[data-project-show-dup]").click();
  await page.locator("[data-project-form]").waitFor({ state: "detached" });
  assert.equal(await page.locator('[data-project-toggle="proj-1"]').getAttribute("aria-expanded"), "true", "Show it reveals the project");

  // Browse writes back into the field.
  await page.locator("[data-projects-menu]").click();
  await page.locator("[data-projects-menu-new-project]").click();
  await page.locator('[data-project-source="local"]').click();
  await page.locator("[data-project-form]").waitFor();
  await page.locator("[data-project-browse]").click();
  await page.locator('[data-directory-path="/workspace/audio-player"]').click();
  await page.locator("[data-directory-select]").click();
  await page.locator("[data-directory-dialog]").waitFor({ state: "detached" });
  assert.equal(await field(page).inputValue(), "/workspace/audio-player", "Browse fills the field");

  // A URL: clone into, then the job's arc.
  await type(page, "fable/genuinely-new-repo");
  await expectText(page, "Clone into", "url");
  assert.equal(await page.locator("[data-project-clone-dest]").inputValue(), "/workspace/genuinely-new-repo");
  assert.equal(await primary(page).innerText(), "Clone and add");
  // Browse on Clone into picks the container, leaving the repository name
  // to name the folder — and writes back to that control, not the field.
  await page.locator("[data-project-browse-dest]").click();
  await page.locator('[data-directory-path="/workspace/tmp"]').click();
  await page.locator("[data-directory-select]").click();
  await page.locator("[data-directory-dialog]").waitFor({ state: "detached" });
  await page.locator("[data-project-form]:not([data-inspecting])").waitFor();
  assert.equal(await field(page).inputValue(), "fable/genuinely-new-repo", "the field keeps the URL");
  assert.equal(await page.locator("[data-project-clone-dest]").inputValue(), "/workspace/tmp/genuinely-new-repo", "the destination moved to the chosen container");

  // The debounce race: newer text, older answer. Nothing may act on the
  // old path under the new text, so Enter inside the debounce is inert.
  await type(page, "brand-new-thing");
  assert.equal(await primary(page).isDisabled(), false);
  await field(page).fill("/workspace/field-notes");
  assert.equal(await page.locator("[data-project-form][data-inspecting]").count(), 1, "an inspection is in flight");
  assert.equal(await primary(page).isDisabled(), true, "the primary is dead while the answer is pending");
  await field(page).press("Enter");
  await page.locator("[data-project-form]:not([data-inspecting])").waitFor();
  assert.equal(await page.locator("[data-project-form]").count(), 1, "Enter during the debounce created nothing and closed nothing");
  await expectText(page, "Already in the sidebar as field-notes.", "the settled answer is about the new text");

  await page.locator('[data-project-source="choose"]').click();
  await page.locator('[data-project-source="url"]').click();
  await type(page, "fable/tasks-engine");
  await expectText(page, "Already cloned here from", "same clone on disk (comp knownDirs)");
  assert.equal(await primary(page).innerText(), "Add existing clone");
  await type(page, "fable/deck");
  await expectText(page, "Already cloned here from", "same clone");
  assert.equal(await primary(page).innerText(), "Add existing clone");
  await type(page, "github.com/other/deck");
  await expectText(page, "Not empty —", "collision");
  assert.equal(await primary(page).isDisabled(), true);

  await type(page, "fable/genuinely-new-repo");
  await primary(page).click();
  await page.locator("[data-clone-percent]").waitFor();
  await expectText(page, "Cloning into genuinely-new-repo.", "running");
  await page.locator("[data-clone-background]").click();
  await page.locator("[data-project-form]").waitFor({ state: "detached" });
  await page.locator('[data-clone-row]').waitFor();
  assert.ok((await page.locator('[data-clone-row]').textContent()).includes("importing"), "the rail carries the running import");
  await page.locator('[data-clone-row]').click();
  await page.locator("[data-clone-cancel]").waitFor();
  await page.locator("[data-clone-cancel]").click();
  await page.locator("[data-clone-resume]").waitFor();
  await expectText(page, "Partial clone on disk", "stopped");
  await page.locator(".dialog-foot [data-project-cancel]").click();
  await page.locator("[data-project-form]").waitFor({ state: "detached" });
  assert.ok((await page.locator('[data-clone-row]').textContent()).includes("import incomplete"), "the rail carries the stopped import");
  await page.locator('[data-clone-row]').click();
  await page.locator("[data-clone-resume]").click();
  await page.locator("[data-clone-create-board]").waitFor({ timeout: 15000 });
  await expectText(page, "genuinely-new-repo imported", "done");
  await expectText(page, "Start an empty board", "done");
  await page.locator("[data-clone-create-board]").click();
  await page.locator("[data-project-form]").waitFor({ state: "detached" });
  await page.locator('[data-project-toggle="proj-7"]').waitFor();
  assert.equal(await page.locator('[data-clone-row]').count(), 0, "a finished import leaves the rail as a project");

  // A refused key returns to the field with git's words.
  await page.locator("[data-projects-menu]").click();
  await page.locator("[data-projects-menu-new-project]").click();
  await page.locator('[data-project-source="url"]').click();
  await page.locator("[data-project-form]").waitFor();
  await type(page, "git@github.com:fable/private.git");
  await primary(page).click();
  await page.locator("[data-project-submit]").waitFor({ timeout: 15000 });
  await expectText(page, "The server refused this machine's key.", "auth");
  await expectText(page, "ssh -T git@github.com", "auth");

  console.log("add-project probe: all assertions passed");
} finally {
  await browser.close();
  server.close();
}

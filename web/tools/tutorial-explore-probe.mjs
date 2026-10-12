// Optional feature help stays navigable without invoking project or provider actions.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const captureDir = process.env.TUTORIAL_EXPLORE_CAPTURE_DIR;
if (captureDir) await mkdir(captureDir, { recursive: true });

const { browser: getBrowser } = await import("./browser.mjs");

const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
let serverOutput = "";
const vite = spawn(
  process.env.PNPM_BIN ?? "pnpm",
  ["exec", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: new URL("..", import.meta.url), stdio: ["ignore", "pipe", "pipe"] },
);
vite.stdout.on("data", (chunk) => { serverOutput += chunk; });
vite.stderr.on("data", (chunk) => { serverOutput += chunk; });

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function waitForServer(url) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (Date.now() - started > 30_000) {
        reject(new Error(`vite did not start:\n${serverOutput}`));
        return;
      }
      try {
        const response = await fetch(url, { redirect: "manual" });
        if (response.status < 500) { resolve(); return; }
      } catch { /* keep polling */ }
      setTimeout(tick, 100);
    };
    tick();
  });
}

let browser;
try {
  await waitForServer(origin);
  ({ browser } = await getBrowser());
  const { exploreTutorialCatalog } = await import("../src/app/tutorial-explore.ts");
  const expected = ["explore-projects", "explore-terminal", "explore-recovery", "explore-files", "explore-tasks", "explore-preview", "explore-chats", "explore-appearance", "explore-account", "explore-workflow"];
  assert.deepEqual(exploreTutorialCatalog.map((lesson) => lesson.id), expected, "every supported feature chapter is present");
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: "noisedeck_csrf", value: "probe", url: origin }]);
  const page = await context.newPage();
  const errors = [];
  const input = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const project = { id: "p1", name: "Explore project", canonical_path: "/workspace/explore", last_used_at: "t", git_identity_setup_revision: 1 };
  const session = { id: "s1", project_id: "p1", provider: "claude", display_name: "Explore console", status: "running", presentation_state: "running", generation: 1, created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z", recovery_capability: "none", recovery_state: "unavailable", tmux_pane_id: "%1", pane_pid: 4242, native_session_id: "fixture" };
  let record = { version: 1, dismissed: false, lesson: "first-project-finish", step: 0, done: [], scope: "operator" };
  const writes = [];
  await page.routeWebSocket(`${origin.replace("http", "ws")}/api/sessions/*/terminal?*`, (socket) => {
    socket.onMessage((raw) => { if (JSON.parse(String(raw)).type === "input") input.push(raw); });
    socket.send(JSON.stringify({ type: "attached", token: 7, generation: 1 }));
    socket.send(JSON.stringify({ type: "output", data: Buffer.from("Explore console\r\n").toString("base64") }));
  });
  await page.route(`${origin}/auth/session`, (route) => route.fulfill({ status: 204, headers: { "X-Noisedeck-Auth-Mode": "builtin" } }));
  await page.route(`${origin}/api/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/settings/tutorial") {
      if (request.method() === "PUT") {
        assert.equal(request.headers()["x-csrf-token"], "probe");
        record = { ...request.postDataJSON(), scope: "operator" };
        writes.push(record);
      }
      return json(200, record);
    }
    if (path === "/api/settings/layout") return json(request.method() === "PUT" ? 200 : 404, request.method() === "PUT" ? request.postDataJSON() : { code: "not_found" });
    assert.equal(request.method(), "GET", `static help caused a mutation: ${path}`);
    if (path === "/api/settings") return json(200, { skip_permissions: false, skip_close_confirm: false, skip_remove_project_confirm: false });
    if (path === "/api/projects") return json(200, [project]);
    if (path.endsWith("/sessions")) return json(200, [session]);
    if (path === "/api/sessions/s1") return json(200, session);
    if (path === "/api/providers") return json(200, { providers: ["claude", "shell"] });
    if (path === "/api/harness-login") return json(200, { pending: [] });
    if (path === "/api/harness-usage") return json(200, { global: [], project: [] });
    if (path === "/api/git-identities") return json(200, { profiles: [{ id: "identity", name: "Probe", email: "probe@example.invalid", revision: 1 }], default_profile_id: "identity", revision: 1 });
    if (path === "/api/project-directories") return json(200, { current_path: "", parent_path: null, directories: [] });
    if (path.endsWith("/events")) return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": connected\n\nretry: 3600000\n\n" });
    if (path.endsWith("/files")) return json(200, { path: "", at_root: true, entries: [] });
    if (path.includes("/taskmaster")) return json(404, { code: "not_taskmaster_project", message: "Not a Tasks project" });
    if (path.endsWith("/chats")) return json(200, { agent: "probe", chats: [] });
    throw new Error(`unhandled ${path}`);
  });
  const panel = page.locator('[data-region="tutorial"]');
  const button = (name) => panel.getByRole("button", { name, exact: true });
  let expectedWrites = 0;
  const save = async (action) => {
    expectedWrites += 1;
    const [response] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/api/settings/tutorial") && response.request().method() === "PUT"), action(),
    ]);
    await response.finished();
  };
  const show = async () => {
    await page.locator("[data-live-more]").click();
    await save(() => page.getByRole("button", { name: "Show tutorial", exact: true }).click());
    await panel.waitFor({ state: "visible" });
  };
  const choose = async (lesson) => {
    await button("All lessons").click();
    const option = button(lesson.title);
    await option.focus();
    await save(() => option.press("Enter"));
    await panel.getByRole("heading", { name: lesson.steps[0].title, exact: true }).waitFor();
  };
  await page.goto(origin, { waitUntil: "networkidle" });
  await panel.waitFor({ state: "visible" });
  await save(() => button("Finish").click());
  assert.equal(record.dismissed, true);
  assert.equal(record.lesson, "first-project-finish", "Finish does not enter optional help");
  assert.equal(record.done.some((id) => id.startsWith("explore-")), false);
  await show();
  const writesBeforeExplore = writes.length;
  await save(() => button("Explore Deck").click());
  await panel.getByRole("heading", { name: "Projects", exact: true }).waitFor();
  assert.equal(record.lesson, "explore-projects");
  assert.equal(record.step, 0);
  assert.equal(writes.length, writesBeforeExplore + 1, "Explore Deck saves its destination exactly once");
  assert.equal(await button("Back").isDisabled(), true, "Back stops at the optional course boundary");
  for (const width of [1280, 390]) {
    if (width === 390) {
      const collapse = page.getByRole("button", { name: "Collapse sidebar", exact: true });
      if (await collapse.isVisible()) await collapse.click();
    }
    await page.setViewportSize({ width, height: 900 });
    for (const lesson of exploreTutorialCatalog) {
      await choose(lesson);
      if (captureDir && lesson.id === "explore-files") await page.screenshot({ path: join(captureDir, `explore-files-${width}.png`) });
      for (const [index, step] of lesson.steps.entries()) {
        await panel.getByRole("heading", { name: step.title, exact: true }).waitFor();
        assert.ok((await panel.innerText()).includes(step.body));
        if (lesson.id === "explore-terminal" && step.title === "Scrollback") {
          assert.ok((await panel.innerText()).includes("choose Jump to live"), "scrollback help names the shipped button");
        }
        if (lesson.id === "explore-account" && index === 0) {
          const accountHelp = await panel.innerText();
          for (const term of ["Codex login helper", "Open login helper", "Use terminal instead", "localhost error page", "copy that tab’s entire address", "Finish harness login"]) {
            assert.ok(accountHelp.includes(term), `login help explains the shipped ${term} path`);
          }
          if (captureDir) await page.screenshot({ path: join(captureDir, `explore-account-${width}.png`) });
        }
        assert.equal(record.lesson, lesson.id);
        assert.equal(record.step, index);
        if (index < lesson.steps.length - 1) await save(() => button("Next").press("Enter"));
      }
    }
  }
  const saved = { lesson: record.lesson, step: record.step };
  await save(() => button("Close tutorial").click());
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await panel.getAttribute("data-open"), "false");
  await show();
  assert.deepEqual({ lesson: record.lesson, step: record.step }, saved);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of ["files", "tasks", "chats"]) {
      const writesBeforePanel = writes.length;
      const preferencesBeforePanel = structuredClone(record);
      if (width < 768) {
        await page.getByRole("button", { name: "Panels", exact: true }).click();
        await page.getByRole("menuitem", { name: name[0].toUpperCase() + name.slice(1), exact: true }).click();
      } else {
        await page.locator(`[data-live-${name}]`).click();
      }
      const host = page.locator(`[data-region="${name}"][data-open="true"]`);
      await host.waitFor();
      assert.equal(await panel.getAttribute("data-open"), "false", `opening ${name} hides the tutorial`);
      await panel.waitFor({ state: "hidden" });
      assert.equal(await panel.evaluate((el) => el.inert), true);
      const mobileBar = page.locator('[data-region="tutorial-mobile-bar"]');
      await mobileBar.waitFor({ state: "hidden" });
      assert.equal(await mobileBar.boundingBox(), null, "hidden progress takes no layout space");
      assert.equal(await page.locator("[data-tutorial-bar]").count(), 0, "no lesson bar is mounted in any panel");
      assert.equal(await host.locator("[data-tutorial-action]").count(), 0, `${name} shows no tutorial progress or help entry`);
      if (captureDir && width === 390 && name === "files") await page.screenshot({ path: join(captureDir, "explore-files-context-phone.png") });
      await host.getByRole("button", { name: `Close ${name}`, exact: true }).click();
      await page.waitForFunction((region) => document.querySelector(`[data-region="${region}"]`)?.getAttribute("data-open") === "false", name);
      assert.equal(await panel.getAttribute("data-open"), "true", `closing ${name} restores the tutorial`);
      assert.deepEqual(record, preferencesBeforePanel, "panel docking preserves every saved preference");
      assert.equal(writes.length, writesBeforePanel, "panel docking never writes progress");
      if (width < 768) {
        await page.getByRole("button", { name: "Panels", exact: true }).click();
        await page.getByRole("menuitem", { name: name[0].toUpperCase() + name.slice(1), exact: true }).click();
      } else {
        await page.locator(`[data-live-${name}]`).click();
      }
      await host.waitFor();
      if (width === 390) {
        await host.getByRole("button", { name: `Close ${name}`, exact: true }).click();
        await save(() => button("Close tutorial").click());
      }
      await show();
      assert.equal(await page.locator(`[data-region="${name}"]`).getAttribute("data-open"), "false", "Show tutorial closes the other panel");
      assert.deepEqual({ lesson: record.lesson, step: record.step }, saved, "explicit Show tutorial restores saved progress");
    }
  }
  assert.equal(input.length, 0, "reading help never sends native terminal input");
  assert.deepEqual(errors, []);
  assert.equal(writes.length, expectedWrites, "each explicit navigation saves once, including no delayed Explore Deck duplicate");
  console.log("ok: every Explore chapter on desktop/phone/keyboard, first-course Finish boundary, persistence, panel handoff, zero project/provider actions");
  await context.close();
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}

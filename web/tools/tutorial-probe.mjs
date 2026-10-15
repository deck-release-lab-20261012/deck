// Tutorial persistence and docking through the production workspace.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";

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
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addCookies([{ name: "noisedeck_csrf", value: "probe", url: origin }]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => { errors.push(error.message); console.error("page error:", error.message); });
  let record = null;
  let failWrites = false;
  let hasSession = false;
  let holdRead = false;
  let releaseRead;
  let holdWrite = false;
  let releaseWrite;
  let writeStarted;
  let terminalSocket;
  let identityReady = false;
  let identityWrites = 0;
  const identity = { id: "identity-1", name: "Probe identity", email: "probe@example.invalid", revision: 1, created_at: "t", updated_at: "t" };
  const writes = [];
  const project = { id: "p1", name: "Existing project", canonical_path: "/workspace/probe", last_used_at: "t", git_identity_setup_revision: 1 };
  const session = { id: "s1", project_id: "p1", provider: "claude", display_name: "Probe session", status: "running", presentation_state: "running", generation: 1, created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z", recovery_capability: "none", recovery_state: "unavailable", tmux_pane_id: "%1", pane_pid: 4242, native_session_id: "probe-native" };
  const secondProject = { ...project, id: "p2", name: "Another project", canonical_path: "/workspace/another" };
  const secondSession = { ...session, id: "s2", project_id: "p2", display_name: "Another session", native_session_id: "probe-native-2" };
  await page.routeWebSocket(`${origin.replace("http", "ws")}/api/sessions/*/terminal?*`, (socket) => {
    terminalSocket = socket;
    socket.send(JSON.stringify({ type: "attached", token: 7, generation: 1 }));
    socket.send(JSON.stringify({ type: "output", data: Buffer.from(`Tutorial probe ${new URL(socket.url()).pathname}\r\n`).toString("base64") }));
  });
  await page.route(`${origin}/auth/session`, (route) => route.fulfill({ status: 204, headers: { "X-Noisedeck-Auth-Mode": "builtin" } }));
  await page.route(`${origin}/auth/logout`, (route) => route.fulfill({ status: 204 }));
  await page.route(`${origin}/api/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/settings/tutorial") {
      if (request.method() === "GET") {
        if (holdRead) await new Promise((resolve) => { releaseRead = resolve; });
        return json(record ? 200 : 404, record ?? { code: "not_found" });
      }
      assert.equal(request.method(), "PUT");
      assert.equal(request.headers()["x-csrf-token"], "probe");
      writes.push(request.postDataJSON());
      if (holdWrite) await new Promise((resolve) => { releaseWrite = resolve; writeStarted?.(); });
      if (failWrites) return json(503, { code: "unavailable", message: "Preference write unavailable" });
      record = { ...request.postDataJSON(), scope: "operator" };
      return json(200, record);
    }
    if (path === "/api/git-identities" && request.method() === "POST") {
      identityWrites++;
      assert.deepEqual(request.postDataJSON(), { name: identity.name, email: identity.email });
      identityReady = true;
      return json(201, identity);
    }
    if (path === "/api/settings/layout" && request.method() === "PUT") return json(200, request.postDataJSON());
    // The project/session switch lesson clicks rows, and a row click is the
    // operator choosing a session: that choice is remembered on the server.
    if (path === "/api/settings/last-session" && request.method() === "PUT") return json(200, request.postDataJSON());
    assert.equal(request.method(), "GET", `tutorial caused unexpected mutation ${path}`);
    if (path === "/api/settings") return json(200, { skip_permissions: false, skip_close_confirm: false, skip_remove_project_confirm: false });
    if (path === "/api/settings/layout") return json(404, { code: "not_found" });
    if (path === "/api/settings/last-session") return json(404, { code: "not_found", message: "no last session remembered" });
    if (path === "/api/projects") return json(200, [project, secondProject]);
    if (path.endsWith("/sessions")) return json(200, hasSession ? [path.includes("/p2/") ? secondSession : session] : []);
    if (path === "/api/sessions/s1") return json(200, session);
    if (path === "/api/sessions/s2") return json(200, secondSession);
    if (path.endsWith("/chats") && path.startsWith("/api/sessions/")) return json(200, { agent: "probe", chats: [] });
    if (path === "/api/providers") return json(200, { providers: [] });
    if (path === "/api/harness-usage") return json(200, { global: [], project: [] });
    if (path === "/api/harness-login" && request.method() === "GET") return json(200, { pending: [] });
    if (path === "/api/git-identities") return json(200, { profiles: identityReady ? [identity] : [], default_profile_id: identityReady ? identity.id : null, revision: 1 });
    if (path.endsWith("/events")) return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": connected\n\nretry: 3600000\n\n" });
    if (path.endsWith("/files")) return json(200, { path: "", at_root: true, entries: [] });
    if (path.includes("/taskmaster")) return json(404, { code: "not_taskmaster_project", message: "Not a Tasks project" });
    if (path === "/api/chats") return json(200, { chats: [] });
    throw new Error(`unhandled ${path}`);
  });
  const panel = page.locator('[data-region="tutorial"]');
  const open = () => panel.getAttribute("data-open");
  const clickSave = (button, keyboard = false) => Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/settings/tutorial") && r.request().method() === "PUT"),
    keyboard ? button.press("Enter") : button.click(),
  ]);
  const show = async () => {
    await page.locator("[data-live-more]").click();
    await clickSave(page.getByRole("button", { name: "Show tutorial", exact: true }));
    await panel.waitFor({ state: "visible" });
  };
  await page.goto(origin, { waitUntil: "networkidle" });
  const setup = page.getByRole("dialog", { name: "Git identity", exact: true });
  await setup.waitFor();
  assert.equal(writes.length, 0, "tutorial does not write before the first-user setup gesture");
  await setup.getByRole("textbox", { name: "Git author name", exact: true }).fill(identity.name);
  await setup.getByRole("textbox", { name: "Git author email", exact: true }).fill(identity.email);
  await setup.getByRole("button", { name: "Save identity", exact: true }).click();
  await setup.waitFor({ state: "hidden" });
  assert.equal(identityWrites, 1);
  await panel.waitFor({ state: "visible" });
  if (process.env.TUTORIAL_CAPTURE) await page.screenshot({ path: `/workspace/deck/build/tutorial-${process.env.TUTORIAL_CAPTURE}-desktop.png` });
  assert.equal(await open(), "true", "first use opens even with existing projects");
  assert.equal(Math.round((await panel.boundingBox()).width), 360);
  assert.equal(await panel.evaluate((el) => el.contains(document.activeElement)), false, "automatic opening leaves focus alone");
  assert.ok((await panel.ariaSnapshot()).includes('heading "Tutorial"'));
  await clickSave(panel.getByRole("button", { name: "Next", exact: true }), true);
  await clickSave(panel.getByRole("button", { name: "Back", exact: true }), true);
  // A save repaint replaces the buttons; query focus within the stable panel.
  assert.equal(await panel.evaluate((el) => el.querySelector('[data-tutorial-action="next"]') === document.activeElement), true,
    "Back at the first step restores keyboard focus to Next");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector(".tutorial-lesson")?.textContent?.includes("Step 2"));
  await clickSave(panel.getByRole("button", { name: "Close tutorial", exact: true }));
  await page.waitForFunction(() => document.querySelector('[data-region="tutorial"]').getAttribute("data-open") === "false");
  assert.equal(await page.locator("[data-live-more]").evaluate((el) => el === document.activeElement), true, "Close restores focus to the global menu trigger");
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await open(), "false", "Close persists across reload");
  await show();
  assert.equal(record.step, 1, "manual reopen restores the saved step");
  const writesBeforePanels = writes.length;
  for (const name of ["files", "tasks"]) {
    await page.locator(`[data-live-${name}]`).click();
    const host = page.locator(`[data-region="${name}"][data-open="true"]`);
    await host.waitFor();
    assert.equal(await open(), "false", `opening ${name} hides the tutorial`);
    assert.equal(await page.locator("[data-tutorial-bar]").count(), 0, "no lesson bar is mounted in any panel");
    assert.equal(await host.locator("[data-tutorial-action]").count(), 0, `${name} shows no tutorial progress or help entry`);
    await page.locator(`[data-live-${name}]`).click();
    await page.waitForFunction((region) => document.querySelector(`[data-region="${region}"]`)?.getAttribute("data-open") === "false", name);
    assert.equal(await open(), "true", `closing ${name} restores the tutorial`);
    assert.equal(record.step, 1, "panel docking preserves the saved step");
  }
  assert.equal(writes.length, writesBeforePanels, "panel docking never writes progress");
  await panel.getByRole("button", { name: "All lessons", exact: true }).press("Enter");
  await clickSave(panel.getByRole("button", { name: "Finding your way", exact: true }), true);
  await clickSave(panel.getByRole("button", { name: "Next", exact: true }), true);
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  if (process.env.TUTORIAL_CAPTURE) await page.screenshot({ path: `/workspace/deck/build/tutorial-${process.env.TUTORIAL_CAPTURE}-mobile.png` });
  const mobileGeometry = await page.waitForFunction(() => {
    const panel = document.querySelector('[data-tutorial-mobile="true"] [data-region="tutorial"]');
    const header = panel?.querySelector(".tutorial-header")?.getBoundingClientRect();
    const close = panel?.querySelector('[aria-label="Close tutorial"]')?.getBoundingClientRect();
    if (!header?.width || !header.height || !close?.width || !close.height) return null;
    return {
      header: { y: header.y, height: header.height },
      close: { y: close.y, width: close.width, height: close.height },
    };
  });
  const { header: mobileHeader, close: mobileClose } = await mobileGeometry.jsonValue();
  assert.ok(mobileClose.width >= 36 && mobileClose.height >= 36, "mobile close target retains its size");
  assert.ok(mobileClose.y >= mobileHeader.y && mobileClose.y + mobileClose.height <= mobileHeader.y + mobileHeader.height,
    "mobile close target stays inside the sheet header");
  const beforeCollapse = writes.length;
  await panel.getByRole("button", { name: "Collapse tutorial", exact: true }).click();
  await page.locator('[data-region="tutorial-mobile-bar"]').waitFor({ state: "visible" });
  assert.equal(writes.length, beforeCollapse, "Collapse does not persist dismissal");
  await page.getByRole("button", { name: "Panels", exact: true }).click();
  await page.getByRole("menuitem", { name: "Files", exact: true }).click();
  const mobileFiles = page.locator('[data-region="files"][data-open="true"]');
  await mobileFiles.waitFor();
  await page.locator('[data-region="tutorial-mobile-bar"]').waitFor({ state: "hidden" });
  await panel.waitFor({ state: "hidden" });
  await mobileFiles.getByRole("button", { name: "Close files", exact: true }).click();
  await page.locator('[data-region="tutorial-mobile-bar"]').waitFor({ state: "visible" });
  assert.equal(await open(), "false", "closing another panel preserves explicit mobile collapse");
  assert.equal(writes.length, beforeCollapse, "temporarily hiding a collapsed tutorial does not save dismissal");
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await open(), "true", "Collapse resets on reload");
  failWrites = true;
  await clickSave(panel.getByRole("button", { name: "Close tutorial", exact: true }));
  await page.locator('[data-region="tutorial-notice"]').waitFor({ state: "visible" });
  assert.equal(await open(), "false", "failed save is reported after the panel closes");
  failWrites = false;
  hasSession = true;
  holdRead = true;
  record = { version: 1, dismissed: false, lesson: "navigation", step: 1, done: ["welcome"], scope: "operator" };
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload({ waitUntil: "domcontentloaded" });
  const expandSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
  if (await expandSidebar.isVisible()) await expandSidebar.click();
  await page.locator('[data-session="s1"]').click();
  await page.waitForFunction(() => document.querySelector("[data-live-terminal] .xterm-rows")?.textContent?.includes("Tutorial probe"));
  const writesBeforeLoss = writes.length;
  terminalSocket.send(JSON.stringify({ type: "error", code: "fenced", message: "Another controller took over" }));
  await page.getByRole("button", { name: "Reconnect", exact: true }).waitFor();
  await page.locator("[data-live-more]").click();
  await page.getByRole("button", { name: "Show tutorial", exact: true }).click();
  assert.equal(await open(), "false", "Show tutorial is ignored while control is suspended");
  holdRead = false;
  releaseRead();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await open(), "false", "controller loss fences the delayed preferences read");
  assert.equal(writes.length, writesBeforeLoss);
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await panel.waitFor({ state: "visible" });
  assert.equal(await open(), "true", "regaining control re-reads preferences");
  assert.equal(await panel.evaluate((el) => el.contains(document.activeElement)), false,
    "ignored Show tutorial does not steal focus after reconnect");
  const dividerMeasurements = [];
  for (const density of ["normal", "compact", "comfortable"]) {
    await page.evaluate((value) => {
      if (value === "normal") document.documentElement.removeAttribute("data-density");
      else document.documentElement.dataset.density = value;
    }, density);
    const tutorialGeometry = await panel.locator(".tutorial-header").evaluate((header) => {
      const box = header.getBoundingClientRect();
      const terminal = document.querySelector("[data-workspace-titlebar]").getBoundingClientRect();
      const controlsFit = [...header.querySelectorAll("button")].filter((button) => button.getClientRects().length)
        .every((button) => {
          const control = button.getBoundingClientRect();
          return control.top >= box.top && control.bottom <= box.bottom && control.left >= box.left && control.right <= box.right;
        });
      return { tutorial: box.bottom, terminal: terminal.bottom, height: box.height, controlsFit };
    });
    assert.ok(Math.abs(tutorialGeometry.tutorial - tutorialGeometry.terminal) <= 0.5,
      `${density}: tutorial divider ${tutorialGeometry.tutorial} aligns with terminal ${tutorialGeometry.terminal}`);
    assert.ok(tutorialGeometry.controlsFit, `${density}: tutorial header controls fit without clipping`);
    await clickSave(panel.getByRole("button", { name: "Close tutorial", exact: true }));
    const panels = {};
    for (const [name, header] of [["files", "[data-files-header]"], ["tasks", "[data-tm-header]"], ["chats", "[data-chats-header]"]]) {
      await page.locator(`[data-live-${name}]`).click();
      const dock = page.locator(`[data-region="${name}"][data-open="true"]`);
      await dock.waitFor();
      const measured = await page.waitForFunction((selector) => {
        const box = document.querySelector(selector)?.getBoundingClientRect();
        return box && box.height > 0 ? box.bottom : false;
      }, `[data-region="${name}"][data-open="true"] ${header}`);
      const bottom = await measured.jsonValue();
      await measured.dispose();
      assert.ok(Math.abs(tutorialGeometry.tutorial - bottom) <= 0.5,
        `${density}: tutorial divider ${tutorialGeometry.tutorial} aligns with ${name} ${bottom}`);
      panels[name] = bottom;
      await page.locator(`[data-live-${name}]`).click();
      await dock.waitFor({ state: "hidden" });
    }
    await show();
    dividerMeasurements.push({ density, ...tutorialGeometry, panels });
  }
  await page.evaluate(() => { delete document.documentElement.dataset.density; });
  console.log("tutorial divider geometry:", JSON.stringify(dividerMeasurements));
  const writesBeforeChats = writes.length;
  await page.locator("[data-live-chats]").click();
  await page.locator('[data-region="chats"][data-open="true"]').waitFor();
  assert.equal(await open(), "false", "opening Chats hides the tutorial");
  assert.equal(await page.locator("[data-tutorial-bar]").count(), 0, "Chats mounts no tutorial bar");
  assert.equal(await page.locator('[data-region="chats"]').locator("[data-tutorial-action]").count(), 0, "Chats shows no tutorial progress or help entry");
  await page.locator("[data-live-chats]").click();
  await page.waitForFunction(() => document.querySelector('[data-region="chats"]')?.getAttribute("data-open") === "false");
  assert.equal(await open(), "true", "closing Chats restores the tutorial");
  assert.equal(writes.length, writesBeforeChats, "Chats docking never writes progress");
  const writesBeforeSwitch = writes.length;
  const secondToggle = page.locator('[data-project-toggle="p2"]');
  if (await secondToggle.getAttribute("aria-expanded") !== "true") await secondToggle.click();
  await page.locator('[data-session="s2"]').click();
  await page.waitForFunction(() => document.querySelector("[data-live-terminal] .xterm-rows")?.textContent?.includes("/s2/terminal"));
  assert.equal(await open(), "true");
  assert.ok((await panel.innerText()).includes("Finding your way"));
  assert.equal(record.step, 1);
  assert.equal(writes.length, writesBeforeSwitch, "switching projects and sessions preserves progress without a write");
  const collapseSidebar = page.getByRole("button", { name: "Collapse sidebar", exact: true });
  if (await collapseSidebar.isVisible()) await collapseSidebar.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const sheet = document.querySelector('[data-region="tutorial"]').getBoundingClientRect();
    const dock = document.querySelector('[data-region="terminal-dock"]').getBoundingClientRect();
    return dock.height > 0 && sheet.bottom <= dock.top + 1;
  });
  if (process.env.TUTORIAL_CAPTURE) await page.screenshot({ path: `/workspace/deck/build/tutorial-${process.env.TUTORIAL_CAPTURE}-mobile-session.png` });
  await panel.getByRole("button", { name: "Collapse tutorial", exact: true }).click();
  const lessonBar = page.locator('[data-region="tutorial-mobile-bar"]');
  await lessonBar.waitFor({ state: "visible" });
  assert.ok((await lessonBar.boundingBox()).y < (await page.locator('[data-region="terminal-soft-keys"]').boundingBox()).y);
  await lessonBar.getByRole("button", { name: "Show step", exact: true }).click();
  assert.equal(writes.length, writesBeforeSwitch, "mobile sheet and bar navigation do not write progress");
  holdWrite = true;
  const started = new Promise((resolve) => { writeStarted = resolve; });
  await panel.getByRole("button", { name: "Next", exact: true }).click();
  await started;
  await page.locator("[data-live-more]").click();
  await page.locator("[data-live-logout]").click();
  await panel.waitFor({ state: "detached" });
  releaseWrite();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('[data-region="tutorial"]').count(), 0, "late save cannot remount after auth teardown");
  assert.equal(writes.length, writesBeforeSwitch + 1);
  assert.equal(identityWrites, 1);
  assert.deepEqual(errors, []);
  console.log("ok: first-use, persistent close, restored progress, dock handoff, mobile collapse, failed write, controller loss, project/session switch, auth teardown");
  await context.close();
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}

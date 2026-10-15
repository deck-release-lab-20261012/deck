// First-project creation, native-console gestures, and verified resume in the live workspace.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const captureDir = resolve(process.env.TUTORIAL_PROJECT_CAPTURE_DIR ?? fileURLToPath(new URL("../../build", import.meta.url)));
if (process.env.TUTORIAL_PROJECT_CAPTURE) await mkdir(captureDir, { recursive: true });

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
  const { firstProjectTask } = await import("../src/app/tutorial-first-project.ts");
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: "noisedeck_csrf", value: "probe", url: origin }]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const identity = { id: "identity", name: "Tutorial probe", email: "probe@example.invalid", revision: 1 };
  const foreign = { id: "other", name: "Existing project", canonical_path: "/workspace/other", last_used_at: "t", git_identity_setup_revision: 1 };
  const project = { ...foreign, id: "tutorial", name: "reading-list-new", canonical_path: "/workspace/reading-list-new" };
  const lost = { ...foreign, id: "lost", name: "reading-list-lost", canonical_path: "/workspace/reading-list-lost" };
  const partial = { ...foreign, id: "partial", name: "reading-list-partial", canonical_path: "/workspace/reading-list-partial" };
  const partialFiles = new Map();
  const session = { id: "other-session", project_id: foreign.id, provider: "claude", display_name: "Existing console", status: "running", presentation_state: "running", generation: 1, created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z", recovery_capability: "none", recovery_state: "unavailable", tmux_pane_id: "%1", pane_pid: 4242, native_session_id: "fixture" };
  const recoverySession = { ...session, id: "recovery-session", display_name: "Recovery console", presentation_state: "attachment_unavailable" };
  const sessions = [recoverySession, session];
  let releaseSeed;
  const seedGate = new Promise((resolve) => { releaseSeed = resolve; });
  let seedHeld = false;
  let reportSeedStarted;
  const seedStarted = new Promise((resolve) => { reportSeedStarted = resolve; });
  let projects = [foreign];
  let preference = null;
  const files = new Map();
  let task = null;
  let reachable = false;
  const mutations = [];
  const requests = [];
  const inputs = [];
  const terminalConnections = new Map();
  let nextLoginHint = false;
  let holdNextCreate = false;
  let heldCreation = null;
  let holdNextAttach = false;
  let heldAttach = null;
  let terminalSocket;
  await page.routeWebSocket(`${origin.replace("http", "ws")}/api/sessions/*/terminal?*`, (socket) => {
    terminalSocket = socket;
    const id = new URL(socket.url()).pathname.split("/")[3];
    terminalConnections.set(id, (terminalConnections.get(id) ?? 0) + 1);
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type === "input") inputs.push({ session: new URL(socket.url()).pathname, ...frame });
    });
    const attach = () => {
      socket.send(JSON.stringify({ type: "attached", token: 7, generation: 1 }));
      socket.send(JSON.stringify({ type: "output", data: Buffer.from("Tutorial console ready\r\n").toString("base64") }));
    };
    if (holdNextAttach) { holdNextAttach = false; heldAttach = { id, attach }; }
    else attach();
  });
  await page.route(`${origin}/auth/session`, (route) => route.fulfill({ status: 204, headers: { "X-Noisedeck-Auth-Mode": "builtin" } }));
  await page.route(`${origin}/api/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    requests.push({ method, path });
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (method !== "GET") {
      assert.equal(request.headers()["x-csrf-token"], "probe");
      if (!path.startsWith("/api/settings/")) mutations.push({ method, path });
    }
    if (path === "/api/settings/tutorial") {
      if (method === "PUT") preference = { ...request.postDataJSON(), scope: "operator" };
      return json(preference ? 200 : 404, preference ?? { code: "not_found" });
    }
    if (path === "/api/settings/layout") return json(method === "PUT" ? 200 : 404, method === "PUT" ? request.postDataJSON() : { code: "not_found" });
    if (path === "/api/settings/last-session") return json(method === "PUT" ? 200 : 404, method === "PUT" ? request.postDataJSON() : { code: "not_found" });
    if (path === "/api/settings") return json(200, { skip_permissions: false, skip_close_confirm: false, skip_remove_project_confirm: false });
    if (path === "/api/git-identities") return json(200, { profiles: [identity], default_profile_id: identity.id, revision: 1 });
    if (path === "/api/providers") return json(200, { providers: ["shell", "claude", "codex"] });
    if (path === "/api/harness-login" && method === "GET") {
      if (url.searchParams.get("watch") === "1") return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": connected\n\nretry: 3600000\n\n" });
      return json(200, { pending: [] });
    }
    if (path === "/api/harness-usage") return json(200, { global: [], project: [] });
    if (path === "/api/project-directories") return json(200, { current_path: "", parent_path: null, directories: [{ name: "workspace", path: "/workspace" }] });
    if (path === "/api/project-directories/mkdir") {
      if (request.postDataJSON().name === "existing") return json(409, { error: "duplicate_path", message: "Directory already exists" });
      const selected = [project, lost, partial].find(p => p.name === request.postDataJSON().name);
      assert.ok(selected);
      assert.deepEqual(request.postDataJSON(), { path: "/workspace", name: selected.name });
      return json(201, { path: selected.canonical_path });
    }
    if (path === "/api/projects") {
      if (method === "POST") {
        const selected = [project, lost, partial].find(p => p.canonical_path === request.postDataJSON().path);
        assert.ok(selected);
        projects.push(selected);
        return selected === lost ? json(500, { error: "lost_response", message: "Registration response lost" }) : json(201, selected);
      }
      return json(200, projects);
    }
    if ([`/api/projects/${project.id}`, `/api/projects/${partial.id}`].includes(path) && method === "DELETE") {
      projects = projects.filter((p) => p.id !== path.split("/").at(-1));
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith("/sessions") && path.startsWith("/api/projects/")) {
      const projectID = path.split("/")[3];
      if (method === "POST") {
        const created = { ...session, id: `tutorial-session-${sessions.length}`, project_id: projectID, provider: request.postDataJSON().provider, display_name: "Tutorial agent" };
        sessions.push(created);
        if (holdNextCreate) {
          holdNextCreate = false;
          await new Promise(resolve => { heldCreation = { session: created, release: resolve }; });
        }
        return json(201, { ...created, codex_login_helper: nextLoginHint });
      }
      return json(200, sessions.filter((s) => s.project_id === projectID));
    }
    if (path.startsWith("/api/sessions/") && !path.endsWith("/chats")) return json(200, sessions.find((s) => s.id === path.split("/")[3]));
    if (path.endsWith("/chats")) return json(200, path.startsWith("/api/sessions/") ? { agent: "fixture", chats: [] } : { chats: [] });
    if (path.endsWith("/events")) return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": connected\n\nretry: 3600000\n\n" });
    if (path.endsWith("/files")) {
      if (method === "POST") {
        const name = url.searchParams.get("path");
        if (path === `/api/projects/${partial.id}/files`) {
          partialFiles.set(name, request.postData());
          return json(500, { error: "lost_response", message: "Upload response lost" });
        }
        assert.equal(files.has(name), false, "starter files must never be overwritten");
        files.set(name, request.postData());
        if (!seedHeld) { seedHeld = true; reportSeedStarted(); await seedGate; }
        return json(201, { path: name, size: request.postData().length });
      }
      return json(200, { path: "", at_root: true, entries: [{ name: ".git", path: ".git", dir: true, mode: "drwx", mtime: "t" }] });
    }
    if (path.endsWith("/files/view")) return json(200, { content: files.get(url.searchParams.get("path")) ?? "" });
    if (path.endsWith("/taskmaster") && method === "POST") return json(200, { path: project.canonical_path, tag: "master", already_initialized: false });
    if (path.endsWith("/taskmaster/prds")) return json(method === "GET" ? 200 : 201, method === "GET" ? ["reading-list.md"] : {});
    if (path.endsWith("/taskmaster/tasks")) {
      if (method === "POST") { task = { ...request.postDataJSON(), id: "1", revision: 1, status: "pending" }; return json(201, { id: "1" }); }
      return json(200, { master: { tasks: task ? [task] : [] } });
    }
    if (path.endsWith("/taskmaster/tasks/1")) return json(200, task);
    if (path.endsWith("/taskmaster")) return json(task ? 200 : 404, task ? { path: project.canonical_path, docs_path: ".taskmaster/docs" } : { error: "not_taskmaster_project" });
    if (path.endsWith("/preview/check")) return json(200, { reachable, checked_at: "t" });
    if (path.endsWith("/preview/settings")) return json(200, { configured: true, self_service: true, enabled: true });
    throw new Error(`Unhandled ${method} ${path}`);
  });
  const panel = page.locator('[data-region="tutorial"]');
  const lesson = async (name) => {
    await panel.getByRole("button", { name: "All lessons", exact: true }).click();
    await panel.getByRole("button", { name, exact: true }).click();
  };
  const button = (name) => panel.getByRole("button", { name, exact: true });
  await page.goto(origin, { waitUntil: "networkidle" });
  await panel.waitFor({ state: "visible" });
  await page.locator('[data-session="recovery-session"]').click();
  await page.waitForFunction(() => document.querySelector('[data-session="recovery-session"]')?.getAttribute("aria-selected") === "true");
  await lesson("Create a reading list");
  await panel.getByLabel("Parent directory", { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('[data-tutorial-field="identity"]')?.options.length === 2);
  assert.equal(mutations.length, 0, "static curriculum causes no project mutations");
  assert.equal(await button("Create tutorial project").isEnabled(), true, "recovery-selected console leaves project setup available");
  await panel.getByLabel("New folder name", { exact: true }).fill("existing");
  await button("Create tutorial project").click();
  await panel.getByRole("alert").waitFor();
  assert.deepEqual(mutations.map((m) => m.path), ["/api/project-directories/mkdir"]);
  assert.equal(await button("Remove tutorial registration").isDisabled(), true);
  assert.ok(!(await panel.getByRole("alert").innerText()).includes("remove the registration"));
  await panel.getByLabel("New folder name", { exact: true }).fill(lost.name);
  await button("Create tutorial project").click();
  await panel.getByRole("alert").filter({ hasText: "Registration was not confirmed" }).waitFor();
  assert.equal(await button("Create tutorial project").isDisabled(), true);
  assert.equal(await button("Remove tutorial registration").isDisabled(), true);
  assert.equal(files.size, 0, "uncertain registration never sends starter files");
  assert.equal(projects.some(p => p.id === lost.id), true, "a rejected response can still leave registration behind");
  const beforeFreshChoice = requests.length;
  await button("Choose another folder").click();
  assert.equal(await panel.getByLabel("New folder name", { exact: true }).inputValue(), "");
  assert.equal(await button("Create tutorial project").isEnabled(), true);
  assert.equal(await button("Remove tutorial registration").isDisabled(), true);
  assert.equal(requests.length, beforeFreshChoice, "fresh choice performs zero API calls");
  assert.ok((await panel.innerText()).includes("Its registration is unknown"));
  await button("Create tutorial project").click();
  await panel.getByRole("alert").filter({ hasText: "Name the project" }).waitFor();
  assert.equal(requests.length, beforeFreshChoice, "empty new name requires another explicit choice");
  await panel.getByLabel("New folder name", { exact: true }).fill(partial.name);
  await button("Create tutorial project").click();
  await panel.getByRole("alert").filter({ hasText: "Upload response lost" }).waitFor();
  assert.equal(await button("Choose another folder").count(), 0, "registered partial keeps its cleanup target");
  assert.equal(await button("Remove tutorial registration").isEnabled(), true);
  assert.equal(partialFiles.size, 1);
  page.once("dialog", dialog => dialog.accept());
  await button("Remove tutorial registration").click();
  await panel.getByText("Sessions stopped and the project unregistered; the files remain in place.", { exact: true }).waitFor();
  assert.equal(partialFiles.size, 1, "explicit unregister leaves partially uploaded bytes intact");
  assert.equal(projects.some(p => p.id === lost.id), true, "unknown registration was never adopted or removed");
  await panel.getByLabel("New folder name", { exact: true }).fill(project.name);
  await button("Create tutorial project").click();
  await Promise.race([seedStarted, new Promise((_, reject) => setTimeout(() => reject(new Error("starter upload did not begin")), 10_000))]);
  await page.locator('[data-session="other-session"]').click();
  await page.waitForFunction(() => document.querySelector('[data-session="other-session"]')?.getAttribute("aria-selected") === "true");
  releaseSeed();
  await page.waitForFunction(() => document.querySelector('.tutorial-project')?.textContent?.includes("Task 1: pending"));
  assert.equal(files.size, 9);
  assert.equal([...files.keys()].at(-1), "tutorial.json", "completion manifest is the final file write");
  assert.equal(task.title, firstProjectTask.title);
  assert.equal(mutations.filter((m) => m.path.endsWith("/taskmaster/tasks")).length, 1);
  assert.equal(sessions.length, 2, "creation does not start a CLI");
  assert.match(files.get("LICENSE"), /Copyright \(c\) 2026 Doug Doan/, "new starter uploads the agreed license");
  if (process.env.TUTORIAL_PROJECT_CAPTURE) {
    await page.screenshot({ path: resolve(captureDir, `tutorial-project-${process.env.TUTORIAL_PROJECT_CAPTURE}-desktop.png`) });
  }
  await lesson("Make one change");
  if (process.env.TUTORIAL_PROJECT_CAPTURE) {
    await page.screenshot({ path: resolve(captureDir, `tutorial-project-${process.env.TUTORIAL_PROJECT_CAPTURE}-prompt-desktop.png`) });
  }
  await button("Insert into selected agent console").click();
  assert.equal(inputs.length, 0, "existing foreign console cannot receive the tutorial prompt");
  await lesson("Prepare your console");
  for (const [provider, hint, opensHelper] of [["shell", true, false], ["codex", false, false], ["codex", true, true]]) {
    nextLoginHint = hint;
    holdNextAttach = true;
    heldAttach = null;
    const beforeLaunch = sessions.length;
    if (provider === "shell") await button("Open tutorial shell").click();
    else {
      await panel.getByRole("combobox", { name: "Agent CLI", exact: true }).selectOption(provider);
      await button("Open agent console").click();
    }
    const untilAttached = Date.now() + 5000;
    while (heldAttach === null) {
      if (Date.now() > untilAttached) throw new Error(`No held attachment for tutorial ${provider}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(sessions.length, beforeLaunch + 1, "one tutorial gesture creates exactly one session");
    await page.locator("[data-live-terminal] .xterm").waitFor();
    const nativeHost = await page.locator("[data-live-terminal]").elementHandle();
    const nativeXterm = await page.locator("[data-live-terminal] .xterm").elementHandle();
    const helper = page.locator("[data-harness-login-dialog]");
    assert.equal(await helper.count(), 0, "tutorial login guidance waits for the attached controller");
    const listing = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === "/api/harness-login" && url.searchParams.get("session") === heldAttach.id && !url.searchParams.has("watch");
    });
    heldAttach.attach();
    await (await listing).finished();
    if (opensHelper) {
      await helper.waitFor({ state: "visible", timeout: 5000 });
      assert.equal(await nativeHost.evaluate(host => host.closest("[data-harness-login-dialog]") !== null), true);
      assert.equal(await page.evaluate(node => node === document.querySelector("[data-live-terminal] .xterm"), nativeXterm), true);
      if (process.env.TUTORIAL_PROJECT_CAPTURE) await page.screenshot({ path: resolve(captureDir, `tutorial-project-${process.env.TUTORIAL_PROJECT_CAPTURE}-codex-helper.png`) });
      await helper.locator("[data-login-later]").click();
      await helper.waitFor({ state: "detached" });
      assert.equal(await nativeHost.evaluate(host => host.isConnected && host.closest("[data-harness-login-dialog]") === null), true);
      await page.locator("[data-live-login]").click();
      await helper.waitFor({ state: "visible" });
      assert.equal(await page.evaluate(node => node === document.querySelector("[data-live-terminal] .xterm"), nativeXterm), true);
      await helper.locator("[data-login-later]").click();
      await helper.waitFor({ state: "detached" });
    } else {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await helper.count(), 0, `${provider} with hint=${hint} keeps its ordinary native console`);
      assert.equal(await page.locator("[data-live-login]").count(), 0);
    }
    assert.equal(terminalConnections.get(heldAttach.id), 1, "helper interactions keep the same terminal controller");
    assert.equal(inputs.length, 0, "tutorial launch and helper guidance never submit native input");
  }
  // Finishing creation must not undo a newer explicit session selection.
  holdNextCreate = true;
  nextLoginHint = true;
  const beforeDelayedLaunch = mutations.length;
  await panel.getByRole("combobox", { name: "Agent CLI", exact: true }).selectOption("codex");
  await button("Open agent console").click();
  const untilCreated = Date.now() + 5000;
  while (heldCreation === null) {
    if (Date.now() > untilCreated) throw new Error("Tutorial console creation was not held");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await page.locator('[data-session="other-session"]').click();
  await page.waitForFunction(() => document.querySelector('[data-session="other-session"]')?.getAttribute("aria-selected") === "true");
  await page.locator("[data-live-terminal] .xterm").waitFor();
  const newerTerminal = await page.locator("[data-live-terminal] .xterm").elementHandle();
  const newerConnections = terminalConnections.get("other-session");
  const creationResponse = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/projects/${project.id}/sessions`);
  heldCreation.release();
  await (await creationResponse).finished();
  await page.waitForFunction(() => document.querySelector('[data-tutorial-action="project-connect"]')?.disabled === false);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForLoadState("networkidle");
  assert.equal(await page.locator('[data-session="other-session"]').getAttribute("aria-selected"), "true", "a delayed tutorial launch preserves the user's newer session selection");
  assert.equal(await page.evaluate(node => node === document.querySelector("[data-live-terminal] .xterm"), newerTerminal), true, "the newer selected terminal remains mounted");
  assert.equal(terminalConnections.get("other-session"), newerConnections, "a late response does not reconnect the newer console");
  assert.equal(terminalConnections.get(heldCreation.session.id) ?? 0, 0, "the stale created session never acquires a terminal controller");
  assert.equal(await page.locator("[data-harness-login-dialog]").count(), 0, "a stale creation cannot open its login helper");
  assert.equal(await page.locator("[data-live-login]").count(), 0);
  assert.deepEqual(mutations.slice(beforeDelayedLaunch), [{ method: "POST", path: `/api/projects/${project.id}/sessions` }], "a stale creation is neither retried nor deleted");
  assert.equal(sessions.some(candidate => candidate.id === heldCreation.session.id), true, "the successfully created session remains available");
  assert.equal(inputs.length, 0, "a late tutorial launch never sends native input");

  for (const width of [1280, 390]) {
    if (width === 390) {
      const collapse = page.getByRole("button", { name: "Collapse sidebar", exact: true });
      if (await collapse.isVisible()) await collapse.click();
    }
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const guidance = panel.locator("p").filter({ hasText: "The Codex login helper keeps sign-in in the same terminal." });
    await guidance.scrollIntoViewIfNeeded();
    const text = await guidance.innerText();
    for (const phrase of ["keeps sign-in in the same terminal", "If OpenAI returns to a localhost error page", "copy that tab’s entire address and paste it only into the helper", "Use terminal instead closes the helper", "Open login helper brings it back"]) {
      assert.ok(text.includes(phrase), `Prepare your console explains ${phrase} at ${width}px`);
    }
    const geometry = await guidance.evaluate(element => {
      const paragraph = element.getBoundingClientRect();
      const body = element.closest(".tutorial-body").getBoundingClientRect();
      const footer = element.closest('[data-region="tutorial"]').querySelector("footer").getBoundingClientRect();
      return { top: paragraph.top, bottom: paragraph.bottom, left: paragraph.left, right: paragraph.right, bodyTop: body.top, bodyBottom: body.bottom, footerBottom: footer.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight };
    });
    assert.ok(geometry.top >= geometry.bodyTop - 1 && geometry.bottom <= geometry.bodyBottom + 1 && geometry.left >= 0 && geometry.right <= geometry.viewportWidth && geometry.footerBottom <= geometry.viewportHeight, `console guidance and navigation fit at ${width}px: ${JSON.stringify(geometry)}`);
    if (process.env.TUTORIAL_PROJECT_CAPTURE) await page.screenshot({ path: resolve(captureDir, `tutorial-project-${process.env.TUTORIAL_PROJECT_CAPTURE}-prepare-console-${width}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  nextLoginHint = false;
  await panel.getByRole("combobox", { name: "Agent CLI", exact: true }).selectOption("claude");
  await button("Open agent console").click();
  await page.waitForFunction(() => document.querySelector("[data-live-terminal] .xterm-rows")?.textContent?.includes("Tutorial console ready"));
  await lesson("Make one change");
  await button("Insert into selected agent console").click();
  await page.waitForTimeout(100);
  assert.equal(inputs.length, 1);
  assert.equal(Buffer.from(inputs[0].data, "base64").toString(), firstProjectTask.prompt);
  assert.equal(inputs[0].token, 7);
  assert.equal(inputs[0].generation, 1);
  const collapse = page.getByRole("button", { name: "Collapse sidebar", exact: true });
  if (await collapse.isVisible()) await collapse.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const mobileAction = await panel.evaluate((sheet) => {
    const action = sheet.querySelector('[data-tutorial-action="project-insert"]');
    const scroller = sheet.querySelector(".tutorial-body");
    const before = action.getBoundingClientRect();
    const body = scroller.getBoundingClientRect();
    scroller.scrollTop += before.top - body.top - (body.height - before.height) / 2;
    const button = action.getBoundingClientRect();
    const footer = sheet.querySelector("footer").getBoundingClientRect();
    return { top: button.top, bottom: button.bottom, height: button.height, body: body.top, footer: footer.top };
  });
  if (process.env.TUTORIAL_PROJECT_CAPTURE) await page.screenshot({ path: resolve(captureDir, `tutorial-project-${process.env.TUTORIAL_PROJECT_CAPTURE}-mobile.png`) });
  assert.ok(mobileAction.height > 0 && mobileAction.top >= mobileAction.body && mobileAction.bottom <= mobileAction.footer,
    `mobile action stays inside the scrolling body above navigation: ${JSON.stringify(mobileAction)}`);
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.equal(/[\r\n\x1b]/.test(Buffer.from(inputs[0].data, "base64").toString()), false);
  terminalSocket.send(JSON.stringify({ type: "error", code: "fenced", message: "Controller changed" }));
  await page.getByRole("button", { name: "Reconnect", exact: true }).waitFor();
  await page.evaluate(() => document.querySelector('[data-tutorial-action="project-insert"]')?.click());
  assert.equal(inputs.length, 1, "stale suspended controls cannot send a second prompt");
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await panel.waitFor({ state: "visible" });
  await lesson("Check the change");
  await button("Read current list.mjs").click();
  await panel.locator("pre").filter({ hasText: "export function unreadOnly" }).waitFor();
  await button("I ran the tests and reviewed the diff").click();
  assert.equal(task.status, "pending", "manual confirmation does not invent canonical task completion");
  await lesson("Try the reading list");
  await button("Enable project preview").click();
  await button("Check preview server").click();
  await panel.getByText("The preview server did not answer. Run the launcher in the tutorial shell.", { exact: true }).waitFor();
  reachable = true;
  await button("Check preview server").click();
  await panel.getByText("The preview server answered. Check the app behavior yourself.", { exact: true }).waitFor();
  await button("I checked the unread-only toggle").click();
  await lesson("Finish the task");
  assert.ok((await panel.innerText()).includes("noise tasks set-status --revision 1 1 done"));
  task = { ...task, status: "done", revision: 2 };
  await button("Refresh task status").click();
  await page.waitForFunction(() => document.querySelector('.tutorial-project')?.textContent?.includes("Task 1: done"));
  await page.reload({ waitUntil: "networkidle" });
  await lesson("Create a reading list");
  await page.waitForFunction(() => document.querySelector('[data-tutorial-field="resume"]')?.options.length === 4);
  await panel.getByRole("combobox", { name: "Existing tutorial project", exact: true }).selectOption(project.id);
  const beforeResume = mutations.length;
  await button("Verify and resume").click();
  await page.waitForFunction(() => document.querySelector('.tutorial-project')?.textContent?.includes("Task 1: done"));
  assert.equal(mutations.length, beforeResume, "verified resume reads without reseeding");
  page.once("dialog", (dialog) => dialog.accept());
  await button("Remove tutorial registration").click();
  await panel.getByText("Sessions stopped and the project unregistered; the files remain in place.", { exact: true }).waitFor();
  assert.deepEqual(projects.map((p) => p.id), [foreign.id, lost.id]);
  assert.equal(files.size, 9, "removal leaves sample files in place");
  assert.deepEqual(errors, []);
  console.log("ok: uncertain registration recovery, preserved partial files, recovery-selected setup, mid-create session switch, delayed console selection fence, desktop/phone login guidance, fresh-only sample, canonical task, exact unsubmitted fenced prompt, mobile action geometry, manual checks, preview facts, verified resume, scoped unregister");
  await context.close();
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}

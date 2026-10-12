// Exercise the shipped bundle, including first-use setup and the shared terminal.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { browser as connectBrowser } from "./browser.mjs";
const dist = resolve(import.meta.dirname, "../dist");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  const name = new URL(req.url, "http://fixture").pathname;
  const path = resolve(dist, "." + (name === "/" ? "/index.html" : name));
  if (!path.startsWith(dist + sep)) { res.writeHead(404).end(); return; }
  try { const bytes = await readFile(path); res.writeHead(200, { "Content-Type": mime[extname(path)] ?? "application/octet-stream" }).end(bytes); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  ({ browser } = await connectBrowser());
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    await context.addCookies([{ name: "noisedeck_csrf", value: "cookie-fixture", url: origin }]);
    const page = await context.newPage(), errors = [], frames = [];
    page.on("pageerror", error => errors.push(error.message));
    let starts = 0, cancels = 0, attempt = null, connections = 0;
    let status = { outcome: "no-account", active: false }, loseStart = false, identitySaved = false;
    let authMode = "trusted_proxy", statusReads = 0;
    const profile = { id: "identity", name: "Fixture", email: "fixture@example.invalid", revision: 1, created_at: "2026-09-23T00:00:00Z", updated_at: "2026-09-23T00:00:00Z" };
    await page.route(`${origin}/auth/session`, route => route.fulfill({ status: 204, headers: { "X-Noisedeck-Auth-Mode": authMode } }));
    await page.route(`${origin}/api/**`, async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      const json = (body, code = 200) => route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(body) });
      if (path === "/api/github/connect/status") { statusReads++; return json(status); }
      if (path === "/api/github/connect/attempt") return json({ csrf: "connect-fixture", attempt });
      if (path === "/api/github/connect/start" || path === "/api/github/connect/cancel") {
        assert.equal(request.method(), "POST");
        assert.equal(request.headers()["x-csrf-token"], "cookie-fixture");
        assert.equal(request.headers()["x-github-connect-csrf"], "connect-fixture");
        if (path.endsWith("/start")) {
          starts++;
          attempt = { id: `attempt-${starts}`, status: "running", generation: 1, started_at: "2026-09-23T00:00:00Z" };
          return loseStart ? route.abort("failed") : json(attempt);
        }
        assert.equal(request.postDataJSON().id, attempt.id);
        cancels++; attempt = { ...attempt, status: "cancelled" };
        return route.fulfill({ status: 204 });
      }
      if (path === "/api/settings") return json({ skip_permissions: false, skip_close_confirm: false, skip_remove_project_confirm: false });
      if (path === "/api/settings/tutorial") return json({}, 404);
      if (path === "/api/harness-login") return json({ pending: [], csrf: "fixture" });
      if (path === "/api/projects") return json([]);
      if (path === "/api/git-identities") {
        if (request.method() === "POST") { identitySaved = true; return json(profile, 201); }
        return json({ profiles: identitySaved ? [profile] : [], default_profile_id: identitySaved ? profile.id : null, revision: identitySaved ? 1 : 0 });
      }
      if (path === "/api/providers") return json({ providers: [] });
      if (path === "/api/session-activity/events") return route.fulfill({ contentType: "text/event-stream", body: ": fixture\n\n" });
      if (path === "/api/settings/sidebar-layout") return json({ expanded: [], projects: [], sessions: {} });
      return json({ error: "not_found", message: path }, 404);
    });
    await page.routeWebSocket(`${origin.replace("http", "ws")}/api/github/connect/attempt/*/terminal?*`, socket => {
      connections++;
      socket.send(JSON.stringify({ type: "attached", token: 17, generation: 1 }));
      socket.send(JSON.stringify({ type: "output", data: Buffer.from("Synthetic native GitHub login\r\n").toString("base64") }));
      socket.onMessage(raw => frames.push(JSON.parse(raw)));
    });
    await page.goto(origin, { waitUntil: "networkidle" });
    const identity = page.locator("[data-git-identity-onboarding]");
    await identity.waitFor();
    await identity.getByRole("button", { name: "Connect GitHub", exact: true }).click();
    const dialog = page.locator("[data-github-connect-dialog]");
    const start = dialog.locator("[data-github-start]"), read = dialog.locator("[data-github-read]");
    const close = () => dialog.locator("[data-github-close]").last().click();
    await start.waitFor({ state: "visible" });
    assert.equal(starts, 0, "opening before project/identity is read-only");
    assert.equal(identitySaved, false);
    await start.click();
    await dialog.locator(".xterm").waitFor();
    await page.waitForFunction(() => document.querySelector('[data-github-terminal-status]').textContent === "");
    assert.equal(starts, 1);
    assert.equal(await dialog.locator("[data-github-message]").isVisible(), false, "empty notice does not reserve space");
    assert.equal(await dialog.locator("[data-github-terminal-status]").isVisible(), false, "attached terminal hides empty status");
    if (process.env.NOISE_GITHUB_CAPTURE_DIR) {
      await mkdir(process.env.NOISE_GITHUB_CAPTURE_DIR, { recursive: true });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: resolve(process.env.NOISE_GITHUB_CAPTURE_DIR, `${process.env.NOISE_GITHUB_CAPTURE_LABEL ?? "build"}-${viewport.width > 600 ? "desktop" : "mobile"}-native.png`) });
    }
    const box = await dialog.boundingBox();
    assert.ok(box.width <= viewport.width && box.x >= 0, "dialog fits viewport");
    await dialog.locator(".xterm-helper-textarea").press("a");
    await page.waitForTimeout(100);
    assert.ok(frames.some(frame => frame.type === "input" && frame.token === 17 && frame.generation === 1), "native terminal keeps input fencing");
    await close();
    assert.equal(cancels, 0, "close preserves native attempt");
    assert.equal(await identity.evaluate(el => el.closest('[data-modal-host]').inert), false);
    await page.reload({ waitUntil: "networkidle" });
    await identity.getByRole("button", { name: "Connect GitHub", exact: true }).click();
    await dialog.locator(".xterm").waitFor();
    assert.equal(starts, 1, "reload reattaches without starting again");
    assert.ok(connections >= 2);
    status = { outcome: "authenticated", active: true, login: "fixture-user", state: "success", source: "stored", source_writeable: true };
    await read.click();
    await dialog.getByText("Connected to GitHub as fixture-user.", { exact: true }).waitFor();
    assert.equal(await start.isVisible(), false);
    await dialog.locator("[data-github-cancel]").click();
    await dialog.getByText("Sign-in was cancelled.", { exact: true }).waitFor();
    assert.equal(cancels, 1);
    status = { outcome: "auth-issue", active: true, state: "error", source: "environment", login: "fixture-user" };
    await read.click();
    await dialog.getByText("GitHub access comes from an environment credential.", { exact: false }).waitFor();
    assert.equal(await start.isVisible(), false);
    status = { outcome: "no-account", active: false }; attempt = null;
    await read.click(); await start.waitFor({ state: "visible" });
    loseStart = true; await start.click();
    await dialog.getByText("The change could not be confirmed.", { exact: false }).waitFor();
    assert.equal(starts, 2); assert.equal(await start.isVisible(), false);
    await read.click(); await dialog.locator(".xterm").waitFor();
    assert.equal(starts, 2, "ambiguous response is reconciled by read, never replayed");
    await close();
    await identity.getByRole("textbox", { name: "Git author name" }).fill(profile.name);
    await identity.getByRole("textbox", { name: "Git author email" }).fill(profile.email);
    await identity.getByRole("button", { name: "Save identity" }).click();
    await identity.waitFor({ state: "detached" });
    await page.locator("[data-live-more]").click();
    await page.getByRole("button", { name: "GitHub connection…", exact: true }).click();
    await dialog.waitFor();
    await close();
    authMode = "none";
    await page.reload({ waitUntil: "networkidle" });
    const readsBefore = statusReads;
    await page.locator("[data-live-more]").click();
    await page.getByRole("button", { name: "GitHub connection…", exact: true }).click();
    await dialog.getByText("Enable password, OIDC, or trusted-proxy authentication in Deck before connecting GitHub.", { exact: true }).waitFor();
    assert.equal(await start.isVisible(), false);
    assert.equal(statusReads, readsBefore, "unauthenticated mode explains prerequisite without attempting login");
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("GitHub built desktop/mobile: first-use, terminal, reload, cancel, environment, uncertainty and global reopen passed");
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }

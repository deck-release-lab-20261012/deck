// Focused real-browser probe for the first-run and legacy-project identity UX.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { browser as connectBrowser } from "./browser.mjs";
import { exactlyOnce } from "./eventually.mjs";

const port = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close(() => resolve(address.port));
  });
});
const origin = `http://127.0.0.1:${port}`;
let serverOutput = "";
const vite = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: new URL("..", import.meta.url), stdio: ["ignore", "pipe", "pipe"],
});
vite.stdout.on("data", (chunk) => { serverOutput += chunk; });
vite.stderr.on("data", (chunk) => { serverOutput += chunk; });

let browser;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(origin);
      if (response.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (attempt === 99) throw new Error(`Vite did not start:\n${serverOutput}`);
  }
  ({ browser } = await connectBrowser());
  const context = await browser.newContext({ viewport: { width: 1000, height: 760 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const profile = {
    id: "identity-1", name: "Deck Author", email: "deck@example.invalid", revision: 1,
    created_at: "2026-08-13T00:00:00Z", updated_at: "2026-08-13T00:00:00Z",
  };
  let catalog = { profiles: [], default_profile_id: null, revision: 0 };
  let setupRevision = 0;
  let setupCalls = 0;
  let launchCalls = 0;
  const project = () => ({
    id: "legacy-project", name: "legacy", canonical_path: "/workspace/legacy",
    git_identity_setup_revision: setupRevision, last_used_at: "2026-08-13T00:00:00Z",
    ...(setupRevision > 0 ? {
      git_author_name: profile.name, git_author_email: profile.email,
      git_identity_profile_id: profile.id, git_identity_profile_revision: profile.revision,
    } : {}),
  });

  await page.route(`${origin}/auth/session`, (route) => route.fulfill({
    status: 204, body: "", headers: { "X-Noisedeck-Auth-Mode": "trusted_proxy" },
  }));
  await page.route(`${origin}/api/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (request.method() === "GET" && path === "/api/settings/tutorial") return json(200, { version: 1, dismissed: true, lesson: "welcome", step: 0, done: [], scope: "operator" });
    if (request.method() === "GET" && path === "/api/settings") {
      return json(200, { skip_permissions: false, skip_close_confirm: false, skip_remove_project_confirm: false });
    }
    if (request.method() === "GET" && path === "/api/session-activity/events") {
      return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": connected\n\n" });
    }
    if (request.method() === "GET" && path === "/api/git-identities") return json(200, catalog);
    if (request.method() === "POST" && path === "/api/git-identities") {
      assert.deepEqual(request.postDataJSON(), { name: profile.name, email: profile.email });
      catalog = { profiles: [profile], default_profile_id: profile.id, revision: 1 };
      return json(201, profile);
    }
    if (request.method() === "GET" && path === "/api/projects") return json(200, [project()]);
    if (request.method() === "GET" && path === "/api/projects/legacy-project/sessions") return json(200, []);
    if (request.method() === "POST" && path === "/api/projects/legacy-project/sessions") {
      launchCalls++;
      assert.deepEqual(request.postDataJSON(), { provider: "cline" });
      if (setupRevision === 0) return json(409, { error: "git_identity_required", message: "Git identity setup is required" });
      return json(201, {
        id: "session-1", project_id: "legacy-project", provider: "cline", display_name: "",
        status: "starting", generation: 1, created_at: "2026-08-13T00:00:00Z", updated_at: "2026-08-13T00:00:00Z",
        recovery_capability: "none", recovery_state: "automatic_pending", presentation_state: "recovering",
      });
    }
    if (request.method() === "PUT" && path === "/api/projects/legacy-project/git-identity") {
      setupCalls++;
      const body = request.postDataJSON();
      assert.deepEqual(body, {
        profile_id: profile.id, expected_profile_revision: 1,
        expected_project_setup_revision: 0,
      });
      setupRevision = 1;
      // The write goes through and names what it overwrote; there is no
      // confirmation round trip to make.
      return json(200, {
        ...project(),
        replaced_git_identity: { name: "Repository Author", email: "repository@example.invalid" },
      });
    }
    if (request.method() === "GET" && path === "/api/providers") {
      // The probe launches cline through the provider picker, so the served
      // inventory must admit it.
      return json(200, { providers: ["cline"] });
    }
    return json(404, { error: "not_found", message: path });
  });

  await page.goto(origin, { waitUntil: "networkidle" });
  const onboarding = page.getByRole("dialog", { name: "Git identity" });
  await onboarding.waitFor();
  await onboarding.getByRole("textbox", { name: "Git author name" }).fill(profile.name);
  await onboarding.getByRole("textbox", { name: "Git author email" }).fill(profile.email);
  await onboarding.getByRole("button", { name: "Save identity" }).click();
  await onboarding.waitFor({ state: "detached" });

  // With an identity on file the settings row opens the manager, not the
  // form again.
  await page.locator("[data-live-more]").click();
  await page.locator("[data-more-popover]").waitFor();
  await page.getByRole("button", { name: "Git identity…" }).click();
  const manager = page.locator("[data-git-identity-settings]");
  await manager.waitFor();
  assert.equal(await page.locator("[data-git-identity-onboarding]").count(), 0,
    "the settings row reopened the first-visit form although an identity exists");
  await page.getByRole("dialog", { name: "Git identity" }).getByRole("button", { name: "Close" }).click();
  await manager.waitFor({ state: "detached" });

  // An expanded empty project also carries a "New session" row, so the name
  // alone matches two controls. The project row's + is the one inside the
  // row's action cluster.
  // The + cluster rests hidden and reveals on the row's hover; an
  // actionability hit-test alone never moves the pointer, so the probe
  // performs the operator's hover first.
  await page.locator("[data-project-actions] [data-new-session]").first()
    .locator("xpath=ancestor::li[1]").locator("[data-project-toggle]").hover();
  await page.locator("[data-project-actions] [data-new-session]").first().click();
  await page.locator('[data-new-session-provider="cline"]').click();
  const setup = page.getByRole("dialog", { name: "Choose git identity" });
  await setup.waitFor();
  // The DS select chrome (bp-selectwrap): the native picker glyph is
  // suppressed, the wrap paints the 15px chevron at the 14px trailing
  // inset, pointer-inert, and the select reserves 37px so the value never
  // runs under it. One representative select; all four share the recipe.
  {
    const select = setup.locator("[data-project-identity-profile]");
    const field = await select.evaluate((node) => {
      const s = getComputedStyle(node);
      return { appearance: s.appearance, paddingRight: s.paddingRight };
    });
    assert.equal(field.appearance, "none", "the native select glyph is suppressed");
    assert.equal(field.paddingRight, "37px", "the value reserves the DS trailing padding");
    const chevron = await select.evaluate((node) => {
      const wrap = node.parentElement;
      const svg = wrap?.querySelector("svg");
      if (!svg) return null;
      const wrapBox = wrap.getBoundingClientRect();
      const svgBox = svg.getBoundingClientRect();
      return {
        inset: Math.round(wrapBox.right - svgBox.right),
        size: svg.getAttribute("width"),
        pointer: getComputedStyle(svg.parentElement).pointerEvents,
      };
    });
    assert.ok(chevron !== null, "the selectwrap paints a chevron");
    assert.equal(chevron.size, "15", "the chevron is the 15px DS glyph");
    assert.equal(chevron.inset, 14, "the chevron sits at the 14px field inset");
    assert.equal(chevron.pointer, "none", "the chevron is pointer-inert");
  }
  assert.match(await setup.innerText(), /retry the requested cline session once/i);
  await setup.getByRole("button", { name: "Apply identity" }).click();
  await setup.waitFor({ state: "detached" });

  // The write is not gated on a confirmation, so the dialog closes on the
  // first apply; what it replaced is stated in the rail, where the operator
  // can read it and put the old value back by hand.
  const notice = page.locator("[data-identity-notice]");
  await notice.waitFor();
  assert.match(await notice.innerText(), /Repository Author/);
  assert.match(await notice.innerText(), /repository@example\.invalid/);
  assert.match(await notice.innerText(), /git config --local/);

  // The dialog detaches when its own PUT resolves; the launch the app retries
  // next is still in flight at that moment, so both counts are waited for
  // rather than read once.
  const counts = [
    { read: () => setupCalls, expected: 1, message: "the identity write takes exactly one request" },
    { read: () => launchCalls, expected: 2, message: "the requested provider launch is retried exactly once" },
  ];
  await exactlyOnce(counts);
  assert.deepEqual(pageErrors, []);
  console.log("Git identity onboarding, replaced-value report, and one-shot launch retry: PASS");
  await context.close();
} finally {
  if (browser !== undefined) await browser.close();
  vite.kill("SIGTERM");
}

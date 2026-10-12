// The login screen's browser probe. loginHtml is imported from source —
// it is the exact production renderer — and the probe pages dress its
// output in the built dist stylesheets, so what gets measured is the
// screen that ships, not a fixture that can drift from it.
//
// What only a browser can see, and what this probe therefore owns:
//   - the authorizing sweep runs under no-preference and freezes (not
//     flattens) under reduce;
//   - the card's geometry holds across the outbound ceremony: the
//     pending row reserves the Google action's slot;
//   - the denied panel parses into a header row plus a reason line with
//     the header on its own line. The unit suite asserts on strings; a
//     dropped closing tag passes every string check and only the parsed
//     DOM and the resulting boxes catch it.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { browser as getBrowser } from "./browser.mjs";
import { loginHtml } from "../src/app/login.ts";

const dist = resolve(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "index.html"))) {
  throw new Error("dist/index.html is missing — run pnpm build first");
}

// The stylesheets in the order the real index.html links them, so the
// cascade under measurement is the shipped one.
const stylesheetHrefs = [...(await readFile(join(dist, "index.html"), "utf8"))
  .matchAll(/href="(\/assets\/[^"]+\.css)"/g)].map((m) => m[1]);
if (stylesheetHrefs.length === 0) throw new Error("dist/index.html links no stylesheets");

const views = {
  idle: () => loginHtml({ mode: "oidc", state: "signed-out" }),
  away: () => loginHtml({ mode: "oidc", state: "authorizing" }),
  denied: () => loginHtml({ mode: "builtin", state: "denied", deniedEmail: "refused@evil.test" }),
};

const mime = {
  ".css": "text/css", ".html": "text/html", ".js": "text/javascript",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const view = /^\/probe\/([a-z]+)$/.exec(url.pathname);
  if (view && views[view[1]]) {
    const head = stylesheetHrefs.map((href) => `<link rel="stylesheet" href="${href}">`).join("");
    // data-theme rides on <html> in production (main.ts sets it before
    // anything renders); without it the card's surface colours never
    // resolve against the dark ramp.
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html><html lang="en" data-theme="dark"><head>${head}</head><body>${views[view[1]]()}</body></html>`);
    return;
  }
  const path = join(dist, url.pathname);
  if (!path.startsWith(dist) || !existsSync(path)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": mime[extname(path)] ?? "application/octet-stream" });
  res.end(await readFile(path));
});
await new Promise((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
const origin = `http://127.0.0.1:${server.address().port}`;

const settle = (page) => page.evaluate(() => document.fonts.ready);

const box = (page, selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}, selector);

const rowStyle = (page, prop) => page.evaluate((p) => {
  const rows = document.querySelectorAll("svg.nfmark .nfrow");
  return [...rows].map((row) => getComputedStyle(row)[p]);
}, prop);

// Samples one row's computed opacity over time; an infinite wave is at
// a different phase on every sample, so a static value can only mean the
// animation is not running.
async function sampleRow(page, index, times, gapMs) {
  const samples = [];
  for (let i = 0; i < times; i++) {
    samples.push(parseFloat(await page.evaluate((idx) => {
      const rows = document.querySelectorAll("svg.nfmark .nfrow");
      return getComputedStyle(rows[idx]).opacity;
    }, index)));
    if (i < times - 1) await page.waitForTimeout(gapMs);
  }
  return samples;
}

let browser;
try {
  ({ browser } = await getBrowser());

  // Geometry first, at the desktop size where the card is widest and a
  // collapse is most visible: the card must not shrink and the sweeping mark
  // must not move when the Google action gives way to the pending row.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });
  const page = await ctx.newPage();

  await page.goto(`${origin}/probe/idle`, { waitUntil: "networkidle" });
  await settle(page);
  const idleCard = await box(page, "section");
  const idleMark = await box(page, "svg.nfmark");
  const idleButton = await box(page, "[data-login-google]");
  assert.ok(idleCard && idleMark && idleButton, "the idle screen renders card, mark, and button");
  assert.deepEqual(await rowStyle(page, "animationName"), Array(5).fill("none"),
    "the resting mark does not animate");

  await page.goto(`${origin}/probe/away`, { waitUntil: "networkidle" });
  await settle(page);
  const awayCard = await box(page, "section");
  const awayMark = await box(page, "svg.nfmark");
  const pending = await box(page, "[data-login-pending]");
  assert.ok(pending, "the authorizing state reserves the action row");
  assert.ok(Math.abs(awayCard.height - idleCard.height) < 0.5,
    `the card must not change height across the ceremony: idle ${idleCard.height}px, authorizing ${awayCard.height}px`);
  assert.equal(awayCard.width, idleCard.width, "the card must not change width across the ceremony");
  assert.ok(Math.abs(awayMark.y - idleMark.y) < 0.5,
    `the sweeping mark must not move: idle y ${idleMark.y}px, authorizing y ${awayMark.y}px`);
  assert.ok(Math.abs(pending.height - idleButton.height) < 0.5 && Math.abs(pending.width - idleButton.width) < 0.5,
    `the pending row reserves the button's slot: button ${idleButton.width}x${idleButton.height}, reserved ${pending.width}x${pending.height}`);

  // The sweep itself: all five rows carry it and at least one row's
  // opacity visibly travels.
  assert.deepEqual(await rowStyle(page, "animationName"), Array(5).fill("nfsweep"),
    "every row carries the sweep while the ceremony is away");
  const swing = await sampleRow(page, 4, 4, 400);
  assert.ok(Math.max(...swing) - Math.min(...swing) > 0.05,
    `the mark must visibly sweep under no-preference; opacities sampled ${swing.join(", ")}`);

  // The denied panel: parse the real DOM, then read the boxes it lays
  // out. A missing closing tag nests the reason inside the header's flex
  // row, which squeezes the label onto two lines.
  await page.goto(`${origin}/probe/denied`, { waitUntil: "networkidle" });
  await settle(page);
  const denied = await page.evaluate(() => {
    const label = [...document.querySelectorAll("span")]
      .find((s) => s.textContent === "Access denied");
    const reason = [...document.querySelectorAll("span")]
      .find((s) => s.textContent.includes("is not a member of this workspace"));
    if (!label || !reason) return null;
    const header = label.parentElement;
    const headerBox = header.getBoundingClientRect();
    const labelBox = label.getBoundingClientRect();
    const reasonBox = reason.getBoundingClientRect();
    return {
      siblings: header.parentElement === reason.parentElement,
      headerOwnLine: headerBox.bottom <= reasonBox.top + 0.5,
      labelOneLine: labelBox.height <= 23,
    };
  });
  assert.ok(denied, "the denied panel renders its header label and its reason");
  assert.equal(denied.siblings, true,
    "the reason must be a sibling of the header row, not nested inside it");
  assert.equal(denied.headerOwnLine, true, "the header sits on its own line above the reason");
  assert.equal(denied.labelOneLine, true,
    "'Access denied' renders as one line, not squeezed inside the header's flex row");

  await ctx.close();

  // Reduced motion: the wave must stop without flattening — each row
  // frozen at its own phase offset, bottom row brightest.
  const reduced = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const reducePage = await reduced.newPage();
  await reducePage.goto(`${origin}/probe/away`, { waitUntil: "networkidle" });
  await settle(reducePage);
  assert.deepEqual(await rowStyle(reducePage, "animationName"), Array(5).fill("none"),
    "no row animates under prefers-reduced-motion");
  const frozen = await sampleRow(reducePage, 0, 3, 400);
  assert.ok(frozen.every((o) => o === frozen[0]),
    `under reduce the mark is frozen, but its opacity moved: ${frozen.join(", ")}`);
  const still = (await rowStyle(reducePage, "opacity")).map(Number);
  assert.ok(still[0] < still[1] && still[1] < still[2] && still[2] < still[3] && still[3] < still[4] && still[4] === 1,
    `the freeze holds each row at its phase offset, bottom row brightest: ${still.join(", ")}`);
  await reduced.close();

  console.log("login: sweep, reduced-motion freeze, ceremony geometry, and denied panel PASS");
} finally {
  await browser?.close();
  server.close();
}

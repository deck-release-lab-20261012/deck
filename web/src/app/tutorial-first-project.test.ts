import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, connect } from "node:net";
import { firstProjectSampleFiles, firstProjectTask, firstProjectCatalog } from "./tutorial-first-project.ts";
import { once } from "node:events";

// The starter bundle's contract, exercised against real node processes:
// the shipped list.mjs fails exactly one behavior, the intended fix makes
// the suite pass, and serve.mjs answers only the public assets.

async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address() as { port: number };
  probe.close();
  await once(probe, "close");
  return port;
}

function runTests(dir: string): { pass: number; fail: number } {
  // The parent runner marks its own environment; a child that inherits it
  // refuses to run ("run() is being called recursively"), so strip the mark.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "NODE_TEST_CONTEXT" && key !== "NODE_OPTIONS"));
  const run = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "list.test.mjs"], { cwd: dir, encoding: "utf8", env });
  const pass = /^# pass (\d+)$/m.exec(run.stdout)?.[1];
  const fail = /^# fail (\d+)$/m.exec(run.stdout)?.[1];
  assert.notEqual(pass, undefined, `test summary missing from output:\n${run.stdout}${run.stderr}`);
  return { pass: Number(pass), fail: Number(fail ?? "0") };
}

// Sends a request line fetch cannot express (fetch normalizes ../ away)
// and resolves with the response's status line.
async function rawRequest(port: number, target: string): Promise<string> {
  const socket = connect(port, "127.0.0.1");
  socket.setEncoding("utf8");
  socket.write(`GET ${target} HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n`);
  let response = "";
  for await (const chunk of socket) response += String(chunk ?? "");
  return response.split("\r\n", 1)[0] ?? "";
}

async function waitForListening(proc: { stdout: NodeJS.ReadableStream | null }): Promise<void> {
  for await (const chunk of proc.stdout ?? []) {
    if (/listening on http:\/\/127\.0\.0\.1:\d+/.test(String(chunk))) return;
  }
}

test("starter bundle ships one failing behavior and the intended fix passes", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "deck-first-project-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const file of firstProjectSampleFiles) {
    await writeFile(join(dir, file.path), file.content);
  }

  const baseline = runTests(dir);
  assert.equal(baseline.pass, 1);
  assert.equal(baseline.fail, 1);

  // The expected implementation: the stub returns everything; the filter
  // keeps only unread entries, exactly what list.test.mjs describes.
  const stub = firstProjectSampleFiles.find((file) => file.path === "list.mjs")!;
  await writeFile(
    join(dir, "list.mjs"),
    stub.content.replace("  return items;\n", "  return items.filter((item) => item.read === false);\n"),
  );

  const fixed = runTests(dir);
  assert.equal(fixed.pass, 2);
  assert.equal(fixed.fail, 0);
});

test("serve.mjs answers only the public assets on loopback", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "deck-first-project-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const file of firstProjectSampleFiles) {
    await writeFile(join(dir, file.path), file.content);
  }
  const port = await freePort();
  const server = spawn(process.execPath, ["serve.mjs"], { cwd: dir, env: { ...process.env, DECK_PREVIEW_PORT: String(port) } });
  t.after(() => server.kill());
  await waitForListening(server);

  const index = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get("content-type") ?? "", /^text\/html/);
  assert.match(await index.text(), /Reading list/);

  const script = await fetch(`http://127.0.0.1:${port}/app.mjs`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type") ?? "", /^text\/javascript/);

  for (const target of ["/PRD.md", "/preview.json", "/tutorial.json", "/list.test.mjs", "/serve.mjs"]) {
    const response = await fetch(`http://127.0.0.1:${port}${target}`);
    assert.equal(response.status, 404, `${target} must stay private`);
  }
  assert.match(await rawRequest(port, "/../PRD.md"), /^HTTP\/1\.[01] 404 /);
});

test("the starter LICENSE carries the agreed holder in the complete MIT text", () => {
  const license = firstProjectSampleFiles.find((file) => file.path === "LICENSE")!.content;
  const canonical = `MIT License

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
`;
  assert.equal(license, canonical);
});

test("catalog and task copy stay coherent with the bundle", () => {
  const paths = new Set(firstProjectSampleFiles.map((file) => file.path));
  for (const expected of ["index.html", "app.mjs", "list.mjs", "list.test.mjs", "serve.mjs", "PRD.md", "preview.json", "tutorial.json", "LICENSE"]) {
    assert.ok(paths.has(expected), `bundle is missing ${expected}`);
  }
  assert.equal(firstProjectCatalog.length, 6);
  for (const lesson of firstProjectCatalog) {
    assert.ok(lesson.id.startsWith("first-project-"));
    assert.ok(lesson.steps.length > 0);
    for (const step of lesson.steps) {
      assert.ok(step.title.length > 0);
      assert.ok(step.body.length > 0);
    }
  }
  assert.equal(firstProjectTask.prompt.split("\n").length, 1);
  assert.ok(firstProjectTask.details.length > 0);
});

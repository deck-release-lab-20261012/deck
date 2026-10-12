import assert from "node:assert/strict";
import test from "node:test";
import type { GitHubAttempt, GitHubConnectClient, GitHubCurrent, GitHubStatus } from "./client.ts";
import { connectAction, GitHubConnectModel } from "./model.ts";

const running: GitHubAttempt = { id: "attempt-a", status: "running", generation: 1, started_at: "2026-09-23T00:00:00Z" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const calls: string[] = [];
  const signals: AbortSignal[] = [];
  let status: GitHubStatus = { outcome: "no-account" };
  let attempt: GitHubAttempt | null = null;
  const client: GitHubConnectClient = {
    status: async signal => { signals.push(signal); calls.push("status"); return status; },
    current: async () => { calls.push("current"); return { csrf: "csrf-a", attempt }; },
    start: async (csrf, signal) => { assert.equal(csrf, "csrf-a"); signals.push(signal); calls.push("start"); return running; },
    cancel: async (id, csrf, signal) => { assert.equal(csrf, "csrf-a"); signals.push(signal); calls.push(`cancel:${id}`); },
  };
  let changes = 0;
  const model = new GitHubConnectModel(client, () => changes++);
  return { model, client, calls, signals, changes: () => changes, status: (value: GitHubStatus) => { status = value; }, attempt: (value: GitHubAttempt | null) => { attempt = value; } };
}

test("open reads status and current only; reopening finds the same running attempt", async () => {
  const f = fixture();
  f.attempt(running);
  await f.model.open();
  assert.deepEqual(f.calls, ["status", "current"]);
  assert.equal(f.model.state.attempt?.id, running.id);
  assert.equal(f.model.canStart, false);
  f.model.dispose();
  assert.deepEqual(f.calls, ["status", "current"], "closing never cancels the native process");
  const next = new GitHubConnectModel(f.client);
  await next.open();
  assert.equal(next.state.attempt?.id, running.id);
});

test("connect eligibility preserves environment and unknown credential precedence", () => {
  for (const source of ["environment", "unknown", "future-source"]) {
    for (const outcome of ["no-account", "auth-issue", "authenticated"]) {
      assert.equal(connectAction({ source, outcome, state: "error", active: true, source_writeable: true, login: "person" }), null);
    }
  }
  const failed: GitHubStatus = { outcome: "auth-issue", source: "stored", state: "error", active: true, source_writeable: true, login: "person" };
  assert.equal(connectAction(failed), "reconnect");
  for (const override of [{ active: false }, { source_writeable: false }, { login: "" }, { state: "timeout" }, { outcome: "authenticated" }]) {
    assert.equal(connectAction({ ...failed, ...override }), null);
  }
  assert.equal(connectAction({ outcome: "no-account" }), "connect");
});

test("double Connect launches once; terminal exit never declares authentication", async () => {
  const f = fixture();
  await f.model.open();
  const pending = deferred<GitHubAttempt>();
  let starts = 0;
  f.client.start = () => { starts++; return pending.promise; };
  const first = f.model.start();
  await f.model.start();
  await f.model.read();
  assert.equal(starts, 1);
  assert.equal(f.calls.filter(call => call === "status").length, 1);
  pending.resolve({ ...running, status: "exited" });
  await first;
  assert.equal(f.model.state.status?.outcome, "no-account");
});

test("uncertain mutation has no retries and requires a fresh read before another action", async () => {
  const f = fixture();
  await f.model.open();
  let starts = 0;
  f.client.start = async () => { starts++; throw new Error("connection lost"); };
  await f.model.start();
  assert.equal(f.model.state.phase, "uncertain");
  assert.equal(f.model.canStart, false);
  await f.model.start();
  await f.model.cancel();
  assert.equal(starts, 1);
  f.attempt(running);
  await f.model.read();
  assert.equal(f.model.state.attempt?.id, running.id);
  assert.equal(f.model.canStart, false);
  assert.equal(f.model.canCancel, true);
});

test("cancel names the current attempt, cannot double-send, and uncertainty blocks more actions", async () => {
  const f = fixture();
  f.attempt(running);
  await f.model.open();
  const pending = deferred<void>();
  const ids: string[] = [];
  f.client.cancel = id => { ids.push(id); return pending.promise; };
  const cancel = f.model.cancel();
  await f.model.cancel();
  pending.reject(new Error("lost response"));
  await cancel;
  assert.deepEqual(ids, [running.id]);
  assert.equal(f.model.state.phase, "uncertain");
  assert.equal(f.model.state.attempt?.status, "running", "an unknown outcome is never shown as cancelled");
  assert.equal(f.model.canCancel, false);
});

test("close aborts pending reads and ignores stale callbacks", async () => {
  const f = fixture();
  const pending = deferred<GitHubCurrent>();
  f.client.current = () => pending.promise;
  const opening = f.model.open();
  f.model.dispose();
  const changes = f.changes();
  pending.resolve({ csrf: "late", attempt: running });
  await opening;
  assert.equal(f.signals[0]!.aborted, true);
  assert.equal(f.model.state.phase, "closed");
  assert.equal(f.model.state.attempt, null);
  assert.equal(f.changes(), changes);
});

test("close during start revokes callbacks without issuing cancellation or replay", async () => {
  const f = fixture();
  await f.model.open();
  const pending = deferred<GitHubAttempt>();
  f.client.start = (_csrf, signal) => { f.signals.push(signal); return pending.promise; };
  const starting = f.model.start();
  f.model.dispose();
  const changes = f.changes();
  pending.resolve(running);
  await starting;
  assert.equal(f.model.state.phase, "closed");
  assert.equal(f.signals.at(-1)!.aborted, true);
  assert.equal(f.changes(), changes);
  assert.equal(f.calls.some(call => call.startsWith("cancel")), false);
});

test("a failed current read cannot authorize a mutation from a successful status read", async () => {
  const f = fixture();
  f.client.current = async () => { throw new Error("unavailable"); };
  await f.model.open();
  assert.equal(f.model.state.phase, "error");
  await f.model.start();
  assert.equal(f.calls.includes("start"), false);
  assert.equal(f.signals[0]!.aborted, true, "a failed paired read revokes the other request too");
});

test("late responses after timeout cannot confirm a read or mutation", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  const pendingRead = deferred<GitHubCurrent>();
  f.client.current = () => pendingRead.promise;
  const reading = f.model.open();
  t.mock.timers.tick(15000);
  pendingRead.resolve({ csrf: "csrf-a", attempt: null });
  await reading;
  assert.equal(f.model.state.phase, "error");
  assert.equal(f.model.canStart, false);
  f.client.current = async () => ({ csrf: "csrf-a", attempt: null });
  await f.model.read();
  const pendingStart = deferred<GitHubAttempt>();
  f.client.start = () => pendingStart.promise;
  const starting = f.model.start();
  t.mock.timers.tick(20000);
  pendingStart.resolve(running);
  await starting;
  assert.equal(f.model.state.phase, "uncertain");
  assert.equal(f.model.state.attempt, null);
});

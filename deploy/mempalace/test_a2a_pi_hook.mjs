import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// A stand-in for the a2a CLI: records every invocation, answers `inbox` from
// a fixture file, and succeeds on everything else.
async function fakeA2A(root, inbox) {
  const capture = path.join(root, "calls.jsonl");
  const helper = path.join(root, "a2a.py");
  await writeFile(path.join(root, "inbox.json"), JSON.stringify(inbox));
  await writeFile(
    helper,
    [
      "import json, os, sys",
      "args = sys.argv[1:]",
      "with open(os.environ['A2A_TEST_CAPTURE'], 'a', encoding='utf-8') as stream:",
      "    stream.write(json.dumps({'args': args, 'stdin': sys.stdin.read()}) + '\\n')",
      "if args[:1] == ['inbox']:",
      "    print(open(os.environ['A2A_TEST_INBOX']).read())",
      "if args[:1] == ['mark-read']:",
      "    if os.path.exists(os.environ['A2A_TEST_ACK_FAILS']):",
      "        sys.exit(1)",
      "    kept = [e for e in json.load(open(os.environ['A2A_TEST_INBOX'])) if e['id'] not in args[1:]]",
      "    json.dump(kept, open(os.environ['A2A_TEST_INBOX'], 'w'))",
    ].join("\n"),
  );
  return { helper, capture };
}

async function load(root, inbox) {
  const { helper, capture } = await fakeA2A(root, inbox);
  process.env.A2A_BIN = helper;
  process.env.NOISEDECK_MEMPALACE_PYTHON = process.env.PYTHON ?? "python3";
  process.env.A2A_TEST_CAPTURE = capture;
  process.env.A2A_TEST_INBOX = path.join(root, "inbox.json");
  process.env.A2A_TEST_ACK_FAILS = path.join(root, "ack-fails");
  process.env.A2A_PI_POLL_MS = "3600000";
  delete process.env.NOISEDECK_MEMPALACE_HARNESS;
  const module = await import(
    `${pathToFileURL(path.join(here, "hooks", "a2a-pi-hook.js"))}?test=${Date.now()}-${Math.random()}`
  );
  const handlers = new Map();
  const sender = { accept: true };
  let receipt;
  const extension = module.default({
    on(event, handler) {
      handlers.set(event, handler);
    },
    get sendUserMessage() {
      if (typeof sender.sendUserMessage !== "function") return undefined;
      return (text, options) => {
        sender.sendUserMessage(text, options);
        if (sender.accept) receipt = handlers.get("before_agent_start")({ prompt: text });
      };
    },
  });
  const api = { poll: async (ctx) => {
    const attempted = await extension.poll(ctx);
    await receipt;
    return attempted;
  } };
  const calls = async () =>
    (await readFile(capture, "utf8").catch(() => ""))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  return { handlers, api, calls, sender };
}

const session = (extra = {}) => ({
  sessionManager: {
    getSessionId: () => "pi-session",
    getSessionFile: () => "/home/agent/.pi/agent/sessions/session.jsonl",
    getCwd: () => "/workspace/deck",
  },
  ...extra,
});

test("lifecycle events announce presence with the bounded payload", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "deck-a2a-pi-"));
  try {
    const { handlers, calls } = await load(root, []);
    assert.deepEqual([...handlers.keys()].sort(), ["agent_end", "agent_start", "before_agent_start", "session_shutdown", "session_start"]);
    const ctx = session();
    for (const event of ["session_start", "agent_start", "agent_end", "session_shutdown"]) {
      await handlers.get(event)({}, ctx);
    }
    const hooks = (await calls()).filter((c) => c.args[0] === "hook");
    assert.deepEqual(
      hooks.map((c) => c.args.slice(1)),
      [
        ["session-start", "--harness", "pi"],
        ["prompt", "--harness", "pi"],
        ["stop", "--harness", "pi"],
        ["session-end", "--harness", "pi"],
      ],
    );
    for (const call of hooks) {
      assert.deepEqual(JSON.parse(call.stdin), { session_id: "pi-session", cwd: "/workspace/deck" });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an idle agent receives unread mail through the extension API and only then marks it read", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "deck-a2a-pi-"));
  try {
    const inbox = [{ id: "evt_1", from_agent: "alice", correlation_id: "chat-1", type: "chat.invite", body: "hello?" }];
    const { handlers, api, calls, sender } = await load(root, inbox);
    const delivered = [];
    const ctx = session();
    sender.sendUserMessage = (text, options) => delivered.push({ text, options });
    await handlers.get("session_start")({}, ctx);
    assert.equal(await api.poll(ctx), true);
    assert.equal(delivered.length, 1);
    assert.match(delivered[0].text, /\[a2a\] alice \(chat-1\): hello\?/);
    assert.equal(delivered[0].options, undefined, "idle delivery starts a turn instead of only queuing a follow-up");
    const order = (await calls()).map((c) => c.args[0]);
    assert.deepEqual(order, ["hook", "inbox", "mark-read"]);
    assert.deepEqual((await calls()).at(-1).args, ["mark-read", "evt_1"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an unverified or unreadable record is never delivered nor acknowledged", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "deck-a2a-pi-"));
  try {
    const inbox = [
      { id: "evt_bad", chat: "chat-9", from: "alice", type: "chat.closed", at: "2026-09-06T00:00:00Z", reason: "plaintext body that is not this host's pre-sealing history; refused", untrusted: true },
      { id: "evt_dmg", from_agent: "alice", correlation_id: "chat-9", type: "chat.message", body: "", unreadable: "the box does not open" },
      { id: "evt_ok", from_agent: "bob", correlation_id: "chat-8", type: "chat.message", body: "real" },
    ];
    const { handlers, api, calls, sender } = await load(root, inbox);
    const delivered = [];
    const ctx = session();
    sender.sendUserMessage = (text, options) => delivered.push({ text, options });
    await handlers.get("session_start")({}, ctx);
    assert.equal(await api.poll(ctx), true);
    assert.equal(delivered.length, 1);
    assert.match(delivered[0].text, /real/);
    assert.doesNotMatch(delivered[0].text, /closed|refused|does not open/);
    assert.deepEqual((await calls()).filter((c) => c.args[0] === "mark-read").map((c) => c.args), [["mark-read", "evt_ok"]]);
    // Only diagnostics left: no hand-off and no acknowledgement, poll after poll.
    await writeFile(path.join(root, "inbox.json"), JSON.stringify(inbox.slice(0, 2)));
    const before = (await calls()).length;
    assert.equal(await api.poll(ctx), false);
    assert.equal(await api.poll(ctx), false);
    assert.equal(delivered.length, 1);
    assert.ok(!(await calls()).slice(before).some((c) => c.args[0] === "mark-read"), "nothing acknowledged");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the same box under another relay row is one hand-off, and its acknowledgement follows the new row", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "deck-a2a-pi-"));
  try {
    const scope = "chat-7|abcd|0123456789abcdef0123456789abcdef";
    const inbox = [{ id: "evt_first", from_agent: "bob", correlation_id: "chat-7", type: "chat.message", body: "once", scope }];
    const { handlers, api, calls, sender } = await load(root, inbox);
    const delivered = [];
    const ctx = session();
    sender.sendUserMessage = (text) => delivered.push(text);
    await handlers.get("session_start")({}, ctx);
    await writeFile(process.env.A2A_TEST_ACK_FAILS, "");
    assert.equal(await api.poll(ctx), true);
    assert.equal(delivered.length, 1);
    // The fold now keeps an identical copy of the box under a new row; the
    // acknowledgement is still outstanding.
    await writeFile(path.join(root, "inbox.json"), JSON.stringify([{ ...inbox[0], id: "evt_copy" }]));
    assert.equal(await api.poll(ctx), false, "no second hand-off for the same box");
    assert.equal(delivered.length, 1);
    await rm(process.env.A2A_TEST_ACK_FAILS, { force: true });
    assert.equal(await api.poll(ctx), false);
    const acks = (await calls()).filter((c) => c.args[0] === "mark-read");
    assert.deepEqual(acks.at(-1).args, ["mark-read", "evt_copy"], "retried with the row the fold keeps now");
    assert.deepEqual(JSON.parse(await readFile(path.join(root, "inbox.json"), "utf8")), []);
    assert.equal(await api.poll(ctx), false);
    assert.equal(delivered.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a synchronous send failure leaves the message unread without retrying", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "deck-a2a-pi-"));
  try {
    const inbox = [{ id: "evt_2", from_agent: "bob", correlation_id: "chat-2", type: "chat.message", body: "still there?" }];
    const { handlers, api, calls, sender } = await load(root, inbox);
    const ctx = session();
    sender.sendUserMessage = () => {
      throw new Error("session switching");
    };
    await handlers.get("session_start")({}, ctx);
    assert.equal(await api.poll(ctx), false);
    assert.equal(await api.poll(ctx), false, "uncertain send is not retried");
    assert.ok(!(await calls()).some((c) => c.args[0] === "mark-read"), "nothing acknowledged");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a failed acknowledgement is retried and never redelivers", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "deck-a2a-pi-"));
  try {
    const inbox = [{ id: "evt_4", from_agent: "bob", correlation_id: "chat-4", type: "chat.message", body: "once only" }];
    const { handlers, api, calls, sender } = await load(root, inbox);
    await writeFile(process.env.A2A_TEST_ACK_FAILS, "");
    const delivered = [];
    const ctx = session();
    sender.sendUserMessage = (text) => delivered.push(text);
    await handlers.get("session_start")({}, ctx);
    assert.equal(await api.poll(ctx), true);
    assert.equal(delivered.length, 1);
    assert.equal(await api.poll(ctx), false, "the same unread event is not delivered again");
    assert.equal(delivered.length, 1);
    await rm(process.env.A2A_TEST_ACK_FAILS);
    assert.equal(await api.poll(ctx), false);
    assert.equal(delivered.length, 1);
    const acks = (await calls()).filter((c) => c.args[0] === "mark-read");
    assert.equal(acks.length, 3, "acknowledgement retried on every poll until it succeeds");
    assert.deepEqual(acks.at(-1).args, ["mark-read", "evt_4"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a wake line is one bounded line however large or multiline the body", async () => {
  const module = await import(`${pathToFileURL(path.join(here, "hooks", "a2a-pi-hook.js"))}?test=${Date.now()}-${Math.random()}`);
  const body = "x\ny ".repeat(400);
  const line = module.wakeLine({ from_agent: "alice", correlation_id: "chat-9", body });
  assert.ok(!line.includes("\n"), "no newline survives");
  assert.ok(line.length < 400 + 60, `bounded, got ${line.length}`);
  assert.match(line, /^\[a2a\] alice \(chat-9\): x y x y/);
  const text = module.wakeText([{ from_agent: "a", correlation_id: "c1", type: "chat.message", body }, { from_agent: "b", correlation_id: "c2", type: "chat.invite", body: "short" }]);
  assert.equal(text.split("\n").length, 4, "one line per event plus the two-line footer");
  const join = module.wakeLine({ from_agent: "alice", correlation_id: "c1", type: "chat.join", body: "", metadata: { member: "carol" } });
  assert.equal(join, "[a2a] alice added carol to chat c1", "a membership event is described, not left empty");
  const huge = module.wakeLine({ from_agent: "alice", correlation_id: "c1", type: "chat.join", metadata: { member: "y".repeat(10000) } });
  assert.ok(huge.length < 200, `a forged member name is bounded, got ${huge.length}`);
  const hostile = module.wakeLine({ from_agent: "al\x1bice", correlation_id: "c\r1", body: "ok\x1b[201~\x9bZ\x7f\x00 done" });
  assert.equal(hostile, "[a2a] alice (c 1): ok[201~Z done", "every C0 and C1 control is removed; line breaks become spaces");
});

test("closure and legacy agreement wakes report facts without proposing another command", async () => {
  const { wakeLine, wakeText } = await import("./hooks/a2a-pi-hook.js");
  const base = { from_agent: "alice", correlation_id: "chat-1", body: "untrusted body" };
  const closed = { ...base, type: "chat.closed" };
  assert.equal(wakeLine(closed), "[a2a] alice closed chat chat-1");
  assert.equal(wakeLine({ ...base, type: "chat.close-request" }), "[a2a] alice proposed ending chat chat-1");
  assert.equal(wakeLine({ ...base, type: "chat.close-ack" }), "[a2a] alice agreed to end chat chat-1");
  for (const type of ["chat.closed", "chat.close-request", "chat.close-ack", "chat.leave", "chat.decline"]) {
    assert.doesNotMatch(wakeText([{ ...base, type }]), /Reply|a2a (end|reply)/, type);
  }
  const hostile = wakeLine({ ...closed, from_agent: "al\x1bice", correlation_id: "c\r1" });
  assert.equal(hostile, "[a2a] alice closed chat c 1");
  assert.ok(wakeLine({ ...closed, from_agent: "a".repeat(10000), correlation_id: "c".repeat(10000) }).length < 160);
});

test("invitation and message reply guidance excludes chats closed in the batch", async () => {
  const { wakeText } = await import("./hooks/a2a-pi-hook.js");
  const base = { from_agent: "alice", correlation_id: "chat-1", body: "hello" };
  for (const type of ["chat.invite", "chat.message"]) {
    const payload = { ...base, type };
    const close = { ...base, type: "chat.closed" };
    for (const batch of [[payload, close], [close, payload]]) {
      assert.doesNotMatch(wakeText(batch), /Reply|a2a reply/, "same-chat closure suppresses reply guidance regardless of event order");
      const mixed = wakeText([...batch, { ...payload, correlation_id: "chat-2" }, { ...payload, correlation_id: "chat-2" }]);
      assert.equal(mixed.split("\n\n")[1], 'If the chat is still live and other members remain, reply to chat-2 with `a2a reply <chat> "..."`.');
    }
  }
  assert.equal(wakeText([]), "");
});

test("live joins offer reply and history guidance without directing action at a closed chat", async () => {
  const { wakeText } = await import("./hooks/a2a-pi-hook.js");
  const join = { from_agent: "alice", correlation_id: "chat-1", type: "chat.join", metadata: { member: "bob" } };
  assert.equal(wakeText([join]), '[a2a] alice added bob to chat chat-1\n\nIf the chat is still live and other members remain, reply to chat-1 with `a2a reply <chat> "..."`. Read history for chat-1 with `a2a read <chat>`.');
  const close = { ...join, type: "chat.closed" };
  for (const batch of [[join, close], [close, join]]) {
    assert.doesNotMatch(wakeText(batch), /a2a (reply|read)/, "a closed join offers no action regardless of event order");
    const liveJoin = { ...join, correlation_id: "chat-2" };
    const mixed = wakeText([...batch, liveJoin, liveJoin]);
    assert.equal(mixed.split("\n\n")[1], 'If the chat is still live and other members remain, reply to chat-2 with `a2a reply <chat> "..."`. Read history for chat-2 with `a2a read <chat>`.');
    const liveMessage = { ...join, type: "chat.message", correlation_id: "chat-3", body: "hello" };
    assert.equal(wakeText([...batch, liveMessage]).split("\n\n")[1], 'If the chat is still live and other members remain, reply to chat-3 with `a2a reply <chat> "..."`.', "a closed join never adds history guidance to an unrelated live message");
  }
});

test("a newly added Pi or omp member receives actionable guidance and is acknowledged once", async () => {
  for (const harness of ["pi", "omp"]) {
    const root = await mkdtemp(path.join(tmpdir(), "deck-a2a-pi-"));
    try {
      const inbox = [{ id: "evt_joined", from_agent: "alice", correlation_id: "chat-joined", type: "chat.join", metadata: { member: "bob" }, body: "" }];
      const { handlers, api, calls, sender } = await load(root, inbox);
      process.env.NOISEDECK_MEMPALACE_HARNESS = harness;
      const delivered = [];
      const ctx = session();
      sender.sendUserMessage = (text, options) => delivered.push({ text, options });
      await handlers.get("session_start")({}, ctx);
      assert.equal(await api.poll(ctx), true);
      assert.equal(delivered.length, 1);
      assert.equal(delivered[0].text, '[a2a] alice added bob to chat chat-joined\n\nIf the chat is still live and other members remain, reply to chat-joined with `a2a reply <chat> "..."`. Read history for chat-joined with `a2a read <chat>`.');
      assert.equal(delivered[0].options, undefined, "idle delivery starts a turn instead of only queuing a follow-up");
      assert.equal(await api.poll(ctx), false);
      assert.equal(delivered.length, 1);
      const invocations = await calls();
      assert.deepEqual(invocations[0].args, ["hook", "session-start", "--harness", harness]);
      assert.deepEqual(invocations.filter((c) => c.args[0] === "mark-read").map((c) => c.args), [["mark-read", "evt_joined"]]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("a message followed by the sender leaving qualifies the reply without guessing the roster", async () => {
  const { wakeText } = await import("./hooks/a2a-pi-hook.js");
  const message = { from_agent: "alice", correlation_id: "chat-1", type: "chat.message", body: "my last thought" };
  const leave = { ...message, type: "chat.leave", body: "" };
  assert.equal(wakeText([message, leave]), '[a2a] alice (chat-1): my last thought\n[a2a] alice left chat chat-1\n\nIf the chat is still live and other members remain, reply to chat-1 with `a2a reply <chat> "..."`.');
  assert.equal(wakeText([leave]), "[a2a] alice left chat chat-1", "departure alone does not ask for a reply");
});

test("a close-only follow-up is acknowledged once and never asks the agent to reply", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "deck-a2a-pi-"));
  try {
    const inbox = [{ id: "evt_closed", from_agent: "alice", correlation_id: "chat-closed", type: "chat.closed", body: "" }];
    const { handlers, api, calls, sender } = await load(root, inbox);
    const delivered = [];
    const ctx = session();
    sender.sendUserMessage = (text) => delivered.push(text);
    await handlers.get("session_start")({}, ctx);
    assert.equal(await api.poll(ctx), true);
    assert.deepEqual(delivered, ["[a2a] alice closed chat chat-closed"]);
    assert.equal(await api.poll(ctx), false);
    assert.equal(delivered.length, 1);
    assert.deepEqual((await calls()).filter((c) => c.args[0] === "mark-read").map((c) => c.args), [["mark-read", "evt_closed"]]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mail that arrived while the agent was busy is delivered after agent_end, not swallowed by the stop hook", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "deck-a2a-pi-"));
  try {
    const { handlers, api, calls, sender } = await load(root, []);
    const delivered = [];
    const ctx = session();
    sender.sendUserMessage = (text) => delivered.push(text);
    await handlers.get("session_start")({}, ctx);
    await handlers.get("agent_start")({}, ctx);
    await writeFile(process.env.A2A_TEST_INBOX, JSON.stringify([{ id: "evt_5", from_agent: "alice", correlation_id: "chat-5", type: "chat.message", body: "while busy" }]));
    assert.equal(await api.poll(ctx), false, "not delivered mid-turn");
    await handlers.get("agent_end")({}, ctx);
    const stop = (await calls()).find((c) => c.args[0] === "hook" && c.args[1] === "stop");
    assert.deepEqual(stop.args, ["hook", "stop", "--harness", "pi"], "the stop hook is told it is Pi, so it only announces presence");
    assert.equal(await api.poll(ctx), true);
    assert.match(delivered[0], /alice \(chat-5\): while busy/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a busy agent is not interrupted and an API without sendUserMessage is skipped", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "deck-a2a-pi-"));
  try {
    const inbox = [{ id: "evt_3", from_agent: "bob", correlation_id: "chat-3", type: "chat.message", body: "?" }];
    const { handlers, api, calls, sender } = await load(root, inbox);
    const ctx = session();
    sender.sendUserMessage = () => assert.fail("must not deliver mid-turn");
    await handlers.get("session_start")({}, ctx);
    await handlers.get("agent_start")({}, ctx);
    assert.equal(await api.poll(ctx), false);
    await handlers.get("agent_end")({}, ctx);
    delete sender.sendUserMessage;
    assert.equal(await api.poll(session()), false);
    assert.ok(!(await calls()).some((c) => c.args[0] === "inbox"), "the inbox is never even read");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("void send without a native receipt leaves mail unread and cannot acknowledge another prompt", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "deck-a2a-pi-"));
  try {
    const inbox = [{ id: "evt_failed", from_agent: "alice", correlation_id: "chat-failed", type: "chat.message", body: "hello" }];
    const { handlers, api, calls, sender } = await load(root, inbox);
    const ctx = session();
    sender.accept = false;
    let sent;
    let attempts = 0;
    sender.sendUserMessage = (text) => { sent = text; attempts++; };
    await handlers.get("session_start")({}, ctx);
    assert.equal(await api.poll(ctx), true);
    assert.ok(!(await calls()).some((c) => c.args[0] === "mark-read"));
    await handlers.get("before_agent_start")({ prompt: "unrelated operator prompt" });
    assert.equal(await api.poll(ctx), false);
    assert.equal(attempts, 1);
    assert.ok(!(await calls()).some((c) => c.args[0] === "mark-read"));
    assert.deepEqual(JSON.parse(await readFile(path.join(root, "inbox.json"), "utf8")), inbox);
    await handlers.get("before_agent_start")({ prompt: sent });
    assert.deepEqual((await calls()).filter((c) => c.args[0] === "mark-read").map((c) => c.args), [["mark-read", "evt_failed"]]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

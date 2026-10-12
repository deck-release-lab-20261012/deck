import assert from "node:assert/strict";
import test from "node:test";

import {
  clearLastSession,
  pickInitialSession,
  readLastSession,
  writeLastSession,
  type LastSessionStorage,
} from "./last-session.ts";

function store(initial: Record<string, string> = {}): LastSessionStorage & {
  raw: Map<string, string>;
} {
  const raw = new Map<string, string>(Object.entries(initial));
  return {
    raw,
    getItem: (k) => raw.get(k) ?? null,
    setItem: (k, v) => void raw.set(k, v),
    removeItem: (k) => void raw.delete(k),
  };
}

function refusing(
  base: ReturnType<typeof store>,
  operations: Partial<Record<"get" | "set" | "remove", boolean>>,
): LastSessionStorage {
  return {
    getItem: (k) => {
      if (operations.get) throw new Error("getItem denied");
      return base.raw.get(k) ?? null;
    },
    setItem: (k, v) => {
      if (operations.set) throw new Error("setItem denied");
      base.raw.set(k, v);
    },
    removeItem: (k) => {
      if (operations.remove) throw new Error("removeItem denied");
      base.raw.delete(k);
    },
  };
}

const idA = "11111111-1111-4111-8111-111111111111";
const idB = "22222222-2222-4222-8222-222222222222";
const idC = "33333333-3333-4333-8333-333333333333";

function sessions(...rows: { id: string; presentation_state: string }[]) {
  return rows;
}

test("writeLastSession persists and readLastSession returns it", () => {
  const s = store();
  assert.equal(readLastSession(s), null);
  writeLastSession(s, idA);
  assert.equal(readLastSession(s), idA);
  assert.equal(s.raw.get("noisedeck.last-session-id"), idA);
});

test("readLastSession returns null when no preference is stored", () => {
  assert.equal(readLastSession(store()), null);
});

test("readLastSession swallows a read refusal and falls back to null", () => {
  const s = refusing(store({ "noisedeck.last-session-id": idA }), { get: true });
  assert.equal(readLastSession(s), null);
});

test("writeLastSession swallows a write refusal without throwing", () => {
  const s = refusing(store(), { set: true });
  assert.doesNotThrow(() => writeLastSession(s, idA));
  assert.equal(readLastSession(s), null);
});

test("clearLastSession removes a stored id and is a no-op when none exists", () => {
  const s = store({ "noisedeck.last-session-id": idA });
  clearLastSession(s);
  assert.equal(readLastSession(s), null);
  assert.doesNotThrow(() => clearLastSession(s));
});

test("clearLastSession swallows a removal refusal without throwing", () => {
  const s = refusing(store({ "noisedeck.last-session-id": idA }), { remove: true });
  assert.doesNotThrow(() => clearLastSession(s));
});

test("writeLastSession updates the stored id on a later explicit selection", () => {
  const s = store();
  writeLastSession(s, idA);
  writeLastSession(s, idB);
  assert.equal(readLastSession(s), idB);
});

test("pickInitialSession restores the stored id when it is still present", () => {
  const list = sessions({ id: idA, presentation_state: "running" }, { id: idB, presentation_state: "running" });
  assert.equal(pickInitialSession(idA, list), idA);
});

test("pickInitialSession never restores a non-running stored session", () => {
  const list = sessions({ id: idA, presentation_state: "ended" }, { id: idB, presentation_state: "running" });
  assert.equal(pickInitialSession(idA, list), idB);
});

test("pickInitialSession falls back to running-first when the stored id is absent", () => {
  const list = sessions({ id: idA, presentation_state: "ended" }, { id: idB, presentation_state: "running" });
  assert.equal(pickInitialSession(null, list), idB);
});

test("pickInitialSession falls back to running-first when the stored id was deleted", () => {
  const list = sessions({ id: idA, presentation_state: "ended" }, { id: idB, presentation_state: "running" });
  assert.equal(pickInitialSession(idC, list), idB);
});

test("pickInitialSession falls back when the stored id is arbitrary or corrupt", () => {
  const list = sessions({ id: idA, presentation_state: "ended" }, { id: idB, presentation_state: "running" });
  assert.equal(pickInitialSession("not-a-real-id", list), idB);
  assert.equal(pickInitialSession("", list), idB);
});

test("pickInitialSession returns null when none are verified running", () => {
  const list = sessions({ id: idA, presentation_state: "ended" }, { id: idB, presentation_state: "inactive" });
  assert.equal(pickInitialSession(null, list), null);
});

test("pickInitialSession returns null when there are no sessions", () => {
  assert.equal(pickInitialSession(idA, []), null);
  assert.equal(pickInitialSession(null, []), null);
});

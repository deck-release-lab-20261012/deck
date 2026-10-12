import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { licensedFiles, selectFontSet } from "./select.ts";

const licensedSheet = readFileSync(new URL("./licensed.css", import.meta.url), "utf8");
const files = licensedFiles(licensedSheet);

test("the unchanged stylesheet requires the complete 42-file licensed set", () => {
  assert.equal(files.length, 42);
  assert.equal(new Set(files).size, files.length);
  for (const file of files) assert.doesNotMatch(file, /\/free\//);
});

for (const override of [undefined, "", "auto", "licensed", "free"]) {
  test(`${JSON.stringify(override)} with complete supplied assets`, () => {
    assert.equal(selectFontSet({ override, licensedSheet, supplied: true, present: () => true }), override === "free" ? "free" : "licensed");
  });
  test(`${JSON.stringify(override)} without supplied assets`, () => {
    const select = () => selectFontSet({ override, licensedSheet, supplied: false, present: () => { throw new Error("must not inspect assets"); } });
    if (override === "licensed") assert.throws(select, /requires assets.*NOISEDECK_LICENSED_FONTS_DIR/);
    else assert.equal(select(), "free");
  });
  test(`${JSON.stringify(override)} with incomplete supplied assets`, () => {
    for (const missing of files) {
      const select = () => selectFontSet({ override, licensedSheet, supplied: true, present: (file) => file !== missing });
      if (override === "free") assert.equal(select(), "free");
      else assert.throws(select, (err: Error) => err.message.includes("Incomplete licensed font set") && err.message.includes(missing));
    }
  });
}

test("empty supplied sets fail and invalid modes fail even without assets", () => {
  assert.throws(() => selectFontSet({ override: "auto", licensedSheet, supplied: true, present: () => false }), /42 missing/);
  assert.throws(() => selectFontSet({ override: "bogus", licensedSheet, supplied: false, present: () => false }), /must be "auto", "free" or "licensed"/);
});

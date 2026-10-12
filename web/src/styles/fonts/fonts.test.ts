import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (name: string): string => readFileSync(new URL(name, import.meta.url), "utf8");
const app = read("../app.css");
const free = read("./free.css");
const licensed = read("./licensed.css");

// The four family tokens and the feature setting, which app.css declares as
// the system fallbacks and each sheet re-states at :root with its families.
const STACKS = ["--font-ui", "--font-display", "--font-mono", "--font-prose", "--font-features"];

// The two sheets are the only places a webfont is declared: app.css names no
// file; the selected sheet alone determines the fonts loaded.
test("app.css declares no webfont and references no font file", () => {
  assert.doesNotMatch(app, /@font-face\s*\{/);
  assert.doesNotMatch(app, /url\(["']?\/fonts\//);
});

// The stacks in app.css are the system fallbacks alone; a licensed family
// named there would be a reference the public tree cannot resolve.
test("app.css names no licensed family in a declaration", () => {
  const declarations = app.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const family of ["Euclid Flex", "Operator Mono", "Baskerville 10 Pro", "Dank Mono"]) {
    assert.doesNotMatch(declarations, new RegExp(`"${family}`), `${family} must not appear outside a comment`);
  }
  for (const token of STACKS) assert.match(app, new RegExp(`${token}\\s*:`), `${token} must keep its fallback in app.css`);
});

// Every entry imports the sheet right after app.css, so its :root block
// follows the theme in the cascade and wins at equal specificity.
test("every entry imports @fonts immediately after app.css", () => {
  for (const entry of ["../../main.ts", "../../app/preview.ts", "../../bench/main.ts"]) {
    const src = read(entry);
    assert.match(src, /import "\.{1,2}\/styles\/app\.css";\nimport "@fonts";\n/, `${entry} must import @fonts right after app.css`);
  }
});

test("the licensed sheet declares the three licensed families and nothing free", () => {
  for (const family of ["Euclid Flex", "Euclid Flex XL", "Operator Mono SSm", "Baskerville 10 Pro"]) {
    assert.ok(licensed.includes(`font-family:"${family}"`), `${family} must be declared`);
  }
  assert.doesNotMatch(licensed, /\/fonts\/free\//);
});

test("the licensed sheet re-states the stacks with its families first", () => {
  const root = /:root\s*\{([^}]*)\}/.exec(licensed)?.[1] ?? "";
  assert.match(root, /--font-ui:\s*"Euclid Flex"/);
  assert.match(root, /--font-display:\s*"Euclid Flex XL"/);
  assert.match(root, /--font-mono:\s*"Operator Mono SSm"/);
  assert.match(root, /--font-prose:\s*"Baskerville 10 Pro"/);
  assert.match(root, /--font-features:\s*"ss12" 1/);
});

// The export boundary: binaries leave a snapshot; both stylesheets stay. The attributes file is
// itself export-ignored, so a snapshot — even one unpacked inside a git
// checkout, as the public mirror is — has nothing to assert and skips;
// asking git there would answer for whatever repository encloses the tree.
const attributesPresent = ((): boolean => {
  try {
    readFileSync(new URL("../../../../.gitattributes", import.meta.url));
    return true;
  } catch {
    return false;
  }
})();
test("licensed binaries are export-ignored; both stylesheets and OFL assets ship", { skip: attributesPresent ? false : "no .gitattributes: an exported tree" }, () => {
  let out: string;
  try {
    out = execFileSync("git", ["check-attr", "export-ignore", "--",
      "web/public/fonts/EuclidFlex-Regular-WebS.woff2", "web/public/fonts/OperatorMonoSSmLig-Book.woff2",
      "web/public/fonts/Baskerville10Pro.woff2", "web/src/styles/fonts/licensed.css",
      "web/public/fonts/free/jost-latin-wght-normal.woff2", "web/public/fonts/free/OFL-jost.txt",
      "web/src/styles/fonts/free.css", "web/src/styles/fonts/select.ts",
    ], { cwd: new URL("../../../..", import.meta.url), encoding: "utf8" });
  } catch {
    return; // git unavailable: nothing to ask
  }
  const attr = new Map(out.trim().split("\n").map((l) => { const [p, , v] = l.split(": "); return [p, v]; }));
  for (const p of ["web/public/fonts/EuclidFlex-Regular-WebS.woff2", "web/public/fonts/OperatorMonoSSmLig-Book.woff2",
    "web/public/fonts/Baskerville10Pro.woff2"]) {
    assert.equal(attr.get(p), "set", `${p} must be export-ignored`);
  }
  for (const p of ["web/public/fonts/free/jost-latin-wght-normal.woff2", "web/public/fonts/free/OFL-jost.txt",
    "web/src/styles/fonts/free.css", "web/src/styles/fonts/select.ts", "web/src/styles/fonts/licensed.css"]) {
    assert.equal(attr.get(p), "unspecified", `${p} must ship`);
  }
});

// The free faces stand in for licensed ones through descriptors, so every
// face of every family must carry the full set; a face missing one renders
// at its own metrics and moves every line box that face touches.
test("every free @font-face carries size-adjust and the vertical overrides", () => {
  const faces = free.match(/@font-face\{[^}]*\}/g) ?? [];
  assert.ok(faces.length >= 12, `expected every face of the three families, got ${faces.length}`);
  // The mono ships as static cuts, one file per weight, style and script
  // block: every one of the twelve must be declared, or a missing italic or
  // extended subset falls through to the fallback stack unnoticed.
  const plex = new Set(faces.filter((f) => f.includes('font-family:"IBM Plex Mono"')).map((f) => `${/font-weight:(\d+)/.exec(f)?.[1]} ${/font-style:(\w+)/.exec(f)?.[1]} ${/ibm-plex-mono-(latin(?:-ext)?)-/.exec(f)?.[1]}`));
  for (const weight of ["400", "500", "700"]) for (const style of ["normal", "italic"]) for (const subset of ["latin", "latin-ext"]) {
    assert.ok(plex.has(`${weight} ${style} ${subset}`), `IBM Plex Mono ${weight} ${style} ${subset} must be declared`);
  }
  for (const face of faces) {
    for (const descriptor of ["size-adjust", "ascent-override", "descent-override", "line-gap-override"]) {
      assert.ok(face.includes(`${descriptor}:`), `${descriptor} missing from ${face.slice(0, 60)}`);
    }
    assert.match(face, /src:url\("\/fonts\/free\//, "a free face loads from /fonts/free");
    assert.match(face, /font-weight:\d+( \d+)?;/, "a free face declares its weight (a range for a variable font)");
  }
  for (const family of ["Jost", "EB Garamond", "IBM Plex Mono"]) {
    assert.ok(free.includes(`font-family:"${family}"`), `${family} must be declared`);
  }
});

// Within a family the descriptors must agree, or the italic sits on a
// different baseline from the roman beside it.
test("descriptors agree across every face of a family", () => {
  const faces = free.match(/@font-face\{[^}]*\}/g) ?? [];
  const byFamily = new Map<string, Set<string>>();
  for (const face of faces) {
    const family = /font-family:"([^"]+)"/.exec(face)?.[1] ?? "";
    const descriptors = (face.match(/(?:size-adjust|ascent-override|descent-override|line-gap-override):[^;]+/g) ?? []).join(";");
    byFamily.set(family, (byFamily.get(family) ?? new Set()).add(descriptors));
  }
  for (const [family, variants] of byFamily) {
    assert.equal(variants.size, 1, `${family} declares ${variants.size} descriptor sets`);
  }
});

// The free sheet sets the stacks and re-states only what descriptors cannot
// express; the scale itself stays the ramp in app.css, so the identity trims
// of the face layer must not be touched here either.
test("the free sheet names the free stacks and leaves the ramp alone", () => {
  for (const [token, family] of [["--font-ui", "Jost"], ["--font-display", "Jost"], ["--font-prose", "EB Garamond"], ["--font-mono", "IBM Plex Mono"]]) {
    assert.match(free, new RegExp(`${token}:\\s*"${family}"`), `${token} must lead with ${family}`);
  }
  assert.doesNotMatch(free, /--face-ui-(size|leading)\s*:/);
  assert.doesNotMatch(free, /--text-body|--type-body-size|--type-label-size/);
  assert.match(free, /--font-features:\s*normal/, "no stylistic set to bind in the free faces");
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { requiredThemeVariables, validateBuiltTheme } from "./check-built-theme.mjs";

const theme = (value = "var(--palette)") =>
  `@layer theme { :root,:host { ${requiredThemeVariables.map((name) => `${name}:${value};`).join("")} } }`;

test("emitted theme aliases resolve through the global palette and optional fallbacks", () => {
  validateBuiltTheme(`${theme()} @layer theme { :root { --palette:var(--base); --base:blue } }`);
  validateBuiltTheme(`${theme("var(--optional, var(--palette))")} :root { --palette:blue }`);
});

test("missing runtime names and alias dependencies fail with the affected path", () => {
  const missing = "--color-member-sequence-4";
  assert.throws(
    () => validateBuiltTheme(theme("blue").replace(`${missing}:blue;`, "")),
    new RegExp(missing, "u"),
  );
  assert.throws(() => validateBuiltTheme(theme()), /--color-member-sequence-1 -> --palette/u);
});

test("comments, component scopes and conditional declarations cannot mask a missing palette", () => {
  for (const decoy of [
    "/* :root { --palette:blue } */",
    '.label { content:"--palette:blue;"; --palette:blue }',
    "@media (min-width:1000px) { :root { --palette:blue } }",
    "@supports (color:blue) { @layer theme { :root { --palette:blue } } }",
  ]) {
    assert.throws(() => validateBuiltTheme(theme() + decoy), /--palette/u);
  }
});

test("cycles cannot turn unresolved paint into a passing build", () => {
  assert.throws(
    () => validateBuiltTheme(`${theme()} :root { --palette:var(--base); --base:var(--palette) }`),
    /cyclic theme reference/u,
  );
});

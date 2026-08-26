import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  applyUiPolicyBaseline,
  collectUiPolicyViolations,
  currentUiPolicyBaseline,
} from "./ui-consistency-policy.mjs";

async function readFixture(name) {
  const fixtureUrl = new URL(`./fixtures/ui-consistency-policy/${name}.json`, import.meta.url);
  const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
  return new Map(Object.entries(fixture));
}

test("accepts separated identities, shared choices, textual controls, and square icon actions", async () => {
  const violations = collectUiPolicyViolations(await readFixture("valid"));

  assert.deepEqual(violations, []);
});

test("accepts defined token families, multiline reduced-motion classes, and dynamic SVG colors", () => {
  const sources = new Map([
    [
      "styles.css",
      `@theme {
  --ref-action: #111111;
  --color-action: var(--ref-action);
  --radius-control: 4px;
  --motion-fast: 120ms;
  --shadow-raised: 0 1px 2px rgb(0 0 0 / 10%);
  --z-overlay: 1;
  --font-body: sans-serif;
  --ease-standard: linear;
}
.transparent-presentation {
  background-color: transparent;
  color: currentColor;
}`,
    ],
    [
      "features/example/ValidPolicy.tsx",
      `const presentation = { color: "var(--color-action)" };
const tokens = [
  "var(--radius-control)",
  "var(--motion-fast)",
  "var(--shadow-raised)",
  "var(--z-overlay)",
  "var(--font-body)",
  "var(--ease-standard)",
];
export function ValidPolicy() {
  return (
    <div
      className={\`
        transition-opacity
        motion-reduce:transition-none
        animate-spin
        motion-reduce:animate-none
      \`}
      style={{
        backgroundColor: "transparent",
        color: presentation.color,
        outlineColor: "currentColor",
      }}
    >
      <svg fill="none" stroke="currentColor" />
      <svg fill={presentation.color} stroke={presentation.color} />
      {tokens.join("")}
    </div>
  );
}`,
    ],
  ]);

  assert.deepEqual(collectUiPolicyViolations(sources), []);
});

test("moves deterministic utility, token, color, spacing, and motion checks into the collector", async () => {
  const violations = collectUiPolicyViolations(await readFixture("policy-rules"));

  assert.deepEqual(
    new Set(violations.map((violation) => violation.rule)),
    new Set([
      "arbitrary-pixel-spacing",
      "direct-tailwind-palette",
      "motion-token-duration-limit",
      "nonconforming-spacing-scale",
      "numeric-motion-duration",
      "numeric-z-index",
      "raw-arbitrary-color",
      "raw-tailwind-shadow",
      "reduced-motion-loop",
      "reduced-motion-transition",
      "transition-all",
      "undefined-design-token-reference",
    ]),
  );
  assert.equal(
    violations.filter((violation) => violation.rule === "undefined-design-token-reference").length,
    7,
  );
  assert.equal(
    violations.filter((violation) => violation.rule === "raw-arbitrary-color").length,
    7,
  );
  assert.deepEqual(
    violations
      .filter((violation) => violation.rule === "raw-arbitrary-color")
      .map((violation) => violation.subject.split("@")[0])
      .toSorted(),
    [
      "#123456",
      'backgroundColor: "rebeccapurple"',
      "bg-[#123456]",
      'color: "#abcdef"',
      'fill="#123456"',
      'stroke="red"',
      "white",
    ],
  );
  assert.equal(
    violations.filter((violation) => violation.rule === "direct-tailwind-palette").length,
    2,
  );
});

test("detects recursive cross-family aliases and forbidden UI boundaries", async () => {
  const violations = collectUiPolicyViolations(await readFixture("invalid"));
  const rules = new Set(violations.map((violation) => violation.rule));

  assert.deepEqual(
    rules,
    new Set([
      "ambiguous-member-order-import",
      "data-viz-play-order-token",
      "feature-control-styles-import",
      "feature-raw-choice-input",
      "global-font-shorthand",
      "interactive-touch-target",
      "legacy-player-token",
      "raw-table-cell-alignment",
      "semantic-color-alias-cycle",
      "semantic-color-cross-family",
      "semantic-color-cross-family-value",
      "semantic-color-unresolved-reference",
    ]),
  );
  assert.ok(
    violations.some(
      (violation) =>
        violation.rule === "semantic-color-cross-family" &&
        violation.subject.includes("--color-action|--color-rank-1@--ref-shared"),
    ),
  );
  assert.ok(
    violations.some(
      (violation) =>
        violation.rule === "semantic-color-cross-family-value" &&
        violation.subject.includes("--color-analysis-positive|--color-status-info"),
    ),
  );
  assert.ok(
    violations.some(
      (violation) =>
        violation.rule === "semantic-color-cross-family" &&
        violation.subject.includes("--color-play-order-1|--color-series-1@--ref-play-order"),
    ),
  );
  assert.equal(
    violations.filter((violation) => violation.rule === "feature-raw-choice-input").length,
    2,
  );
  assert.ok(
    violations.some(
      (violation) =>
        violation.rule === "raw-table-cell-alignment" && violation.path.endsWith("Table.tsx"),
    ),
  );
  assert.ok(
    violations.some(
      (violation) =>
        violation.rule === "global-font-shorthand" && violation.path.endsWith("styles.css"),
    ),
  );
  assert.deepEqual(
    violations
      .filter((violation) => violation.rule === "legacy-player-token")
      .map((violation) => violation.subject)
      .toSorted(),
    ["--color-player-", "--color-player-1"],
  );
  assert.deepEqual(
    violations
      .filter((violation) => violation.rule === "interactive-touch-target")
      .map((violation) => violation.path)
      .toSorted(),
    ["features/example/IconOnlyHeight.tsx", "features/example/IconOnlySelfClosing.tsx"],
  );
});

test("supports documented temporary debt while keeping the production baseline empty", async () => {
  const violations = collectUiPolicyViolations(await readFixture("baseline"));
  const fixtureBaseline = violations.map((violation) => ({
    id: violation.id,
    reason: "Checker fixture for a documented migration.",
  }));

  assert.deepEqual(applyUiPolicyBaseline(violations, fixtureBaseline), []);
  assert.deepEqual(currentUiPolicyBaseline, []);
});

test("requires stale baseline entries to be removed", () => {
  const result = applyUiPolicyBaseline(
    [],
    [
      {
        id: "legacy-player-token:styles.css:--color-player-1",
        reason: "Migration in progress.",
      },
    ],
  );

  assert.equal(result.length, 1);
  assert.equal(result[0]?.rule, "ui-policy-stale-baseline");
});

test("requires every baseline entry to explain its migration debt", () => {
  const result = applyUiPolicyBaseline(
    [],
    [
      {
        id: "legacy-player-token:styles.css:--color-player-1",
        reason: "",
      },
    ],
  );

  assert.equal(result.length, 1);
  assert.equal(result[0]?.rule, "ui-policy-baseline-configuration");
});

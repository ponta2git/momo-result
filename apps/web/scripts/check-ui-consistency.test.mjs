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
      "interactive-touch-target",
      "legacy-player-token",
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

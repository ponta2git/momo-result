import assert from "node:assert/strict";
import { test } from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv/dist/2020.js";

import { shareValidatorSchemas } from "./share-validator-schemas.mts";

const code = { type: "string", minLength: 1 };
const record = {
  type: "object",
  properties: { code },
  required: ["code"],
  additionalProperties: false,
};
const schema = {
  $defs: { shared1: { const: "tag" } },
  type: "object",
  properties: {
    left: record,
    right: record,
    tag: { $ref: "#/$defs/shared1" },
    literal: { const: code },
  },
  required: ["left", "right", "tag", "literal"],
};

function firstDiagnostic(errors: ErrorObject[] | null | undefined) {
  const error = errors?.[0];
  return [error?.instancePath, error?.keyword, error?.params];
}

test("reuses validation code while preserving named references, literals and the first diagnostic", () => {
  const compact = shareValidatorSchemas(schema);
  assert.ok(typeof compact === "object");
  const properties = compact.properties as Record<string, { $ref?: string }>;
  assert.ok(properties.left?.$ref);
  assert.deepEqual(properties.left, properties.right);
  assert.deepEqual(properties.literal, schema.properties.literal);

  const compiler = new Ajv2020({ inlineRefs: false });
  const original = compiler.compile(schema);
  const shared = compiler.compile(compact);
  const valid = { left: { code: "l" }, right: { code: "r" }, tag: "tag", literal: code };
  assert.ok(original(valid));
  assert.ok(shared(valid));
  for (const invalid of [
    { ...valid, right: {} },
    { ...valid, left: { code: "" } },
    { ...valid, tag: 3 },
  ]) {
    assert.equal(original(invalid), false);
    assert.equal(shared(invalid), false);
    assert.deepEqual(firstDiagnostic(shared.errors), firstDiagnostic(original.errors));
  }
});

test("preserves original pointer targets and nested schema resource scopes", () => {
  for (const sensitive of [
    { $ref: "#/properties/left/properties/code" },
    { $ref: "#/$defs/unknown" },
    { $id: "nested.json", properties: { example: { $ref: "#local" } } },
    { $dynamicAnchor: "node" },
  ]) {
    const scoped = { ...schema, properties: { ...schema.properties, sensitive } };
    assert.deepEqual(shareValidatorSchemas(scoped), scoped);
  }
});

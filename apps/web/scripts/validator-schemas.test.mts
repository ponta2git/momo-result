import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv/dist/2020.js";

import { standaloneValidatorSource } from "./generate-api.mts";
import { prepareEnvelopeSchema, shareValidatorSchemas } from "./validator-schemas.mts";

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
    { if: { dependentSchemas: { value: { $ref: "#/properties/left" } } } },
    { contains: { not: { $ref: "#/properties/left" } } },
    { extensionWithUnknownShape: { rule: { $ref: "#/properties/left" } } },
  ]) {
    const scoped = { ...schema, properties: { ...schema.properties, sensitive } };
    assert.deepEqual(shareValidatorSchemas(scoped), scoped);
  }
});

test("shares repeated shapes containing literal references or properties named after schema keywords", () => {
  const literal = { $ref: "#/not/a/schema", $id: "not-a-resource", properties: {} };
  const value = {
    type: "object",
    properties: { $ref: { enum: [literal] }, $defs: { const: literal } },
    examples: [literal],
  };
  const result = shareValidatorSchemas({ $defs: { First: value }, properties: { second: value } });
  assert.ok(typeof result === "object");
  const definitions = result.$defs as Record<string, { $ref?: string }>;
  const properties = result.properties as Record<string, { $ref?: string }>;
  assert.ok(definitions.First?.$ref);
  assert.deepEqual(properties.second, definitions.First);
});

test("keeps inherited types for compound schemas and property names", () => {
  const fields = { properties: { code }, required: ["code"] };
  const name = { minLength: 1, maxLength: 4 };
  const object = { type: "object", allOf: [fields, fields], propertyNames: name };
  const compound = {
    type: "array",
    items: { type: "object", properties: { left: object, right: object } },
  };
  const ajv = new Ajv2020({ strict: true, inlineRefs: false });
  const original = ajv.compile(compound);
  const shared = ajv.compile(shareValidatorSchemas(compound));
  for (const data of [
    [{ left: { code: "a" }, right: { code: "b" } }],
    [{ right: {} }],
    [{ left: { code: "a", longer: 1 } }],
  ]) {
    assert.equal(shared(data), original(data));
    assert.deepEqual(firstDiagnostic(shared.errors), firstDiagnostic(original.errors));
  }
});

test("closes only envelope schemas and retains property names and JSON literals", () => {
  const literal = { $ref: "user-supplied", format: "label", properties: {} };
  const references: string[] = [];
  const prepared = prepareEnvelopeSchema(
    {
      type: "object",
      properties: {
        format: { type: "string", format: "uuid" },
        properties: { const: literal },
        $ref: { $ref: "#/components/schemas/Code" },
      },
      examples: [literal],
    },
    (name) => references.push(name),
  );
  assert.deepEqual(references, ["Code"]);
  assert.deepEqual(prepared, {
    type: "object",
    properties: {
      format: { type: "string" },
      properties: { const: literal },
      $ref: { $ref: "#/$defs/Code" },
    },
    examples: [literal],
    additionalProperties: false,
  });
});

test("emits executable standalone ESM for object literals containing code-like text", async (t) => {
  const literal = {
    $ref: "literal",
    format: "label",
    properties: {},
    text: "require(",
    operator: "new Function(",
  };
  const source = standaloneValidatorSource([
    {
      exportName: "validate",
      schema: {
        type: "object",
        properties: { tag: { const: literal }, choice: { enum: [literal] } },
      },
    },
  ]);
  const directory = await mkdtemp(join(tmpdir(), "momo-validator-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await symlink(
    new URL("../node_modules", import.meta.url),
    join(directory, "node_modules"),
    "dir",
  );
  const file = join(directory, "validator.mjs");
  await writeFile(file, source);
  const { validate }: { validate: ValidateFunction } = await import(pathToFileURL(file).href);
  assert.ok(validate({ tag: literal, choice: literal }));
  assert.equal(validate({ tag: {} }), false);
  assert.equal(validate.errors?.[0]?.keyword, "const");
  assert.equal(validate({ choice: {} }), false);
  assert.equal(validate.errors?.[0]?.keyword, "enum");
});

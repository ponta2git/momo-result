import type { AnySchema, ValidateFunction } from "ajv";
import type Ajv2020 from "ajv/dist/2020.js";

type ArtifactResourceKind = "aggregate" | "drilldown" | "matchContext" | "review";
type JsonObject = Record<string, unknown>;

const textSchema = {
  maxLength: 4096,
  minLength: 1,
  type: "string",
  "x-momo-maxUtf8Bytes": 4096,
} as const;

const displayNameSchema = {
  minLength: 1,
  type: "string",
} as const;

const artifactSchema = {
  additionalProperties: false,
  properties: {
    algorithmVersion: textSchema,
    artifactId: textSchema,
    artifactSchemaVersion: { minimum: 0, type: "integer" },
    gameTitleId: textSchema,
    inputRevision: { pattern: "^(0|[1-9][0-9]*)$", type: "string" },
    publishedAt: textSchema,
  },
  required: [
    "algorithmVersion",
    "artifactId",
    "artifactSchemaVersion",
    "gameTitleId",
    "inputRevision",
    "publishedAt",
  ],
  type: "object",
} as const;

const includedSchema = {
  additionalProperties: false,
  properties: {
    sourceMatchRevision: { pattern: "^(0|[1-9][0-9]*)$", type: "string" },
    status: { const: "included", type: "string" },
  },
  required: ["sourceMatchRevision", "status"],
  type: "object",
} as const;

const excludedInclusionSchema = {
  additionalProperties: false,
  properties: {
    status: {
      enum: ["match_changed_since_artifact", "not_in_artifact", "not_in_scope"],
      type: "string",
    },
  },
  required: ["status"],
  type: "object",
} as const;

const scopeKinds = [
  ["overall", []],
  ["season", ["seasonMasterId"]],
  ["map", ["mapMasterId"]],
  ["season_map", ["seasonMasterId", "mapMasterId"]],
] as const;

let ajvPromise: Promise<Ajv2020> | undefined;
const validatorPromises: Partial<Record<ArtifactResourceKind, Promise<ValidateFunction>>> = {};

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function appendRequired(schema: JsonObject, field: string): void {
  const required = schema["required"];
  if (!Array.isArray(required) || !required.every((value) => typeof value === "string")) {
    throw new Error("Series analysis owner schema has an invalid required list.");
  }
  if (!required.includes(field)) required.push(field);
}

function removeRequired(schema: JsonObject, field: string): void {
  const required = schema["required"];
  if (!Array.isArray(required) || !required.every((value) => typeof value === "string")) {
    throw new Error("Series analysis owner schema has an invalid required list.");
  }
  schema["required"] = required.filter((value) => value !== field);
}

function schemaProperties(schema: JsonObject): JsonObject {
  const properties = schema["properties"];
  if (!isObject(properties)) {
    throw new Error("Series analysis owner schema has no object properties.");
  }
  return properties;
}

function schemaBranches(schema: JsonObject): JsonObject[] {
  const oneOf = schema["oneOf"];
  if (oneOf === undefined) return [schema];
  if (!Array.isArray(oneOf) || !oneOf.every(isObject)) {
    throw new Error("Series analysis owner schema has an invalid oneOf.");
  }
  return oneOf;
}

function addMemberDisplayNames(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(addMemberDisplayNames);
    return;
  }
  if (!isObject(value)) return;

  Object.values(value).forEach(addMemberDisplayNames);
  const properties = value["properties"];
  if (isObject(properties) && Object.hasOwn(properties, "memberId")) {
    properties["displayName"] = structuredClone(displayNameSchema);
    appendRequired(value, "displayName");
  }
}

function addScopeDisplayName(resourceSchema: JsonObject): void {
  const scope = schemaProperties(resourceSchema)["scope"];
  if (!isObject(scope)) {
    throw new Error("Series analysis owner schema has no scope schema.");
  }
  schemaBranches(scope).forEach((branch) => {
    schemaProperties(branch)["displayName"] = structuredClone(displayNameSchema);
    appendRequired(branch, "displayName");
  });
}

function addResponseEnvelope(resourceSchema: JsonObject): void {
  const properties = schemaProperties(resourceSchema);
  properties["artifact"] = structuredClone(artifactSchema);
  appendRequired(resourceSchema, "artifact");
  addScopeDisplayName(resourceSchema);
}

function includedMatchContextSchema(ownerSchema: unknown): JsonObject {
  if (!isObject(ownerSchema)) {
    throw new Error("Series analysis match-context owner schema is not an object.");
  }
  const schema = structuredClone(ownerSchema);
  addMemberDisplayNames(schema);
  addResponseEnvelope(schema);
  const properties = schemaProperties(schema);
  delete properties["sourceMatchRevision"];
  removeRequired(schema, "sourceMatchRevision");
  properties["inclusion"] = structuredClone(includedSchema);
  appendRequired(schema, "inclusion");
  return schema;
}

function excludedScopeSchema(): JsonObject {
  return {
    oneOf: scopeKinds.map(([kind, identifiers]) => ({
      additionalProperties: false,
      properties: Object.fromEntries([
        ["displayName", displayNameSchema],
        ["kind", { const: kind, type: "string" }],
        ...identifiers.map((identifier) => [identifier, textSchema] as const),
      ]),
      required: ["displayName", "kind", ...identifiers],
      type: "object",
    })),
  };
}

function excludedMatchContextSchema(): JsonObject {
  return {
    additionalProperties: false,
    properties: {
      artifact: artifactSchema,
      inclusion: excludedInclusionSchema,
      match: { type: "null" },
      matchId: textSchema,
      schemaVersion: { const: 1, type: "integer" },
      scope: excludedScopeSchema(),
    },
    required: ["artifact", "inclusion", "match", "matchId", "schemaVersion", "scope"],
    type: "object",
  };
}

function responseSchema(ownerSchema: unknown): JsonObject {
  if (!isObject(ownerSchema)) {
    throw new Error("Series analysis owner schema is not an object.");
  }
  const schema = structuredClone(ownerSchema);
  addMemberDisplayNames(schema);
  schemaBranches(schema).forEach(addResponseEnvelope);
  return schema;
}

function registerOwnerKeywords(ajv: Ajv2020): void {
  ajv.addKeyword({
    errors: false,
    keyword: "x-momo-maxUtf8Bytes",
    schemaType: "number",
    type: "string",
    validate: (maximum: unknown, value: unknown) =>
      typeof maximum === "number" &&
      typeof value === "string" &&
      new TextEncoder().encode(value).byteLength <= maximum,
  });
  ajv.addKeyword({
    errors: false,
    keyword: "x-momo-finiteF64",
    schemaType: "boolean",
    type: "number",
    validate: (required: unknown, value: unknown) =>
      required !== true || (typeof value === "number" && Number.isFinite(value)),
  });
  ajv.addKeyword({
    errors: false,
    keyword: "x-momo-integerToken",
    schemaType: "boolean",
    type: "integer",
    validate: (required: unknown, value: unknown) =>
      required !== true || (typeof value === "number" && Number.isInteger(value)),
  });
  ajv.addKeyword({ keyword: "x-momo-discriminator", schemaType: "object", valid: true });
  ajv.addKeyword({ keyword: "x-momo-metricId", schemaType: "string", valid: true });
}

async function schemaCompiler(): Promise<Ajv2020> {
  ajvPromise ??= import("ajv/dist/2020.js").then(({ default: Ajv2020 }) => {
    const ajv = new Ajv2020({ allErrors: false, strict: true });
    registerOwnerKeywords(ajv);
    return ajv;
  });
  return ajvPromise;
}

async function loadOwnerSchema(kind: ArtifactResourceKind): Promise<unknown> {
  switch (kind) {
    case "aggregate":
      return (await import("../../../../../docs/schemas/series-analysis-aggregate-v3.schema.json"))
        .default;
    case "drilldown":
      return (await import("../../../../../docs/schemas/series-analysis-drilldown-v3.schema.json"))
        .default;
    case "matchContext":
      return (
        await import("../../../../../docs/schemas/series-analysis-match-context-v1.schema.json")
      ).default;
    case "review":
      return (await import("../../../../../docs/schemas/series-analysis-review-v3.schema.json"))
        .default;
  }
}

async function buildValidator(kind: ArtifactResourceKind): Promise<ValidateFunction> {
  const [ajv, ownerSchema] = await Promise.all([schemaCompiler(), loadOwnerSchema(kind)]);
  const schema =
    kind === "matchContext"
      ? {
          oneOf: [includedMatchContextSchema(ownerSchema), excludedMatchContextSchema()],
        }
      : responseSchema(ownerSchema);
  return ajv.compile(schema as AnySchema);
}

function validator(kind: ArtifactResourceKind): Promise<ValidateFunction> {
  return (validatorPromises[kind] ??= buildValidator(kind));
}

export async function decodeSeriesAnalysisArtifact<T>(
  kind: ArtifactResourceKind,
  value: unknown,
): Promise<T> {
  const validate = await validator(kind);
  if (!validate(value)) {
    const firstError = validate.errors?.[0];
    const location = firstError?.instancePath || "/";
    const keyword = firstError?.keyword ?? "unknown";
    const property = firstError?.params
      ? (["missingProperty", "additionalProperty"] as const)
          .map((name) => firstError.params[name])
          .find((candidate) => typeof candidate === "string")
      : undefined;
    const propertyDetail = property ? `:${property}` : "";
    throw new Error(
      `Invalid series analysis ${kind} response. Contract violation at ${location} (${keyword}${propertyDetail}).`,
    );
  }
  return value as T;
}

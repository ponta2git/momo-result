import type { AnySchema, ValidateFunction } from "ajv";
import type Ajv2020 from "ajv/dist/2020.js";

type SchemaLoader = () => Promise<unknown> | unknown;

let ajvPromise: Promise<Ajv2020> | undefined;
const validatorPromises = new Map<string, Promise<ValidateFunction>>();

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

function schemaCompiler(): Promise<Ajv2020> {
  if (ajvPromise) return ajvPromise;
  const created = import("ajv/dist/2020.js").then(({ default: Ajv }) => {
    const ajv = new Ajv({ allErrors: false, strict: true });
    registerOwnerKeywords(ajv);
    return ajv;
  });
  const retryable = created.catch((error: unknown) => {
    if (ajvPromise === retryable) ajvPromise = undefined;
    throw error;
  });
  ajvPromise = retryable;
  return retryable;
}

function validator(key: string, loadSchema: SchemaLoader): Promise<ValidateFunction> {
  const existing = validatorPromises.get(key);
  if (existing) return existing;

  const compilation = Promise.all([schemaCompiler(), loadSchema()]).then(([ajv, schema]) =>
    ajv.compile(schema as AnySchema),
  );
  const retryable = compilation.catch((error: unknown) => {
    if (validatorPromises.get(key) === retryable) validatorPromises.delete(key);
    throw error;
  });
  validatorPromises.set(key, retryable);
  return retryable;
}

export async function decodeSeriesAnalysisContract<T>(
  key: string,
  responseName: string,
  loadSchema: SchemaLoader,
  value: unknown,
): Promise<T> {
  const validate = await validator(key, loadSchema);
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
      `Invalid series analysis ${responseName} response. Contract violation at ${location} (${keyword}${propertyDetail}).`,
    );
  }
  return value as T;
}

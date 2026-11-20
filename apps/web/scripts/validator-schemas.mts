type SchemaObject = Record<string, unknown>;

const schemaMaps = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
  "dependencies",
]);
const schemaLists = new Set(["anyOf", "oneOf", "allOf", "prefixItems"]);
const singleSchemas = new Set([
  "items",
  "additionalProperties",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
  "contains",
  "additionalItems",
  "unevaluatedItems",
  "unevaluatedProperties",
  "contentSchema",
]);
const independentSchemas = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "prefixItems",
  "items",
  "additionalProperties",
]);
const dataKeywords = new Set([
  "type",
  "required",
  "const",
  "enum",
  "default",
  "example",
  "examples",
  "dependentRequired",
  "x-momo-discriminator",
]);

function isObject(value: unknown): value is SchemaObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Keep existing references to named definitions valid. A pointer into a property's original
// location or a nested resource with its own base URI would make relocation observable.
function hasStableReferences(
  value: SchemaObject,
  root: boolean,
  definitions: SchemaObject,
): boolean {
  return Object.entries(value).every(([key, child]) => {
    if (key === "$ref") {
      const match = typeof child === "string" && /^#\/\$defs\/([\w.-]+)$/u.exec(child);
      return Boolean(match && match[1] && Object.hasOwn(definitions, match[1]));
    }
    const rootKeyword = root && ["$id", "$schema", "$defs"].includes(key);
    return !key.startsWith("$") || key === "$comment" || rootKeyword;
  });
}

// Only these keywords contain schemas. A const, enum, example, or a property name can itself
// look like a schema keyword. Ajv starts a fresh validation context for a property or item.
function mapSchemaChildren(
  schema: object,
  map: (child: unknown, independent: boolean) => unknown,
  opaque?: () => void,
): SchemaObject {
  const result: SchemaObject = { ...schema };
  for (const [key, value] of Object.entries(result)) {
    const independent = independentSchemas.has(key);
    if (schemaMaps.has(key) && isObject(value)) {
      result[key] = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [name, map(child, independent)]),
      );
    } else if (schemaLists.has(key) && Array.isArray(value)) {
      result[key] = value.map((child) => map(child, independent));
    } else if (singleSchemas.has(key)) {
      result[key] = map(value, independent);
    } else if (value !== null && typeof value === "object" && !dataKeywords.has(key)) {
      // An unknown vocabulary may place a schema with a location-sensitive reference here.
      opaque?.();
    }
  }
  return result;
}

/** Close OpenAPI envelope records and collect their referenced components in the same walk. */
export function prepareEnvelopeSchema(
  schema: object,
  onReference: (name: string) => void,
): SchemaObject {
  const result = mapSchemaChildren(schema, (child) =>
    isObject(child) ? prepareEnvelopeSchema(child, onReference) : child,
  );
  if (typeof result.$ref === "string") {
    const name = /^#\/components\/schemas\/([^/]+)$/u.exec(result.$ref)?.[1];
    if (!name) throw new Error(`Unsupported OpenAPI schema reference: ${result.$ref}`);
    onReference(name);
    result.$ref = `#/$defs/${name}`;
  }
  delete result.format;
  if (result.properties !== undefined && result.additionalProperties === undefined) {
    result.additionalProperties = false;
  }
  return result;
}

/** Give Ajv one standalone validation function per repeated shape in this compiler input. */
export function shareValidatorSchemas(schema: SchemaObject | boolean): SchemaObject | boolean {
  if (!isObject(schema)) return schema;
  if (schema.$defs !== undefined && !isObject(schema.$defs)) return schema;
  const originalDefinitions = schema.$defs ?? {};
  let stable = true;
  const counts = new Map<string, number>();
  const keys = new WeakMap<SchemaObject, string>();
  function count(value: unknown, independent: boolean): unknown {
    if (!stable || !isObject(value)) return value;
    stable = hasStableReferences(value, value === schema, originalDefinitions);
    // Combinators inherit the parent's type and defined properties. Moving a branch into
    // $defs would lose those checks. Key order controls the first reported property.
    if (
      independent &&
      !("$ref" in value) &&
      (Object.keys(value).length > 1 || "anyOf" in value || "oneOf" in value || "allOf" in value)
    ) {
      const key = JSON.stringify(value);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      keys.set(value, key);
    }
    mapSchemaChildren(value, count, () => {
      stable = false;
    });
    return value;
  }
  count(schema, false);
  if (!stable) return schema;

  const names = new Map<string, string>();
  const shared: SchemaObject = {};
  let sequence = 0;
  function replace(value: unknown, independent: boolean): unknown {
    if (!isObject(value)) return value;
    const key = independent ? keys.get(value) : undefined;
    if (key === undefined || counts.get(key) === 1) return mapSchemaChildren(value, replace);
    let name = names.get(key);
    if (name === undefined) {
      do {
        name = `shared${++sequence}`;
      } while (Object.hasOwn(originalDefinitions, name));
      names.set(key, name);
      shared[name] = mapSchemaChildren(value, replace);
    }
    return { $ref: `#/$defs/${name}` };
  }
  const result = mapSchemaChildren(schema, replace);
  if (names.size === 0) return schema;
  const retained = isObject(result.$defs) ? result.$defs : {};
  return { ...result, $defs: { ...retained, ...shared } };
}

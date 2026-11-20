type SchemaObject = Record<string, unknown>;

function isObject(value: unknown): value is SchemaObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Keep existing references to named definitions valid. A pointer into a property's original
// location or a nested resource with its own base URI would make relocation observable.
function hasStableReferences(
  value: unknown,
  root: SchemaObject,
  definitions: SchemaObject,
): boolean {
  if (Array.isArray(value))
    return value.every((child) => hasStableReferences(child, root, definitions));
  if (!isObject(value)) return true;
  return Object.entries(value).every(([key, child]) => {
    if (key === "$ref") {
      const match = typeof child === "string" && /^#\/\$defs\/([\w.-]+)$/u.exec(child);
      return Boolean(match && match[1] && Object.hasOwn(definitions, match[1]));
    }
    const rootKeyword = value === root && ["$id", "$schema", "$defs"].includes(key);
    if (key.startsWith("$") && key !== "$comment" && !rootKeyword) return false;
    return hasStableReferences(child, root, definitions);
  });
}

// Visit only schema positions used by the generated contracts. In particular, values in
// const, enum and metadata can be objects that resemble schemas.
function mapSchemaChildren(schema: SchemaObject, map: (child: unknown) => unknown): SchemaObject {
  const result = { ...schema };
  for (const [key, value] of Object.entries(schema)) {
    if ((key === "properties" || key === "$defs") && isObject(value)) {
      result[key] = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [name, map(child)]),
      );
    } else if (["anyOf", "oneOf", "allOf", "prefixItems"].includes(key) && Array.isArray(value)) {
      result[key] = value.map(map);
    } else if (["items", "additionalProperties", "propertyNames"].includes(key)) {
      result[key] = map(value);
    }
  }
  return result;
}

/** Give Ajv one standalone validation function per repeated shape in this compiler input. */
export function shareValidatorSchemas(schema: SchemaObject | boolean): SchemaObject | boolean {
  if (!isObject(schema)) return schema;
  if (schema.$defs !== undefined && !isObject(schema.$defs)) return schema;
  const originalDefinitions = schema.$defs ?? {};
  if (!hasStableReferences(schema, schema, originalDefinitions)) return schema;

  const counts = new Map<string, number>();
  const keys = new WeakMap<SchemaObject, string>();
  function count(value: unknown): unknown {
    if (!isObject(value)) return value;
    // Key order influences which failing property Ajv reports first.
    if (
      !("$ref" in value) &&
      (Object.keys(value).length > 1 || "anyOf" in value || "oneOf" in value || "allOf" in value)
    ) {
      const key = JSON.stringify(value);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      keys.set(value, key);
    }
    mapSchemaChildren(value, count);
    return value;
  }
  mapSchemaChildren(schema, count);

  const names = new Map<string, string>();
  const shared: SchemaObject = {};
  let sequence = 0;
  function replace(value: unknown): unknown {
    if (!isObject(value)) return value;
    const key = keys.get(value);
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

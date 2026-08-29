import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import { _ } from "ajv/dist/compile/codegen/index.js";
import standaloneCode from "ajv/dist/standalone/index.js";
import openapiTS, { astToString } from "openapi-typescript";
import { format } from "oxfmt";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "../api/openapi.yaml");
const typesOutput = resolve(root, "src/shared/api/generated.ts");
const generatedContractRoot = resolve(root, "src/shared/api/generatedContracts");
const artifactRegistryOutput = resolve(
  generatedContractRoot,
  "series-analysis-artifact-contracts.generated.ts",
);
const envelopeSchemasOutput = resolve(
  generatedContractRoot,
  "series-analysis-envelope.schema.generated.json",
);
const validatorsOutput = resolve(generatedContractRoot, "series-analysis-validators.generated.js");
const validatorTypesOutput = resolve(
  generatedContractRoot,
  "series-analysis-validators.generated.d.ts",
);
const checkOnly = process.argv.slice(2).includes("--check");

const artifactKindExtension = "x-momo-series-analysis-resource-kind";

const envelopeRoots = [
  "SeriesAnalysisAdminOverviewResponse",
  "SeriesAnalysisOptionsResponse",
  "SeriesAnalysisRecalculationAcceptedResponse",
  "SeriesAnalysisStatusResponse",
];

const generatedArtifactPattern =
  /^series-analysis-[a-z0-9-]+-response(?:-v\d+)?\.schema\.generated\.json$/u;

if (process.argv.length > (checkOnly ? 3 : 2)) {
  throw new Error("Usage: node scripts/generate-api.mjs [--check]");
}

function visit(value, visitor) {
  if (Array.isArray(value)) {
    return value.map((child) => visit(child, visitor));
  }
  if (typeof value !== "object" || value === null) return value;
  return visitor(
    Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child, visitor)])),
  );
}

function referencedComponentNames(schema) {
  const names = new Set();
  visit(schema, (value) => {
    if (typeof value.$ref === "string") {
      const match = /^#\/components\/schemas\/([^/]+)$/u.exec(value.$ref);
      if (!match?.[1]) throw new Error(`Unsupported OpenAPI schema reference: ${value.$ref}`);
      names.add(match[1]);
    }
    return value;
  });
  return names;
}

function envelopeSchemaDocument(openapi) {
  const sourceSchemas = openapi.components?.schemas;
  if (typeof sourceSchemas !== "object" || sourceSchemas === null) {
    throw new Error("OpenAPI components.schemas is missing.");
  }

  const selected = new Set(envelopeRoots);
  const pending = [...envelopeRoots];
  while (pending.length > 0) {
    const name = pending.pop();
    const schema = sourceSchemas[name];
    if (typeof schema !== "object" || schema === null) {
      throw new Error(`OpenAPI component schema is missing: ${name}`);
    }
    for (const referenced of referencedComponentNames(schema)) {
      if (!selected.has(referenced)) {
        selected.add(referenced);
        pending.push(referenced);
      }
    }
  }

  const definitions = Object.fromEntries(
    [...selected].toSorted().map((name) => {
      const closed = visit(structuredClone(sourceSchemas[name]), (value) => {
        if (typeof value.$ref === "string") {
          value.$ref = value.$ref.replace("#/components/schemas/", "#/$defs/");
        }
        delete value.format;
        if (value.properties !== undefined && value.additionalProperties === undefined) {
          value.additionalProperties = false;
        }
        return value;
      });
      return [name, closed];
    }),
  );

  return {
    $comment:
      "Generated from apps/api/openapi.yaml by apps/web/scripts/generate-api.mjs; do not edit by hand.",
    $defs: definitions,
    $schema: "https://json-schema.org/draft/2020-12/schema",
  };
}

function artifactContracts(openapi) {
  const schemas = openapi.components?.schemas;
  if (typeof schemas !== "object" || schemas === null) {
    throw new Error("OpenAPI components.schemas is missing.");
  }
  const runtimeSchemas = [];
  const seenKinds = new Set();
  for (const [componentName, schema] of Object.entries(schemas)) {
    const kind = schema?.[artifactKindExtension];
    if (kind === undefined) continue;
    if (typeof kind !== "string" || !/^[a-z][A-Za-z0-9]*$/u.test(kind)) {
      throw new Error(`Invalid series analysis resource kind on ${componentName}.`);
    }
    if (seenKinds.has(kind)) {
      throw new Error(`Duplicate series analysis resource kind: ${kind}`);
    }
    seenKinds.add(kind);
    const runtimeSchema = structuredClone(schema);
    delete runtimeSchema[artifactKindExtension];
    const fileKind = kind.replaceAll(/([a-z0-9])([A-Z])/gu, "$1-$2").toLowerCase();
    runtimeSchemas.push({
      componentName,
      kind,
      output: resolve(
        generatedContractRoot,
        `series-analysis-${fileKind}-response.schema.generated.json`,
      ),
      schema: runtimeSchema,
    });
  }
  if (runtimeSchemas.length === 0) {
    throw new Error("OpenAPI has no series analysis artifact response schemas.");
  }
  return runtimeSchemas.toSorted((left, right) =>
    left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0,
  );
}

async function formatGenerated(path, sourceText) {
  const result = await format(path, sourceText);
  if (result.errors.length > 0) {
    throw new Error(`Failed to format generated contract ${path}: ${result.errors[0].message}`);
  }
  return result.code;
}

function artifactRegistrySource(artifacts) {
  const responseTypes = artifacts
    .map(
      ({ componentName, kind }) =>
        `  ${kind}: components["schemas"][${JSON.stringify(componentName)}];`,
    )
    .join("\n");
  const validatorLoaders = artifacts
    .map(
      ({ kind }) =>
        `  ${kind}: async () => (await import("./series-analysis-validators.generated")).${artifactValidatorExport(kind)},`,
    )
    .join("\n");
  return `import type { components } from "@/shared/api/generated";
import type { ContractValidator } from "@/shared/api/seriesAnalysisContractDecoder";

export type SeriesAnalysisArtifactResponseByKind = {
${responseTypes}
};

export const seriesAnalysisArtifactValidatorLoaders = {
${validatorLoaders}
} satisfies Record<keyof SeriesAnalysisArtifactResponseByKind, () => Promise<ContractValidator>>;
`;
}

function artifactValidatorExport(kind) {
  return `validateSeriesAnalysis${kind[0].toUpperCase()}${kind.slice(1)}`;
}

function registerOwnerKeywords(ajv) {
  ajv.addKeyword({
    keyword: "x-momo-maxUtf8Bytes",
    schemaType: "number",
    type: "string",
    code(context) {
      context.fail(_`new TextEncoder().encode(${context.data}).byteLength > ${context.schemaCode}`);
    },
  });
  ajv.addKeyword({
    keyword: "x-momo-finiteF64",
    schemaType: "boolean",
    type: "number",
    code(context) {
      context.fail(_`${context.schemaCode} === true && !Number.isFinite(${context.data})`);
    },
  });
  ajv.addKeyword({
    keyword: "x-momo-integerToken",
    schemaType: "boolean",
    type: "integer",
    code(context) {
      context.fail(_`${context.schemaCode} === true && !Number.isInteger(${context.data})`);
    },
  });
  ajv.addKeyword({ keyword: "x-momo-discriminator", schemaType: "object", valid: true });
  ajv.addKeyword({ keyword: "x-momo-metricId", schemaType: "string", valid: true });
}

function standaloneValidatorSource(artifacts, envelopeDocument) {
  const ajv = new Ajv2020({
    allErrors: false,
    code: { esm: true, source: true },
    strict: true,
  });
  registerOwnerKeywords(ajv);

  const validators = {};
  for (const { kind, schema } of artifacts) {
    const key = `artifact:${kind}`;
    ajv.addSchema(schema, key);
    validators[artifactValidatorExport(kind)] = key;
  }
  for (const name of envelopeRoots) {
    const key = `envelope:${name}`;
    ajv.addSchema(
      {
        ...structuredClone(envelopeDocument),
        $id: `https://momo-result.local/schemas/${name}.json`,
        $ref: `#/$defs/${name}`,
      },
      key,
    );
    validators[`validate${name}`] = key;
  }

  const generated = standaloneCode(ajv, validators).replaceAll(
    /const (func\d+) = require\("ajv\/dist\/runtime\/ucs2length"\)\.default;/gu,
    "const $1 = ucs2length;",
  );
  if (generated.includes("require(") || generated.includes("new Function(")) {
    throw new Error("Generated validators are not browser-CSP-safe.");
  }
  return `// Generated by scripts/generate-api.mjs; do not edit by hand.
import ucs2length from "ajv/dist/runtime/ucs2length.js";
${generated}
`;
}

function validatorTypesSource(artifacts) {
  const exports = [
    ...artifacts.map(({ kind }) => artifactValidatorExport(kind)),
    ...envelopeRoots.map((name) => `validate${name}`),
  ];
  return `import type { ContractValidator } from "@/shared/api/seriesAnalysisContractDecoder";

${exports.map((name) => `export const ${name}: ContractValidator;`).join("\n")}
`;
}

async function generate() {
  const schema = JSON.parse(await readFile(source, "utf8"));
  const ast = await openapiTS(schema);
  const artifacts = artifactContracts(schema);
  const artifactSchemas = await Promise.all(
    artifacts.map(async (artifact) => ({
      ...artifact,
      contents: await formatGenerated(
        artifact.output,
        `${JSON.stringify(artifact.schema, null, 2)}\n`,
      ),
    })),
  );
  const artifactRegistry = await formatGenerated(
    artifactRegistryOutput,
    artifactRegistrySource(artifacts),
  );
  const envelopeSchemas = await formatGenerated(
    envelopeSchemasOutput,
    `${JSON.stringify(envelopeSchemaDocument(schema), null, 2)}\n`,
  );
  const validators = standaloneValidatorSource(artifacts, envelopeSchemaDocument(schema));
  return {
    artifactRegistry,
    artifactSchemas,
    envelopeSchemas,
    openapiTypes: astToString(ast),
    validators,
    validatorTypes: validatorTypesSource(artifacts),
  };
}

async function updateOutput(path, generated, staleMessage) {
  if (checkOnly) {
    const committed = await readFile(path, "utf8").catch(() => "");
    if (committed !== generated) {
      console.error(staleMessage);
      return false;
    }
    return true;
  }
  await mkdir(dirname(path), { recursive: true });
  const current = await readFile(path, "utf8").catch(() => "");
  if (current !== generated) await writeFile(path, generated);
  return true;
}

async function removeUnexpectedArtifactSchemas(expectedPaths) {
  const expectedNames = new Set(expectedPaths.map((path) => basename(path)));
  const entries = await readdir(generatedContractRoot).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  const unexpected = entries.filter(
    (entry) => generatedArtifactPattern.test(entry) && !expectedNames.has(entry),
  );
  if (unexpected.length === 0) return true;
  if (checkOnly) {
    console.error(
      `Obsolete generated series analysis response schemas exist: ${unexpected.toSorted().join(", ")}`,
    );
    return false;
  }
  await Promise.all(unexpected.map((entry) => unlink(resolve(generatedContractRoot, entry))));
  return true;
}

const generated = await generate();
const generatedArtifactPaths = generated.artifactSchemas.map(({ output }) => output);
const results = await Promise.all([
  removeUnexpectedArtifactSchemas(generatedArtifactPaths),
  updateOutput(
    typesOutput,
    generated.openapiTypes,
    "Generated API types are stale. Run `pnpm generate:api` and commit the result.",
  ),
  updateOutput(
    artifactRegistryOutput,
    generated.artifactRegistry,
    "Generated series analysis artifact registry is stale. Run `pnpm generate:api` and commit the result.",
  ),
  updateOutput(
    envelopeSchemasOutput,
    generated.envelopeSchemas,
    "Generated series analysis envelope schemas are stale. Run `pnpm generate:api` and commit the result.",
  ),
  updateOutput(
    validatorsOutput,
    generated.validators,
    "Generated series analysis validators are stale. Run `pnpm generate:api` and commit the result.",
  ),
  updateOutput(
    validatorTypesOutput,
    generated.validatorTypes,
    "Generated series analysis validator types are stale. Run `pnpm generate:api` and commit the result.",
  ),
  ...generated.artifactSchemas.map(({ contents, output: runtimeOutput }) =>
    updateOutput(
      runtimeOutput,
      contents,
      "Generated series analysis response schemas are stale. Run `pnpm generate:api` and commit the result.",
    ),
  ),
]);
if (results.includes(false)) process.exitCode = 1;

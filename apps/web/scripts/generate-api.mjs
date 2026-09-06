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
const generatedValidatorPattern =
  /^series-analysis-(?:[a-z0-9-]+-)?validators\.generated\.(?:js|d\.ts)$/u;

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
      validatorModule: `series-analysis-${fileKind}-validators.generated`,
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
      ({ kind, validatorModule }) =>
        `  ${kind}: async () => (await import("./${validatorModule}")).${artifactValidatorExport(kind)},`,
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

function standaloneValidatorSource(schemas, sharedSchemas) {
  const ajv = new Ajv2020({
    allErrors: false,
    code: { esm: true, source: true },
    // Reuse referenced validators instead of expanding large nested schemas at every use.
    inlineRefs: false,
    strict: true,
  });
  registerOwnerKeywords(ajv);
  for (const schema of sharedSchemas) ajv.addSchema(schema);

  const validators = {};
  for (const { exportName, schema } of schemas) {
    ajv.addSchema(schema, exportName);
    validators[exportName] = exportName;
  }

  const generated = standaloneCode(ajv, validators).replaceAll(
    /const (func\d+) = require\("ajv\/dist\/runtime\/ucs2length"\)\.default;/gu,
    "const $1 = ucs2length;",
  );
  if (generated.includes("require(") || generated.includes("new Function(")) {
    throw new Error("Generated validators are not browser-CSP-safe.");
  }
  return `// Generated by scripts/generate-api.mjs; do not edit by hand.
function ucs2length(value) {
  let length = 0;
  for (const _codePoint of value) length += 1;
  return length;
}
${generated}
`;
}

function validatorTypesSource(schemas) {
  return `import type { ContractValidator } from "@/shared/api/seriesAnalysisContractDecoder";

${schemas.map(({ exportName }) => `export const ${exportName}: ContractValidator;`).join("\n")}
`;
}

function validatorModuleOutputs(moduleName, schemas, sharedSchemas = []) {
  return [
    {
      output: resolve(generatedContractRoot, `${moduleName}.js`),
      contents: standaloneValidatorSource(schemas, sharedSchemas),
    },
    {
      output: resolve(generatedContractRoot, `${moduleName}.d.ts`),
      contents: validatorTypesSource(schemas),
    },
  ];
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
  const envelopeDocument = envelopeSchemaDocument(schema);
  const envelopeSchemas = await formatGenerated(
    envelopeSchemasOutput,
    `${JSON.stringify(envelopeDocument, null, 2)}\n`,
  );
  const envelopeSchemaId = "https://momo-result.local/schemas/series-analysis-envelope.json";
  const envelopeValidators = envelopeRoots.map((name) => ({
    exportName: `validate${name}`,
    schema: { $ref: `${envelopeSchemaId}#/$defs/${name}` },
  }));
  return {
    artifactRegistry,
    artifactSchemas,
    envelopeSchemas,
    openapiTypes: astToString(ast),
    validatorOutputs: [
      ...artifacts.flatMap(({ kind, schema: artifactSchema, validatorModule }) =>
        validatorModuleOutputs(validatorModule, [
          {
            exportName: artifactValidatorExport(kind),
            schema: artifactSchema,
          },
        ]),
      ),
      ...validatorModuleOutputs(
        "series-analysis-envelope-validators.generated",
        envelopeValidators,
        [{ ...envelopeDocument, $id: envelopeSchemaId }],
      ),
    ],
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

async function removeUnexpectedGeneratedContracts(expectedPaths) {
  const expectedNames = new Set(expectedPaths.map((path) => basename(path)));
  const entries = await readdir(generatedContractRoot).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  const unexpected = entries.filter(
    (entry) =>
      (generatedArtifactPattern.test(entry) || generatedValidatorPattern.test(entry)) &&
      !expectedNames.has(entry),
  );
  if (unexpected.length === 0) return true;
  if (checkOnly) {
    console.error(
      `Obsolete generated series analysis contracts exist: ${unexpected.toSorted().join(", ")}`,
    );
    return false;
  }
  await Promise.all(unexpected.map((entry) => unlink(resolve(generatedContractRoot, entry))));
  return true;
}

const generated = await generate();
const generatedArtifactPaths = generated.artifactSchemas.map(({ output }) => output);
const results = await Promise.all([
  removeUnexpectedGeneratedContracts([
    ...generatedArtifactPaths,
    ...generated.validatorOutputs.map(({ output }) => output),
  ]),
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
  ...generated.validatorOutputs.map(({ contents, output }) =>
    updateOutput(
      output,
      contents,
      "Generated series analysis validators are stale. Run `pnpm generate:api` and commit the result.",
    ),
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

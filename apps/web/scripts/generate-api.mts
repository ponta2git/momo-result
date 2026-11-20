import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv/dist/2020.js";
import { _ } from "ajv/dist/compile/codegen/index.js";
import standaloneModule from "ajv/dist/standalone/index.js";
import openapiTS, { astToString } from "openapi-typescript";
import type { OpenAPI3 } from "openapi-typescript";
import { format } from "oxfmt";
import ts from "typescript";

import { prepareEnvelopeSchema, shareValidatorSchemas } from "./validator-schemas.mts";

type ValidatorSchema = { exportName: string; schema: AnySchema };

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "../api/openapi.yaml");
const typesOutput = resolve(root, "src/shared/api/generated.ts");
const generatedContractRoot = resolve(root, "src/shared/api/generatedContracts");
const artifactRegistryOutput = resolve(
  generatedContractRoot,
  "series-analysis-artifact-contracts.generated.ts",
);
const checkOnly = process.argv.slice(2).includes("--check");

const artifactKindExtension = "x-momo-series-analysis-resource-kind";

const envelopeRoots = [
  "SeriesAnalysisAdminOverviewResponse",
  "SeriesAnalysisOptionsResponse",
  "SeriesAnalysisRecalculationAcceptedResponse",
  "SeriesAnalysisStatusResponse",
  "SeriesAnalysisScopeStatusResponse",
];
const radarRoots = [
  "SeriesPlayerRadarRevisionResponse",
  "SeriesPlayerRadarRevisionListResponse",
  "SeriesPlayerRadarRevisionDetailResponse",
  "SeriesPlayerRadarStateResponse",
  "SeriesPlayerRadarPreviewResponse",
  "SeriesPlayerRadarOperationResponse",
];

const generatedArtifactPattern =
  /^series-analysis-(?:[a-z0-9-]+-response(?:-v\d+)?|envelope)\.schema\.generated\.json$/u;
const generatedValidatorPattern =
  /^series-analysis-(?:[a-z0-9-]+-)?validators\.generated\.(?:js|d\.ts)$/u;

function envelopeSchemaDocument(openapi: OpenAPI3, roots: string[]) {
  const sourceSchemas = openapi.components?.schemas;
  if (typeof sourceSchemas !== "object" || sourceSchemas === null) {
    throw new Error("OpenAPI components.schemas is missing.");
  }

  const selected = new Set(roots);
  const definitions = new Map<string, AnySchema>();
  for (const name of selected) {
    const schema = sourceSchemas[name];
    if (typeof schema === "boolean") {
      definitions.set(name, schema);
    } else if (typeof schema === "object" && schema !== null) {
      definitions.set(
        name,
        prepareEnvelopeSchema(schema, (referenced) => selected.add(referenced)),
      );
    } else {
      throw new Error(`OpenAPI component schema is missing: ${name}`);
    }
  }

  return {
    $comment:
      "Generated from apps/api/openapi.yaml by apps/web/scripts/generate-api.mts; do not edit by hand.",
    $defs: Object.fromEntries(
      [...selected].toSorted().map((name) => [name, definitions.get(name)]),
    ),
    $schema: "https://json-schema.org/draft/2020-12/schema",
  };
}

function artifactContracts(openapi: OpenAPI3) {
  const schemas = openapi.components?.schemas;
  if (typeof schemas !== "object" || schemas === null) {
    throw new Error("OpenAPI components.schemas is missing.");
  }
  const runtimeSchemas = [];
  const seenKinds = new Set();
  for (const [componentName, schema] of Object.entries(schemas)) {
    const kind: unknown = schema?.[artifactKindExtension];
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

async function formatGenerated(path: string, sourceText: string) {
  const result = await format(path, sourceText);
  const firstError = result.errors[0];
  if (firstError) {
    throw new Error(`Failed to format generated contract ${path}: ${firstError.message}`);
  }
  return result.code;
}

function artifactRegistrySource(artifacts: ReturnType<typeof artifactContracts>) {
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

export type SeriesAnalysisArtifactResponseByContract = {
${responseTypes}
};

export const seriesAnalysisArtifactValidatorLoaders = {
${validatorLoaders}
} satisfies Record<keyof SeriesAnalysisArtifactResponseByContract, () => Promise<ContractValidator>>;
`;
}

function artifactValidatorExport(kind: string) {
  return `validateSeriesAnalysis${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
}

function registerOwnerKeywords(ajv: Ajv2020) {
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

function assertBrowserSyntax(node: ts.Node): void {
  if (
    (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
    ts.isIdentifier(node.expression) &&
    ["require", "Function", "eval"].includes(node.expression.text)
  ) {
    throw new Error("Generated validators are not browser-CSP-safe.");
  }
  ts.forEachChild(node, assertBrowserSyntax);
}

export function standaloneValidatorSource(
  schemas: ValidatorSchema[],
  sharedSchemas: AnySchema[] = [],
) {
  const ajv = new Ajv2020({
    allErrors: false,
    code: { esm: true, source: true },
    // Reuse referenced validators instead of expanding large nested schemas at every use.
    inlineRefs: false,
    // The Web formats its own diagnostic from instancePath, keyword and params.
    messages: false,
    strict: true,
  });
  registerOwnerKeywords(ajv);
  for (const schema of sharedSchemas) ajv.addSchema(shareValidatorSchemas(schema));

  const validators: Record<string, string> = {};
  for (const { exportName, schema } of schemas) {
    ajv.addSchema(shareValidatorSchemas(schema), exportName);
    validators[exportName] = exportName;
  }

  const generated = standaloneModule
    .default(ajv, validators)
    .replaceAll(
      /const (func\d+) = require\("ajv\/dist\/runtime\/ucs2length"\)\.default;/gu,
      "const $1 = ucs2length;",
    )
    .replaceAll(
      /const (func\d+) = require\("ajv\/dist\/runtime\/equal"\)\.default;/gu,
      'import $1Runtime from "ajv/dist/runtime/equal.js"; const $1 = $1Runtime.default ?? $1Runtime;',
    );
  if (/\b(?:require|Function|eval)\b/u.test(generated)) {
    // A JSON literal can contain these strings. Inspect syntax before rejecting a contract.
    assertBrowserSyntax(ts.createSourceFile("validator.js", generated, ts.ScriptTarget.ESNext));
  }
  return `// Generated by scripts/generate-api.mts; do not edit by hand.
function ucs2length(value) {
  let length = 0;
  for (const _codePoint of value) length += 1;
  return length;
}
${generated}
`;
}

function validatorTypesSource(schemas: ValidatorSchema[]) {
  return `import type { ContractValidator } from "@/shared/api/seriesAnalysisContractDecoder";

${schemas.map(({ exportName }) => `export const ${exportName}: ContractValidator;`).join("\n")}
`;
}

function validatorModuleOutputs(
  moduleName: string,
  schemas: ValidatorSchema[],
  sharedSchemas: AnySchema[] = [],
) {
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
  const schema: OpenAPI3 = JSON.parse(await readFile(source, "utf8"));
  const ast = await openapiTS(schema);
  const artifacts = artifactContracts(schema);
  const envelopeOutputs = [
    { moduleName: "envelope", roots: envelopeRoots },
    { moduleName: "radar", roots: radarRoots },
  ].flatMap(({ moduleName, roots }) => {
    const document = envelopeSchemaDocument(schema, roots);
    const schemaId = `https://momo-result.local/schemas/series-analysis-${moduleName}.json`;
    const validators = roots.map((name) => ({
      exportName: `validate${name}`,
      schema: { $ref: `${schemaId}#/$defs/${name}` },
    }));
    return validatorModuleOutputs(
      `series-analysis-${moduleName}-validators.generated`,
      validators,
      [{ ...document, $id: schemaId }],
    );
  });
  // Schemas are compiler inputs, not separately maintained runtime artifacts.
  // Only emit files consumed by the Web: types, lazy loaders and CSP-safe validators.
  return [
    { output: typesOutput, contents: astToString(ast) },
    {
      output: artifactRegistryOutput,
      contents: await formatGenerated(artifactRegistryOutput, artifactRegistrySource(artifacts)),
    },
    ...artifacts.flatMap(({ kind, schema: artifactSchema, validatorModule }) =>
      validatorModuleOutputs(validatorModule, [
        {
          exportName: artifactValidatorExport(kind),
          schema: artifactSchema,
        },
      ]),
    ),
    ...envelopeOutputs,
  ];
}

async function updateOutput(path: string, generated: string) {
  if (checkOnly) {
    const committed = await readFile(path, "utf8").catch(() => "");
    if (committed !== generated) {
      console.error(
        `Generated API output is stale: ${relative(root, path)}. Run \`pnpm generate:api\` and commit the result.`,
      );
      return false;
    }
    return true;
  }
  await mkdir(dirname(path), { recursive: true });
  const current = await readFile(path, "utf8").catch(() => "");
  if (current !== generated) await writeFile(path, generated);
  return true;
}

async function removeUnexpectedGeneratedContracts(expectedPaths: string[]) {
  const expectedNames = new Set(expectedPaths.map((path) => basename(path)));
  const entries = await readdir(generatedContractRoot).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
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

if (import.meta.main) {
  if (process.argv.length > (checkOnly ? 3 : 2)) {
    throw new Error("Usage: node scripts/generate-api.mts [--check]");
  }
  const generated = await generate();
  const results = await Promise.all([
    removeUnexpectedGeneratedContracts(generated.map(({ output }) => output)),
    ...generated.map(({ contents, output }) => updateOutput(output, contents)),
  ]);
  if (results.includes(false)) process.exitCode = 1;
}

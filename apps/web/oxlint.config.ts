import { readdirSync } from "node:fs";

import { defineConfig } from "oxlint";
import type { DummyRuleMap } from "oxlint";

type RestrictedImportsRule = NonNullable<DummyRuleMap["no-restricted-imports"]>;

// The feature directory is the ownership SSoT; a newly added feature receives the same boundary.
const featureNames = readdirSync(new URL("./src/features/", import.meta.url), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .toSorted();

const invalidMotionPaths = [
  {
    name: "framer-motion",
    message: "Use the approved motion/react entry point.",
  },
  {
    name: "motion",
    message: "Use the approved motion/react entry point.",
  },
  {
    name: "motion/react",
    importNames: ["domAnimation", "domMax", "motion"],
    message: "Use the approved domMin and m-based Motion boundary.",
  },
];

const baseImportPatterns = [
  {
    group: ["../../*", "../../../*"],
    message: "Use the @/ alias instead of a deep relative import.",
  },
  {
    group: ["framer-motion/**"],
    message: "Use the approved motion/react entry point.",
  },
];

const productionTestPatterns = [
  {
    group: ["@/shared/api/msw/**", "@/test/**"],
    message: "Production source must not import test support.",
  },
];

const productionRestrictedPaths = [
  ...invalidMotionPaths,
  {
    name: "@/shared/domain/members",
    importNames: ["fixedMembers"],
    message:
      "Choose workspaceInputMembers, canonicalResultMembers, or orderFixedMembers explicitly.",
  },
];

function featureRestrictedImports(
  featureName: string,
  restrictQueryLifecycle: boolean,
): RestrictedImportsRule {
  const otherFeaturePatterns = featureNames
    .filter((candidate) => candidate !== featureName)
    .flatMap((candidate) => [
      `@/features/${candidate}`,
      `@/features/${candidate}/**`,
      `../${candidate}`,
      `../${candidate}/**`,
    ]);

  return [
    "error",
    {
      paths: [
        ...productionRestrictedPaths,
        {
          name: "@/shared/api/generated",
          message: "Use a shared API resource facade.",
        },
        ...(restrictQueryLifecycle
          ? [
              {
                name: "@tanstack/react-query",
                message: "Keep query lifecycle in a resource or page-model hook.",
              },
            ]
          : []),
      ],
      patterns: [
        ...baseImportPatterns,
        ...productionTestPatterns,
        {
          group: ["@/app/**"],
          message: "Feature code must not depend on the app layer.",
        },
        {
          group: ["@base-ui/react", "@base-ui/react/**"],
          message: "Use a shared UI primitive.",
        },
        {
          group: otherFeaturePatterns,
          message: `Feature '${featureName}' must not depend on another feature's implementation.`,
        },
      ],
    },
  ];
}

function sharedRestrictedImports(restrictQueryLifecycle: boolean): RestrictedImportsRule {
  return [
    "error",
    {
      paths: [
        ...productionRestrictedPaths,
        ...(restrictQueryLifecycle
          ? [
              {
                name: "@tanstack/react-query",
                message: "Keep query lifecycle in a shared resource or command hook.",
              },
            ]
          : []),
      ],
      patterns: [
        ...baseImportPatterns,
        ...productionTestPatterns,
        {
          group: ["@/app/**", "@/features/**"],
          message: "Shared code must not depend on app or feature code.",
        },
      ],
    },
  ];
}

export default defineConfig({
  plugins: ["react", "import", "typescript", "unicorn", "oxc", "promise", "jsx-a11y"],
  categories: {
    correctness: "error",
    suspicious: "error",
    perf: "warn",
    pedantic: "warn",
  },
  options: {
    reportUnusedDisableDirectives: "error",
  },
  rules: {
    "typescript/consistent-type-imports": [
      "error",
      { prefer: "type-imports", fixStyle: "separate-type-imports" },
    ],
    "typescript/consistent-type-definitions": ["error", "type"],
    "typescript/array-type": ["error", { default: "array-simple" }],
    "typescript/no-explicit-any": "error",
    "typescript/no-non-null-assertion": "error",
    "typescript/no-import-type-side-effects": "error",
    "typescript/use-unknown-in-catch-callback-variable": "error",
    "typescript/switch-exhaustiveness-check": [
      "error",
      { considerDefaultExhaustiveForUnions: true },
    ],
    "typescript/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
    "typescript/no-unsafe-type-assertion": "warn",
    "typescript/prefer-optional-chain": "warn",
    "typescript/no-unnecessary-condition": "warn",
    "typescript/only-throw-error": "error",

    "eslint/max-lines-per-function": "off",
    "eslint/max-lines": "off",
    "eslint/no-negated-condition": "off",
    "eslint/no-await-in-loop": "off",
    "eslint/require-await": "off",
    "import/max-dependencies": "off",
    "unicorn/no-useless-undefined": "off",
    "unicorn/prefer-query-selector": "off",
    "unicorn/prefer-import-meta-properties": "off",
    "unicorn/no-array-callback-reference": "off",

    "import/consistent-type-specifier-style": ["error", "prefer-top-level"],
    "import/no-duplicates": "error",
    "import/no-cycle": "error",
    "import/no-unassigned-import": "off",

    "react/react-in-jsx-scope": "off",
    "react/rules-of-hooks": "error",
    "react/jsx-no-constructed-context-values": "error",
    "react/no-unstable-nested-components": ["error", { allowAsProps: true }],
    "react/button-has-type": "error",
    "jsx-a11y/prefer-tag-over-role": "off",

    eqeqeq: ["error", "always", { null: "ignore" }],
    "no-console": "warn",
    "no-param-reassign": ["error", { props: false }],
    "no-throw-literal": "error",
    "no-implicit-coercion": "warn",
    "prefer-const": "error",
    "no-var": "error",
    "no-restricted-imports": [
      "error",
      {
        paths: invalidMotionPaths,
        patterns: baseImportPatterns,
      },
    ],
  },
  env: {
    browser: true,
    builtin: true,
  },
  ignorePatterns: ["dist/**", "coverage/**", "src/shared/api/generated.ts"],
  overrides: [
    {
      files: ["src/**/*.{ts,tsx}"],
      excludeFiles: ["src/**/*.test.*", "src/test/**"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: productionRestrictedPaths,
            patterns: [...baseImportPatterns, ...productionTestPatterns],
          },
        ],
      },
    },
    {
      files: ["src/app/**/*.{ts,tsx}"],
      excludeFiles: ["src/app/routeModules.ts", "src/**/*.test.*"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: productionRestrictedPaths,
            patterns: [
              ...baseImportPatterns,
              ...productionTestPatterns,
              {
                group: ["@/features/**", "../features/**"],
                message: "Load feature modules through app/routeModules.ts.",
              },
            ],
          },
        ],
      },
    },
    ...featureNames.flatMap((featureName) => [
      {
        files: [`src/features/${featureName}/**/*.{ts,tsx}`],
        excludeFiles: ["src/**/*.test.*"],
        rules: {
          "no-restricted-imports": featureRestrictedImports(featureName, false),
        },
      },
      {
        files: [`src/features/${featureName}/**/*.tsx`],
        excludeFiles: ["src/**/*.test.*"],
        rules: {
          "no-restricted-imports": featureRestrictedImports(featureName, true),
        },
      },
    ]),
    {
      files: ["src/shared/**/*.{ts,tsx}"],
      excludeFiles: ["src/**/*.test.*"],
      rules: {
        "no-restricted-imports": sharedRestrictedImports(false),
      },
    },
    {
      files: ["src/shared/**/*.tsx"],
      excludeFiles: ["src/**/*.test.*"],
      rules: {
        "no-restricted-imports": sharedRestrictedImports(true),
      },
    },
    {
      files: ["src/**/*.d.ts"],
      rules: {
        "typescript/consistent-type-definitions": "off",
      },
    },
    {
      files: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/test/**"],
      rules: {
        "no-console": "off",
        "typescript/no-non-null-assertion": "off",
        "typescript/no-explicit-any": "off",
        "typescript/no-unsafe-type-assertion": "off",
        "react/no-array-index-key": "off",
      },
    },
    {
      files: ["scripts/**", "vite.config.ts"],
      rules: {
        "no-console": "off",
        "no-restricted-imports": "off",
      },
    },
  ],
});

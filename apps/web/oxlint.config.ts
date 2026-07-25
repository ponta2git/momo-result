import { defineConfig } from "oxlint";

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
        patterns: [
          {
            group: ["../../*", "../../../*"],
            message: "深い相対パスは禁止。'@/' エイリアスを使うこと。",
          },
        ],
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

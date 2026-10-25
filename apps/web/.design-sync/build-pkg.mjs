// Stages .cache/pkg as the converter's package: the app's compiled CSS plus .d.ts for entry.ts.
import { execFileSync } from "node:child_process";
import { cpSync, globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const here = import.meta.dirname;
const web = resolve(here, "..");
const pkg = resolve(here, ".cache/pkg");
const types = resolve(pkg, "types");

rmSync(pkg, { force: true, recursive: true });
mkdirSync(pkg, { recursive: true });

const [css] = globSync("dist/assets/index-*.css", { cwd: web });
if (!css) throw new Error("dist/assets/index-*.css not found; run `pnpm build` first");
cpSync(resolve(web, css), resolve(pkg, "app.css"));

execFileSync(resolve(web, "node_modules/.bin/tsc"), ["-p", resolve(here, "tsconfig.dts.json")], {
  stdio: "inherit",
});

// ts-morph reads the emitted tree without tsconfig paths, so rewrite `@/` to relative specifiers.
const srcTypes = resolve(types, "src");
for (const file of globSync("**/*.d.ts", { cwd: types })) {
  const path = resolve(types, file);
  const rel = relative(dirname(path), srcTypes) || ".";
  const text = readFileSync(path, "utf8").replaceAll(
    /(["'])@\//gu,
    `$1${rel.startsWith(".") ? rel : `./${rel}`}/`,
  );
  writeFileSync(path, text);
}

writeFileSync(resolve(types, "index.d.ts"), 'export * from "./.design-sync/entry";\n');
writeFileSync(resolve(pkg, "index.ts"), 'export * from "../../entry";\n');
writeFileSync(
  resolve(pkg, "package.json"),
  `${JSON.stringify({ name: "momo-result-ui", private: true, module: "index.ts", types: "types/index.d.ts" }, null, 2)}\n`,
);

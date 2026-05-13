import { glob, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(root, "src");

const forbidden = [
  {
    pattern: /\brequestedImageType\b/u,
    message: "Use requestedScreenType for OCR HTTP DTOs.",
  },
  {
    pattern: /\bdetectedImageType\b/u,
    message: "Use detectedScreenType for OCR HTTP DTOs.",
  },
  {
    pattern: /X-Dev-User/u,
    message: "Use X-Momo-Account-Id for dev/test account selection.",
  },
  {
    pattern: /\bimagePath\b/u,
    message: "Public upload/OCR HTTP responses must not expose local image paths.",
  },
];

const matches = [];

for await (const entry of glob("**/*.{ts,tsx,js,jsx,mjs}", { cwd: sourceRoot })) {
  const path = resolve(sourceRoot, entry);
  const text = await readFile(path, "utf8");
  const lines = text.split("\n");
  for (const [lineIndex, line] of lines.entries()) {
    for (const rule of forbidden) {
      if (rule.pattern.test(line)) {
        matches.push({
          path: relative(root, path),
          line: lineIndex + 1,
          message: rule.message,
          text: line.trim(),
        });
      }
    }
  }
}

if (matches.length > 0) {
  for (const match of matches) {
    console.error(`${match.path}:${match.line}: ${match.message}`);
    console.error(`  ${match.text}`);
  }
  process.exit(1);
}

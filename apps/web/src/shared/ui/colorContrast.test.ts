import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const styles = readFileSync(path.join(process.cwd(), "src/styles.css"), "utf8");
const tokenValues = new Map(
  [...styles.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gmu)].map((match) => [
    match[1] ?? "",
    match[2]?.trim() ?? "",
  ]),
);

function token(name: string): string {
  let value = tokenValues.get(name);
  if (!value) throw new Error(`Missing color token: ${name}`);

  const visited = new Set([name]);
  while (value.startsWith("var(")) {
    const referencedName = value.match(/^var\((--[a-z0-9-]+)\)$/u)?.[1];
    if (!referencedName || visited.has(referencedName)) {
      throw new Error(`Invalid color token graph at ${name}`);
    }
    visited.add(referencedName);
    value = tokenValues.get(referencedName);
    if (!value) throw new Error(`Missing color token: ${referencedName}`);
  }
  return value;
}

function oklab(value: string): readonly [number, number, number] {
  const match = value.match(/^oklch\(([0-9.]+)%\s+([0-9.]+)\s+([0-9.]+)(?:\s*\/\s*[0-9.]+)?\)$/u);
  if (!match) throw new Error(`Expected an OKLCH color, received: ${value}`);

  const lightness = Number(match[1]) / 100;
  const chroma = Number(match[2]);
  const hue = (Number(match[3]) * Math.PI) / 180;
  return [lightness, chroma * Math.cos(hue), chroma * Math.sin(hue)];
}

function clamp(channel: number): number {
  return Math.min(1, Math.max(0, channel));
}

function relativeLuminance(value: string): number {
  return relativeLuminanceFromOklab(oklab(value));
}

function relativeLuminanceFromOklab([lightness, a, b]: readonly [number, number, number]): number {
  const l = Math.pow(lightness + 0.396_337_777_4 * a + 0.215_803_757_3 * b, 3);
  const m = Math.pow(lightness - 0.105_561_345_8 * a - 0.063_854_172_8 * b, 3);
  const s = Math.pow(lightness - 0.089_484_177_5 * a - 1.291_485_548 * b, 3);
  const red = clamp(4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s);
  const green = clamp(-1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s);
  const blue = clamp(-0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function mixOklab(
  foreground: readonly [number, number, number],
  background: readonly [number, number, number],
  foregroundRate: number,
): readonly [number, number, number] {
  return [
    foreground[0] * foregroundRate + background[0] * (1 - foregroundRate),
    foreground[1] * foregroundRate + background[1] * (1 - foregroundRate),
    foreground[2] * foregroundRate + background[2] * (1 - foregroundRate),
  ];
}

function oklabContrast(
  foreground: readonly [number, number, number],
  background: readonly [number, number, number],
): number {
  const [lighter = 0, darker = 0] = [
    relativeLuminanceFromOklab(foreground),
    relativeLuminanceFromOklab(background),
  ].toSorted((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}

function contrast(foreground: string, background: string): number {
  const [lighter = 0, darker = 0] = [
    relativeLuminance(foreground),
    relativeLuminance(background),
  ].toSorted((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("shared color contrast", () => {
  it("meets AA for shared text/control pairs and 3:1 for data marks", () => {
    const surfaces = [token("--color-surface"), token("--color-canvas")];
    const foregrounds = [
      "--color-text-primary",
      "--color-text-secondary",
      "--color-text-muted",
      "--color-action",
      "--color-analysis-emphasis",
      "--color-analysis-positive",
      "--color-analysis-negative",
      "--color-status-info",
      "--color-success",
      "--color-warning",
      "--color-review",
      "--color-danger",
    ];
    for (const foreground of foregrounds) {
      for (const surface of surfaces) {
        expect(contrast(token(foreground), surface), foreground).toBeGreaterThanOrEqual(4.5);
      }
    }

    const insetPairs = [
      ["--color-text-primary", "--color-surface-hover"],
      ["--color-text-primary", "--color-surface-subtle"],
      ["--color-text-primary", "--color-surface-selected"],
      ["--color-text-secondary", "--color-surface-hover"],
      ["--color-text-secondary", "--color-surface-subtle"],
      ["--color-text-muted", "--color-surface-subtle"],
    ] as const;
    for (const [foreground, background] of insetPairs) {
      expect(
        contrast(token(foreground), token(background)),
        `${foreground} on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }

    for (const background of ["--color-action", "--color-danger", "--color-surface-inverse"]) {
      expect(
        contrast(token("--color-text-inverse"), token(background)),
        background,
      ).toBeGreaterThanOrEqual(4.5);
    }

    const marks = [
      ...[1, 2, 3, 4].map((value) => `--color-member-sequence-${value}`),
      ...[1, 2, 3, 4].map((value) => `--color-play-order-${value}`),
      ...[1, 2, 3, 4].map((value) => `--color-rank-${value}`),
      ...[1, 2, 3, 4, 5, 6].map((value) => `--color-series-${value}`),
    ];
    for (const mark of marks) {
      expect(contrast(token(mark), token("--color-surface")), mark).toBeGreaterThanOrEqual(3);
    }
  });

  it("meets AA for text rendered on solid rank backgrounds", () => {
    for (const rank of [1, 2, 3, 4]) {
      const foreground = `--color-rank-${rank}-foreground`;
      const background = `--color-rank-${rank}`;
      expect(
        contrast(token(foreground), token(background)),
        `${foreground} on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("meets AA for text rendered on tinted rank surfaces", () => {
    const primary = oklab(token("--color-text-primary"));
    const surface = oklab(token("--color-surface"));
    for (const rank of [1, 2, 3, 4]) {
      const color = oklab(token(`--color-rank-${rank}`));
      const badgeBackground = mixOklab(color, surface, 0.14);
      const strongestMatrixBackground = mixOklab(color, surface, 0.4);
      expect(oklabContrast(primary, badgeBackground), `rank ${rank} badge`).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(
        oklabContrast(primary, strongestMatrixBackground),
        `rank ${rank} matrix`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

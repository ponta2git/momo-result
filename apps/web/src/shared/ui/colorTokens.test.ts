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

function clamp(channel: number): number {
  return Math.min(1, Math.max(0, channel));
}

function rawToken(name: string): string {
  const value = tokenValues.get(name);
  if (!value) throw new Error(`Missing color token: ${name}`);
  return value;
}

function resolvedToken(name: string): string {
  let value = rawToken(name);
  const visited = new Set([name]);
  while (value.startsWith("var(")) {
    const referencedName = value.match(/^var\((--[a-z0-9-]+)\)$/u)?.[1];
    if (!referencedName || visited.has(referencedName)) {
      throw new Error(`Invalid color token graph at ${name}`);
    }
    visited.add(referencedName);
    value = rawToken(referencedName);
  }
  return value;
}

function relativeLuminance(value: string): number {
  const match = value.match(/^oklch\(([0-9.]+)%\s+([0-9.]+)\s+([0-9.]+)(?:\s*\/\s*[0-9.]+)?\)$/u);
  if (!match) throw new Error(`Expected an OKLCH color, received: ${value}`);

  const lightness = Number(match[1]) / 100;
  const chroma = Number(match[2]);
  const hue = (Number(match[3]) * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = Math.pow(lightness + 0.396_337_777_4 * a + 0.215_803_757_3 * b, 3);
  const m = Math.pow(lightness - 0.105_561_345_8 * a - 0.063_854_172_8 * b, 3);
  const s = Math.pow(lightness - 0.089_484_177_5 * a - 1.291_485_548 * b, 3);
  const red = clamp(4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s);
  const green = clamp(-1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s);
  const blue = clamp(-0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string): number {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].toSorted(
    (left, right) => right - left,
  );
  return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
}

describe("semantic color tokens", () => {
  it("keeps action, status, rank, play-order, and chart-series identities on separate references", () => {
    const families = {
      action: ["--color-action"],
      playOrder: [1, 2, 3, 4].map((value) => `--color-play-order-${value}`),
      rank: [1, 2, 3, 4].map((value) => `--color-rank-${value}`),
      series: [1, 2, 3, 4, 5, 6].map((value) => `--color-series-${value}`),
      status: ["--color-success", "--color-warning", "--color-review", "--color-danger"],
    };

    for (const [family, tokens] of Object.entries(families)) {
      for (const token of tokens) {
        expect(rawToken(token), token).toContain(
          `--ref-${family.replace("playOrder", "play-order")}`,
        );
      }
    }

    const allIdentityValues = Object.values(families).flat().map(resolvedToken);
    expect(new Set(allIdentityValues).size).toBe(allIdentityValues.length);
  });

  it("meets AA for text/control combinations and 3:1 for visual marks", () => {
    const surfaces = [resolvedToken("--color-surface"), resolvedToken("--color-canvas")];
    const textTokens = ["--color-text-primary", "--color-text-secondary", "--color-text-muted"];
    const statusTextTokens = [
      "--color-action",
      "--color-success",
      "--color-warning",
      "--color-review",
      "--color-danger",
    ];
    for (const token of [...textTokens, ...statusTextTokens]) {
      for (const surface of surfaces) {
        expect(
          contrast(resolvedToken(token), surface),
          `${token} must meet text AA`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }

    for (const token of ["--color-action", "--color-danger"]) {
      expect(
        contrast(resolvedToken(token), resolvedToken("--color-surface")),
        `white text on ${token} must meet AA`,
      ).toBeGreaterThanOrEqual(4.5);
    }

    const markTokens = [
      ...[1, 2, 3, 4].map((value) => `--color-play-order-${value}`),
      ...[1, 2, 3, 4].map((value) => `--color-rank-${value}`),
      ...[1, 2, 3, 4, 5, 6].map((value) => `--color-series-${value}`),
    ];
    for (const token of markTokens) {
      expect(
        contrast(resolvedToken(token), resolvedToken("--color-surface")),
        `${token} must remain visible as a graphical mark`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});

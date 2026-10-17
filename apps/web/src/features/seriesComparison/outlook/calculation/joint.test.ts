// @vitest-environment node

import { describe, expect, it } from "vitest";

import { buildJointDistribution, distributionFromCounts, jointFromCounts } from "./index";
import type { JointDistribution } from "./index";

const cells = Array.from({ length: 4 }, (_, row) =>
  Array.from({ length: 4 }, (_columnValue, column) => [row, column] as const),
)
  .flat()
  .filter(([row, column]) => row !== column);

function emptyTable(): number[][] {
  return Array.from({ length: 4 }, () => [0, 0, 0, 0]);
}
function marginals(table: ReadonlyArray<readonly number[]>) {
  return {
    rows: table.map((row) => row.reduce((sum, value) => sum + value, 0)),
    columns: [0, 1, 2, 3].map((column) => table.reduce((sum, row) => sum + row[column]!, 0)),
  };
}
function key(table: ReadonlyArray<readonly number[]>): string {
  const { rows, columns } = marginals(table);
  return `${rows.join(",")}|${columns.join(",")}`;
}
function l1(
  left: ReadonlyArray<readonly number[]>,
  right: ReadonlyArray<readonly number[]>,
): number {
  return left.reduce(
    (sum, row, i) =>
      sum + row.reduce((subtotal, value, j) => subtotal + Math.abs(value - right[i]![j]!), 0),
    0,
  );
}
function checkMarginals(
  joint: JointDistribution,
  rows: readonly number[],
  columns: readonly number[],
  rowTotal: number,
  columnTotal: number,
): void {
  expect(
    joint.weights.every((row, i) => row[i] === 0n && row.every((weight) => weight >= 0n)),
  ).toBe(true);
  expect(
    joint.weights.map((row) => row.reduce((sum, value) => sum + value, 0n) * BigInt(rowTotal)),
  ).toEqual(rows.map((value) => BigInt(value) * joint.denominator));
  expect(
    [0, 1, 2, 3].map(
      (column) => joint.weights.reduce((sum, row) => sum + row[column]!, 0n) * BigInt(columnTotal),
    ),
  ).toEqual(columns.map((value) => BigInt(value) * joint.denominator));
}

describe("legal joint transport", () => {
  it("matches a complete enumeration of all two-game legal tables, including unobserved cells", () => {
    // Enumerating unordered pairs of the twelve legal outcomes gives all 78 integer tables.
    const tables: number[][][] = [];
    for (let first = 0; first < cells.length; first++) {
      for (let second = first; second < cells.length; second++) {
        const table = emptyTable();
        for (const index of [first, second]) {
          const [row, column] = cells[index]!;
          table[row]![column] = table[row]![column]! + 1;
        }
        tables.push(table);
      }
    }
    const groups = new Map<string, number[][][]>();
    for (const table of tables) groups.set(key(table), [...(groups.get(key(table)) ?? []), table]);
    for (const observed of [tables[0]!, tables[17]!, tables[50]!, tables[77]!]) {
      for (const candidates of groups.values()) {
        const { rows, columns } = marginals(candidates[0]!);
        const result = buildJointDistribution(
          distributionFromCounts(rows),
          distributionFromCounts(columns),
          jointFromCounts(observed),
        );
        expect(result).not.toBeNull();
        if (result === null) throw new Error("A legal enumerated table was rejected.");
        checkMarginals(result, rows, columns, 2, 2);
        const cost = Math.min(...candidates.map((candidate) => l1(candidate, observed)));
        const exactDistance = result.weights.reduce(
          (sum, row, i) =>
            sum +
            row.reduce((subtotal, value, j) => {
              const difference = value * 2n - BigInt(observed[i]![j]!) * result.denominator;
              return subtotal + (difference < 0n ? -difference : difference);
            }, 0n),
          0n,
        );
        expect(exactDistance).toBe(BigInt(cost) * result.denominator);
      }
    }
  });

  it("keeps old/new native denominators exact without processing one common-denominator unit at a time", () => {
    const rows = [5, 5, 5, 4];
    const columns = [4, 4, 4, 5];
    const observed = jointFromCounts([
      [0, 4, 0, 0],
      [0, 0, 3, 0],
      [0, 0, 0, 3],
      [3, 0, 0, 0],
    ]);
    const result = buildJointDistribution(
      distributionFromCounts(rows),
      distributionFromCounts(columns),
      observed,
    );
    expect(result?.denominator).toBe(8398000n);
    if (!result) throw new Error("Compatible native distributions were rejected.");
    checkMarginals(result, rows, columns, 19, 17);
    expect(
      buildJointDistribution(
        distributionFromCounts(rows),
        distributionFromCounts(columns),
        observed,
      ),
    ).toEqual(result);
  });

  it("preserves matching observations and rejects incompatible requested marginals", () => {
    const table = [
      [0, 2, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
      [1, 0, 0, 0],
    ];
    const observed = jointFromCounts(table);
    const { rows, columns } = marginals(table);
    const result = buildJointDistribution(
      distributionFromCounts(rows),
      distributionFromCounts(columns),
      observed,
    )!;
    expect(
      result.weights.map((row) => row.map((value) => (value * 5n) / result.denominator)),
    ).toEqual(table.map((row) => row.map(BigInt)));
    expect(
      buildJointDistribution(
        distributionFromCounts([1, 0, 0, 0]),
        distributionFromCounts([1, 0, 0, 0]),
        observed,
      ),
    ).toBeNull();
    expect(() =>
      jointFromCounts([
        [1, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ]),
    ).toThrow(RangeError);
  });
});

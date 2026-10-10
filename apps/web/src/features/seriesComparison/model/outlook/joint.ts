import { areDistributionsCompatible, mapFour, RANK_INDICES } from "./distribution";
import type { Four, RankDistribution, RankIndex } from "./distribution";
import { lcm, safeInteger } from "./rational";

/** Rows and columns always follow the caller's canonical member order. */
export type JointDistribution = Readonly<{ weights: Four<Four<bigint>>; denominator: bigint }>;

export function jointFromCounts(counts: ReadonlyArray<readonly number[]>): JointDistribution {
  if (counts.length !== 4 || counts.some((row) => row.length !== 4))
    throw new RangeError("A four by four joint table is required.");
  const weights = mapFour(RANK_INDICES, (i) =>
    mapFour(RANK_INDICES, (j) => {
      const value = counts[i]?.[j];
      if (value === undefined) throw new RangeError("Missing joint rank count.");
      return safeInteger(value);
    }),
  );
  const denominator = weights.flat().reduce((sum, value) => sum + value, 0n);
  if (
    denominator <= 0n ||
    weights.some((row, i) => row.some((weight, j) => weight < 0n || (i === j && weight !== 0n)))
  )
    throw new RangeError(
      "Joint counts must be nonnegative, positive in total, and zero on the diagonal.",
    );
  return { weights, denominator };
}

type Node = { edges: Edge[]; distance: number; previous: Edge | null };
type Edge = { from: Node; to: Node; reverse: Edge | null; capacity: bigint; cost: number };
function makeNode(): Node {
  return { edges: [], distance: Infinity, previous: null };
}
function addEdge(from: Node, to: Node, capacity: bigint, cost: number): Edge {
  const edge: Edge = { from, to, reverse: null, capacity, cost };
  const reverse: Edge = { from: to, to: from, reverse: edge, capacity: 0n, cost: -cost };
  edge.reverse = reverse;
  from.edges.push(edge);
  to.edges.push(reverse);
  return edge;
}

function shortestPath(nodes: readonly Node[], source: Node, sink: Node): Edge[] | null {
  for (const node of nodes) {
    node.distance = Infinity;
    node.previous = null;
  }
  source.distance = 0;
  // Reverse edges can be negative. Strict improvement and fixed iteration order resolve ties.
  for (let pass = 0; pass < nodes.length - 1; pass++) {
    let changed = false;
    for (const node of nodes) {
      if (node.distance === Infinity) continue;
      for (const edge of node.edges) {
        const next = node.distance + edge.cost;
        if (edge.capacity <= 0n || next >= edge.to.distance) continue;
        edge.to.distance = next;
        edge.to.previous = edge;
        changed = true;
      }
    }
    if (!changed) break;
  }
  const path: Edge[] = [];
  for (let node = sink; node !== source;) {
    const edge = node.previous;
    if (edge === null || path.length >= nodes.length) return null;
    path.push(edge);
    node = edge.from;
  }
  return path;
}

/**
 * Each cell costs zero through its observed mass, then one. With fixed total mass,
 * minimizing that overflow is equivalent to minimizing L1 distance from observations.
 * Ten nodes and capacity-sized augmentations avoid a loop over the common denominator.
 */
export function buildJointDistribution(
  first: RankDistribution,
  second: RankDistribution,
  observed: JointDistribution,
): JointDistribution | null {
  if (!areDistributionsCompatible(first, second)) return null;
  const denominator = [first.denominator, second.denominator, observed.denominator].reduce(
    lcm,
    2000n,
  );
  const rows = mapFour(first.weights, (weight) => weight * (denominator / first.denominator));
  const columns = mapFour(second.weights, (weight) => weight * (denominator / second.denominator));
  const source = makeNode();
  const sink = makeNode();
  const rowNodes = mapFour(RANK_INDICES, makeNode);
  const columnNodes = mapFour(RANK_INDICES, makeNode);
  const nodes = [source, ...rowNodes, ...columnNodes, sink];
  for (const i of RANK_INDICES) addEdge(source, rowNodes[i], rows[i], 0);
  const cells: Array<{
    i: RankIndex;
    j: RankIndex;
    observed: Edge;
    overflow: Edge;
    original: bigint;
  }> = [];
  for (const i of RANK_INDICES) {
    for (const j of RANK_INDICES) {
      if (i === j) continue;
      const original = observed.weights[i][j] * (denominator / observed.denominator);
      cells.push({
        i,
        j,
        observed: addEdge(rowNodes[i], columnNodes[j], original, 0),
        overflow: addEdge(rowNodes[i], columnNodes[j], denominator, 1),
        original,
      });
    }
  }
  for (const j of RANK_INDICES) addEdge(columnNodes[j], sink, columns[j], 0);
  let remaining = denominator;
  while (remaining > 0n) {
    const path = shortestPath(nodes, source, sink);
    if (path === null) return null;
    const amount = path.reduce(
      (minimum, edge) => (edge.capacity < minimum ? edge.capacity : minimum),
      remaining,
    );
    if (amount <= 0n) return null;
    for (const edge of path) {
      if (edge.reverse === null) return null;
      edge.capacity -= amount;
      edge.reverse.capacity += amount;
    }
    remaining -= amount;
  }
  const weights = mapFour(RANK_INDICES, (): [bigint, bigint, bigint, bigint] => [0n, 0n, 0n, 0n]);
  for (const cell of cells)
    weights[cell.i][cell.j] =
      cell.original - cell.observed.capacity + denominator - cell.overflow.capacity;
  // A failure remains local to the examples; never emit an approximate or illegal table.
  if (
    RANK_INDICES.some(
      (i) =>
        weights[i].some((weight) => weight < 0n) ||
        weights[i].reduce((sum, value) => sum + value, 0n) !== rows[i],
    ) ||
    RANK_INDICES.some((j) => weights.reduce((sum, row) => sum + row[j], 0n) !== columns[j])
  )
    return null;
  return { weights, denominator };
}

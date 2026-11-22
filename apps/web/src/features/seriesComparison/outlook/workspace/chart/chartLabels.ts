export type ChartBox = Readonly<{ x0: number; y0: number; x1: number; y1: number }>;

/**
 * Places labels at their anchors, in anchor order, at least `gap` apart and inside
 * [top, bottom]. Labels move only as far as needed, so each stays next to its own line.
 */
export function layoutEndLabels<T extends { anchorY: number }>(
  labels: readonly T[],
  { gap, top, bottom }: { gap: number; top: number; bottom: number },
): Array<T & { y: number }> {
  const placed = labels
    .map((label) => ({ ...label, y: label.anchorY }))
    .toSorted((a, b) => a.anchorY - b.anchorY);
  let previous: { y: number } | undefined;
  for (const current of placed) {
    if (previous && current.y < previous.y + gap) current.y = previous.y + gap;
    previous = current;
  }
  const last = placed.at(-1);
  const overflow = last ? last.y - bottom : 0;
  if (overflow > 0) for (const label of placed) label.y -= overflow;
  const first = placed[0];
  const underflow = first ? top - first.y : 0;
  if (underflow > 0) for (const label of placed) label.y += underflow;
  return placed;
}

const overlaps = (a: ChartBox, b: ChartBox) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** The first candidate that stays inside the bounds and clears every obstacle, if any. */
export function placeInlineLabel(
  candidates: readonly ChartBox[],
  obstacles: readonly ChartBox[],
  bounds: ChartBox,
): ChartBox | null {
  return (
    candidates.find(
      (box) =>
        box.x0 >= bounds.x0 &&
        box.x1 <= bounds.x1 &&
        box.y0 >= bounds.y0 &&
        box.y1 <= bounds.y1 &&
        obstacles.every((obstacle) => !overlaps(box, obstacle)),
    ) ?? null
  );
}

import type { Rational } from "@/features/seriesComparison/model/outlook";
import { outlookAverage } from "@/features/seriesComparison/outlook/outlookPresentation";

export function outlookGapParts(gap: Rational, names: readonly [string, string]) {
  if (gap.numerator === 0n) return { value: "0位", relation: "同率" };
  const absolute = {
    numerator: gap.numerator < 0n ? -gap.numerator : gap.numerator,
    denominator: gap.denominator,
  };
  const difference =
    absolute.numerator * 10000n < absolute.denominator
      ? "0.0001位未満"
      : `${outlookAverage(absolute)}位`;
  return { value: difference, relation: `${gap.numerator > 0n ? names[0] : names[1]}が上` };
}

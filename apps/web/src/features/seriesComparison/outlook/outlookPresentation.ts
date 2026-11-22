import {
  formatRational,
  rational,
  rationalToNumber,
} from "@/features/seriesComparison/outlook/calculation";
import type { RankDistribution, Rational } from "@/features/seriesComparison/outlook/calculation";
import type { OutlookSource } from "@/features/seriesComparison/outlook/outlookWorkspaceState";

/** Two decimals, or up to four with 「約」 when the exact value lies between them. */
export function outlookAverage(value: Rational) {
  const n = rationalToNumber(value);
  const exactFour = (value.numerator * 10000n) % value.denominator === 0n;
  return exactFour ? n.toFixed(4).replace(/(\.\d\d)0+$/u, "$1") : `約${formatRational(value, 4)}`;
}

/**
 * A signed difference from the focus person's side. The sign comes from the exact value, so a
 * lead or deficit below 0.005 still shows as +0.00 or −0.00 and only a tie shows ±0.00.
 */
export function signedOutlookGap(gap: Rational) {
  const absolute = rational(gap.numerator < 0n ? -gap.numerator : gap.numerator, gap.denominator);
  return `${gap.numerator > 0n ? "+" : gap.numerator < 0n ? "−" : "±"}${formatRational(absolute, 2)}`;
}

/** 2025/03〜05, 2025/11〜2026/01, or a single month. */
export function outlookMonthRange(period: { startedAt: string; endedAt: string }) {
  const start = period.startedAt.slice(0, 7).replace("-", "/");
  const end = period.endedAt.slice(0, 7).replace("-", "/");
  if (start === end) return start;
  return start.slice(0, 4) === end.slice(0, 4) ? `${start}〜${end.slice(5)}` : `${start}〜${end}`;
}

/**
 * Where an assumption came from, when it is not this artifact's recent results. Values from an
 * earlier artifact keep naming that origin instead of passing as current results.
 */
export function outlookSourceLabel(source: OutlookSource, artifactId: string): string | null {
  switch (source.kind) {
    case "recent":
      return source.artifactId === artifactId ? null : `更新前の直近${source.matchCount}戦`;
    case "average":
      return "平均に合わせた内訳";
    case "example":
      return source.artifactId === artifactId
        ? `${outlookMonthRange(source.period)}の実績例`
        : "更新前の実績例を使っています";
  }
}

export function exactAverageFraction(distribution: RankDistribution) {
  const sum = distribution.weights.reduce((value, weight, i) => value + BigInt(i + 1) * weight, 0n);
  return `${sum} / ${distribution.denominator}`;
}

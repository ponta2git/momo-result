import { formatRational, rationalToNumber } from "@/features/seriesComparison/model/outlook";
import type { RankDistribution, Rational } from "@/features/seriesComparison/model/outlook";
import type { OutlookSource } from "@/features/seriesComparison/outlook/outlookSession";

export function outlookAverage(value: Rational) {
  const n = rationalToNumber(value);
  const exactFour = (value.numerator * 10000n) % value.denominator === 0n;
  return exactFour ? n.toFixed(4).replace(/(\.\d\d)0+$/u, "$1") : `約${formatRational(value, 4)}`;
}

export function outlookSourceLabel(source: OutlookSource, artifactId: string) {
  const old = source.artifactId !== undefined && source.artifactId !== artifactId;
  switch (source.kind) {
    case "recent":
      return `${old ? "更新前の" : ""}直近${source.matchCount}戦`;
    case "average":
      return "平均に合わせた回数の一例";
    case "counts":
      return "回数を指定";
    case "example":
      return old ? "更新前の実績例を使っています" : "過去20戦の実績例";
  }
}

export function exactAverageFraction(distribution: RankDistribution) {
  const sum = distribution.weights.reduce((value, weight, i) => value + BigInt(i + 1) * weight, 0n);
  return `${sum} / ${distribution.denominator}`;
}

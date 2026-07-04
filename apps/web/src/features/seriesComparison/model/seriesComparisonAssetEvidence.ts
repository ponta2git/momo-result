import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";

import { formatCountRate, formatMoney } from "./seriesComparisonFormatters";
import type {
  AssetStyleEvidenceItem,
  AssetStyleProfileEntry,
  MetricEmphasis,
} from "./seriesComparisonPresentationTypes";

export function assetStyleEvidence(
  profile: AssetStyleProfileEntry,
  thresholds: SeriesComparisonResponse["assetStyleProfiles"],
): AssetStyleEvidenceItem[] {
  const metrics = profile.metrics;
  const evidence = { kind: "evidence", label: "根拠" } as const satisfies MetricEmphasis;
  const risk = { kind: "risk", label: "注意" } as const satisfies MetricEmphasis;
  const strength = { kind: "strength", label: "強み" } as const satisfies MetricEmphasis;
  const highAsset = {
    emphasis: strength,
    help: `全員合算の上位10%ライン（${formatMoney(thresholds.highAssetThreshold)}以上）に入った試合です。`,
    key: "high-assets",
    label: "高資産帯",
    value: formatCountRate({
      count: metrics.highAssetCount,
      rate: metrics.highAssetRate,
      targetCount: profile.targetCount,
    }),
  };
  const lowAsset = {
    help: `全員合算の下位10%ライン（${formatMoney(thresholds.lowAssetThreshold)}以下）に入った試合です。`,
    key: "low-assets",
    label: "低資産帯",
    value: formatCountRate({
      count: metrics.lowAssetCount,
      rate: metrics.lowAssetRate,
      targetCount: profile.targetCount,
    }),
  };
  const lowAssetAvoided = {
    ...lowAsset,
    emphasis: strength,
    help: `${lowAsset.help} 少ないほど、下振れを避けて総資産を積み上げている根拠として扱います。`,
    key: "low-assets-avoided",
    label: "低資産帯少なめ",
  };
  const lowAssetRisk = {
    ...lowAsset,
    emphasis: risk,
    help: `${lowAsset.help} 多いほど、資産を取りに行く代わりに下振れも出ている根拠として扱います。`,
    key: "low-assets-risk",
  };
  const blowoutWin = {
    help: `勝利時の1位-2位差が、選択範囲の勝利差75パーセンタイル（${formatMoney(thresholds.blowoutWinThreshold)}）以上だった試合です。`,
    emphasis: strength,
    key: "blowout-win",
    label: "大差勝ち",
    value: `${metrics.blowoutWinCount}戦`,
  };
  const fewBlowoutWins = {
    ...blowoutWin,
    emphasis: evidence,
    help: `${blowoutWin.help} 少ない場合は、大差より接戦で回収する型の根拠として扱います。`,
    key: "few-blowout-win",
    label: "大差勝ち少なめ",
  };
  const closeWin = {
    emphasis: strength,
    help: "勝った試合における1位と2位の総資産差の中央値です。小さいほど接戦で勝ち切っています。",
    key: "win-margin",
    label: "勝利時の差",
    value: formatMoney(metrics.winMedianMargin),
  };
  const lowerGap = {
    emphasis: risk,
    help: "3・4位だった試合における、1位との総資産差の中央値です。大きいほど下位時の負け幅が重く、注意根拠として扱います。",
    key: "lower-gap",
    label: "下位時の差",
    value: formatMoney(metrics.lowerHalfMedianGap),
  };
  const winAssets = {
    emphasis: strength,
    help: "勝った試合における総資産の中央値です。高いほど、総資産を取り切って勝つ根拠として扱います。",
    key: "win-assets",
    label: "勝利時資産",
    value: formatMoney(metrics.winMedianAssets),
  };
  const secondGap = {
    emphasis: evidence,
    help: "2位だった試合における、1位との総資産差の中央値です。小さいほど、上位を追走している根拠として扱います。",
    key: "second-gap",
    label: "2位時の差",
    value: formatMoney(metrics.secondMedianGap),
  };
  const medianAssets = {
    key: "median-assets",
    label: "中央値",
    value: formatMoney(metrics.medianAssets),
  };
  const spread = {
    key: "spread",
    label: "高め-低め",
    value: formatMoney(metrics.p90P10Spread),
  };

  switch (profile.primaryKind) {
    case "asset_explosion":
      return [highAsset, winAssets, blowoutWin];
    case "steady_accumulator":
      return [lowAssetAvoided, medianAssets, spread];
    case "high_risk_breakthrough":
      return [highAsset, lowAssetRisk, lowerGap];
    case "close_collector":
      return [closeWin, fewBlowoutWins, secondGap];
    case "upper_chaser":
      return [secondGap, closeWin, highAsset];
    default:
      return [highAsset, lowAsset, spread];
  }
}

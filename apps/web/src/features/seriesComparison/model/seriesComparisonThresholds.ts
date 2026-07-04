export const SERIES_COMPARISON_THRESHOLDS = {
  averageRankSpread: {
    matureMatchCount: 50,
    early: {
      flatBelow: 0.2,
      largeFrom: 0.6,
      smallBelow: 0.35,
    },
    mature: {
      flatBelow: 0.15,
      largeFrom: 0.5,
      smallBelow: 0.25,
    },
  },
  headToHead: {
    averageRankDiff: {
      matureSlightFrom: 0.15,
      matureStrongFrom: 0.25,
    },
    matureMatchCount: 50,
    referenceMaxMatchCount: 2,
    early: {
      slightAdvantageFrom: 0.55,
      slightDisadvantageTo: 0.45,
      strongAdvantageFrom: 0.65,
      strongDisadvantageTo: 0.35,
    },
    mature: {
      slightAdvantageFrom: 0.52,
      slightDisadvantageTo: 0.48,
      strongAdvantageFrom: 0.6,
      strongDisadvantageTo: 0.4,
    },
  },
  momentumSwitch: {
    minimumOkTargetCount: 8,
    deltaPointThresholds: {
      afterFourth: 0.1,
      afterLower: 0.06,
      afterPodium: 0.06,
    },
  },
} as const;

export function averageRankSpreadBands(matchCount: number | null | undefined) {
  return isMatureSample(matchCount, SERIES_COMPARISON_THRESHOLDS.averageRankSpread.matureMatchCount)
    ? SERIES_COMPARISON_THRESHOLDS.averageRankSpread.mature
    : SERIES_COMPARISON_THRESHOLDS.averageRankSpread.early;
}

export function headToHeadBands(matchCount: number | null | undefined) {
  return isMatureSample(matchCount, SERIES_COMPARISON_THRESHOLDS.headToHead.matureMatchCount)
    ? SERIES_COMPARISON_THRESHOLDS.headToHead.mature
    : SERIES_COMPARISON_THRESHOLDS.headToHead.early;
}

export function headToHeadRankDiffSignal(
  averageRankDiff: number | null | undefined,
  matchCount: number | null | undefined,
): "strong_negative" | "strong_positive" | "slight_negative" | "slight_positive" | undefined {
  if (!isMatureSample(matchCount, SERIES_COMPARISON_THRESHOLDS.headToHead.matureMatchCount)) {
    return undefined;
  }
  if (typeof averageRankDiff !== "number" || !Number.isFinite(averageRankDiff)) {
    return undefined;
  }
  const absoluteDiff = Math.abs(averageRankDiff);
  if (absoluteDiff >= SERIES_COMPARISON_THRESHOLDS.headToHead.averageRankDiff.matureStrongFrom) {
    return averageRankDiff > 0 ? "strong_positive" : "strong_negative";
  }
  if (absoluteDiff >= SERIES_COMPARISON_THRESHOLDS.headToHead.averageRankDiff.matureSlightFrom) {
    return averageRankDiff > 0 ? "slight_positive" : "slight_negative";
  }
  return undefined;
}

function isMatureSample(matchCount: number | null | undefined, threshold: number): boolean {
  return typeof matchCount === "number" && Number.isFinite(matchCount) && matchCount >= threshold;
}

import type {
  SeriesComparisonOptionsResponse,
  SeriesComparisonQuery,
  SeriesComparisonResponse,
  SeriesComparisonScopeKind,
} from "@/shared/api/seriesComparison";

export type SeriesComparisonUrlState = {
  gameTitleId?: string | undefined;
  scopeKind: SeriesComparisonScopeKind;
  scopeId?: string | undefined;
};

export type SeriesComparisonScopeChoice = {
  disabled?: boolean;
  label: string;
  value: SeriesComparisonScopeKind;
};

type PlayerMetrics = NonNullable<SeriesComparisonResponse["metricsByPlayer"]>[number]["metrics"];
type PlayOrderBreakdown = NonNullable<PlayerMetrics["playOrder"]["breakdown"]>[number];
type NullableNumber = number | null | undefined;

export type PlayOrderSignal = {
  best: PlayOrderBreakdown | undefined;
  spread: number | undefined;
  worst: PlayOrderBreakdown | undefined;
};

const scopeKinds = new Set(["overall", "season", "map"]);

function isNumber(value: NullableNumber): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function parseSeriesComparisonSearchParams(
  params: URLSearchParams,
): SeriesComparisonUrlState {
  const rawKind = params.get("scopeKind")?.trim();
  const scopeKind = scopeKinds.has(rawKind ?? "")
    ? (rawKind as SeriesComparisonScopeKind)
    : "overall";
  const scopeId = params.get("scopeId")?.trim() || undefined;
  return {
    gameTitleId: params.get("gameTitleId")?.trim() || undefined,
    scopeKind,
    scopeId: scopeKind === "overall" ? undefined : scopeId,
  };
}

export function buildSeriesComparisonSearchParams(
  state: SeriesComparisonUrlState,
): URLSearchParams {
  const params = new URLSearchParams();
  if (state.gameTitleId) {
    params.set("gameTitleId", state.gameTitleId);
  }
  params.set("scopeKind", state.scopeKind);
  if (state.scopeKind !== "overall" && state.scopeId) {
    params.set("scopeId", state.scopeId);
  }
  return params;
}

export function normalizeSeriesComparisonSelection(
  options: SeriesComparisonOptionsResponse | undefined,
  state: SeriesComparisonUrlState,
): SeriesComparisonUrlState {
  const series = options?.series ?? [];
  const fallbackGameTitleId = options?.latestConfirmedGameTitleId ?? series[0]?.gameTitleId;
  const selectedSeries =
    series.find((item) => item.gameTitleId === state.gameTitleId) ??
    series.find((item) => item.gameTitleId === fallbackGameTitleId) ??
    series[0];

  if (!selectedSeries) {
    return { gameTitleId: undefined, scopeKind: "overall", scopeId: undefined };
  }

  const validKind = availableScopeKinds(selectedSeries).some(
    (choice) => choice.value === state.scopeKind,
  )
    ? state.scopeKind
    : "overall";
  if (validKind === "overall") {
    return { gameTitleId: selectedSeries.gameTitleId, scopeKind: "overall", scopeId: undefined };
  }

  const candidates =
    validKind === "season" ? (selectedSeries.seasons ?? []) : (selectedSeries.maps ?? []);
  const selectedScope = candidates.find((item) => item.id === state.scopeId) ?? candidates[0];
  return {
    gameTitleId: selectedSeries.gameTitleId,
    scopeKind: validKind,
    scopeId: selectedScope?.id,
  };
}

export function seriesComparisonQueryFromState(
  state: SeriesComparisonUrlState,
): SeriesComparisonQuery | undefined {
  if (!state.gameTitleId) {
    return undefined;
  }
  if (state.scopeKind !== "overall" && !state.scopeId) {
    return undefined;
  }
  return {
    gameTitleId: state.gameTitleId,
    scopeKind: state.scopeKind,
    scopeId: state.scopeKind === "overall" ? undefined : state.scopeId,
  };
}

export function findSelectedSeries(
  options: SeriesComparisonOptionsResponse | undefined,
  gameTitleId: string | undefined,
) {
  return (options?.series ?? []).find((series) => series.gameTitleId === gameTitleId);
}

export function availableScopeKinds(
  series: NonNullable<SeriesComparisonOptionsResponse["series"]>[number],
): SeriesComparisonScopeChoice[] {
  return [
    { label: "総合", value: "overall" },
    {
      disabled: (series.seasons ?? []).length === 0,
      label: "シーズン",
      value: "season",
    },
    {
      disabled: (series.maps ?? []).length === 0,
      label: "マップ",
      value: "map",
    },
  ];
}

export function scopeNameForState(
  options: SeriesComparisonOptionsResponse | undefined,
  state: SeriesComparisonUrlState,
): string {
  const selectedSeries = findSelectedSeries(options, state.gameTitleId);
  if (!selectedSeries) {
    return "";
  }
  if (state.scopeKind === "overall") {
    return "総合";
  }
  const candidates =
    state.scopeKind === "season" ? (selectedSeries.seasons ?? []) : (selectedSeries.maps ?? []);
  return candidates.find((item) => item.id === state.scopeId)?.name ?? "";
}

export function averageRankSpread(response: SeriesComparisonResponse): {
  label: string;
  spread: number | undefined;
  tone: "flat" | "small" | "visible" | "large";
} {
  const values = (response.metricsByPlayer ?? [])
    .map((entry) => entry.metrics.rank.average)
    .filter(isNumber);
  if (values.length < 2) {
    return { label: "比較材料不足", spread: undefined, tone: "flat" };
  }
  const spread = Math.max(...values) - Math.min(...values);
  if (spread < 0.15) {
    return { label: "横一線", spread, tone: "flat" };
  }
  if (spread < 0.25) {
    return { label: "小差", spread, tone: "small" };
  }
  if (spread < 0.6) {
    return { label: "中差", spread, tone: "visible" };
  }
  return { label: "はっきり差", spread, tone: "large" };
}

export function playOrderSignal(metrics: PlayerMetrics | undefined): PlayOrderSignal {
  const ranked = (metrics?.playOrder.breakdown ?? [])
    .filter((item): item is PlayOrderBreakdown & { rankAverage: number } =>
      isNumber(item.rankAverage),
    )
    .toSorted((a, b) => a.rankAverage - b.rankAverage);
  const best = ranked[0];
  const worst = ranked.at(-1);
  return {
    best,
    spread: best && worst && ranked.length >= 2 ? worst.rankAverage - best.rankAverage : undefined,
    worst,
  };
}

export function ginjiSummary(response: SeriesComparisonResponse): {
  abnormalMatches: number;
  totalEncounters: number;
  warningPlayerIds: string[];
} {
  const entries = response.metricsByPlayer ?? [];
  return {
    abnormalMatches: entries.reduce(
      (sum, entry) => sum + entry.metrics.ginji.multiEncounterMatchCount,
      0,
    ),
    totalEncounters: entries.reduce((sum, entry) => sum + entry.metrics.ginji.count, 0),
    warningPlayerIds: entries
      .filter((entry) => entry.metrics.ginji.multiEncounterMatchCount > 0)
      .map((entry) => entry.memberId),
  };
}

export function qualitySummary(response: SeriesComparisonResponse): {
  noTargetCount: number;
  referenceCount: number;
} {
  const items = response.dataQuality.items ?? [];
  return {
    noTargetCount: items.filter((item) => item.status === "no_target").length,
    referenceCount: items.filter((item) => item.status === "reference").length,
  };
}

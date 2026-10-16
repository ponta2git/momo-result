import {
  defaultOwnerMetric,
  isOwnerMetricId,
} from "@/features/seriesComparison/model/seriesAnalysisOwnerMetrics";
import {
  defaultSeriesAnalysisView,
  normalizeSeriesAnalysisView,
  isSeriesAnalysisViewId,
} from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import type { SeriesAnalysisSelection } from "@/features/seriesComparison/model/seriesAnalysisViewModel";

export function parseSeriesAnalysisSearchParams(params: URLSearchParams): SeriesAnalysisSelection {
  const gameTitleId = params.get("gameTitleId")?.trim() || undefined;
  const seasonMasterId = params.get("seasonMasterId")?.trim() || undefined;
  const mapMasterId = params.get("mapMasterId")?.trim() || undefined;
  const focusMatchId = params.get("focusMatchId")?.trim() || undefined;
  const view = normalizeSeriesAnalysisView(params.get("view")?.trim());
  const rawMetric = params.get("ownerMetric");
  const ownerMetric = isOwnerMetricId(rawMetric) ? rawMetric : defaultOwnerMetric;
  const focusMemberId = params.get("focusMemberId")?.trim() || undefined;
  const rivalMemberId = params.get("rivalMemberId")?.trim() || undefined;
  return {
    focusMatchId,
    gameTitleId,
    mapMasterId,
    seasonMasterId,
    view,
    ownerMetric,
    ...(focusMemberId ? { focusMemberId } : {}),
    ...(rivalMemberId ? { rivalMemberId } : {}),
  };
}

export function buildSeriesAnalysisSearchParams(state: SeriesAnalysisSelection): URLSearchParams {
  const params = new URLSearchParams();
  if (state.ownerMetric && state.ownerMetric !== defaultOwnerMetric)
    params.set("ownerMetric", state.ownerMetric);
  if (state.gameTitleId) params.set("gameTitleId", state.gameTitleId);
  if (state.seasonMasterId) params.set("seasonMasterId", state.seasonMasterId);
  if (state.mapMasterId) params.set("mapMasterId", state.mapMasterId);
  if (state.focusMatchId) params.set("focusMatchId", state.focusMatchId);
  if (state.focusMemberId) params.set("focusMemberId", state.focusMemberId);
  if (state.rivalMemberId) params.set("rivalMemberId", state.rivalMemberId);
  const view = normalizeSeriesAnalysisView(state.view);
  if (view !== defaultSeriesAnalysisView) params.set("view", view);
  return params;
}

export function seriesAnalysisNormalizationNotice(
  params: URLSearchParams,
  requested: SeriesAnalysisSelection,
  normalized: SeriesAnalysisSelection,
): string | undefined {
  const reasons: string[] = [];
  if (requested.gameTitleId && requested.gameTitleId !== normalized.gameTitleId) {
    reasons.push(
      normalized.gameTitleId
        ? "指定された作品は比較できないため、選択可能な作品に切り替えました。"
        : "指定された作品は比較できないため、作品の選択を解除しました。",
    );
  }
  if (requested.seasonMasterId && requested.seasonMasterId !== normalized.seasonMasterId) {
    reasons.push("指定されたシーズンは比較できないため、全シーズンに戻しました。");
  }
  if (requested.mapMasterId && requested.mapMasterId !== normalized.mapMasterId) {
    reasons.push("指定されたマップは現在の比較条件で利用できないため、全マップに戻しました。");
  }
  const rawView = params.get("view");
  if (rawView !== null && !isSeriesAnalysisViewId(rawView.trim())) {
    reasons.push("指定された表示は利用できないため、振り返りに戻しました。");
  }
  const rawMetric = params.get("ownerMetric");
  if (rawMetric !== null && !isOwnerMetricId(rawMetric)) {
    reasons.push("オーナー比較の指標を平均順位に戻しました。");
  }
  if (requested.focusMatchId && !normalized.focusMatchId) {
    reasons.push("比較条件が変わったため、選択試合の強調表示を解除しました。");
  }
  if (
    (requested.focusMemberId && requested.focusMemberId !== normalized.focusMemberId) ||
    (requested.rivalMemberId && requested.rivalMemberId !== normalized.rivalMemberId)
  ) {
    reasons.push(
      "比較する人物を、異なる固定メンバーに調整しました。新しい2名の直近成績から試します。",
    );
  }
  return reasons.length > 0 ? reasons.join(" ") : undefined;
}

import { normalizeDisplayApiError } from "@/shared/api/problemDetails";
import type {
  SeriesAnalysisAdminOverview,
  SeriesAnalysisRecalculationAccepted,
} from "@/shared/api/seriesAnalysis";

export type AnalysisAdminTitle = NonNullable<SeriesAnalysisAdminOverview["selectedTitle"]>;
export type RecalculationTarget =
  | { kind: "all" }
  | { kind: "title"; gameTitleId: string; gameTitleName: string };

export function buildAnalysisAdminOverviewView(
  data: SeriesAnalysisAdminOverview | undefined,
  gameTitleId: string | undefined,
) {
  const selectedTitle =
    data?.selectedTitle && data.selectedTitle.gameTitleId === gameTitleId
      ? data.selectedTitle
      : null;
  return {
    data,
    selection: {
      gameTitleId,
      selectedTitle,
      options:
        data?.titleOptions.map((title) => ({
          label: `${title.gameTitleName} (${title.confirmedMatchCount}戦)`,
          value: title.gameTitleId,
        })) ?? [],
    },
  };
}

export function recalculationTargetForTitle(
  title: AnalysisAdminTitle | null,
): RecalculationTarget | undefined {
  return title && !title.pendingManualRun
    ? { kind: "title", gameTitleId: title.gameTitleId, gameTitleName: title.gameTitleName }
    : undefined;
}

export function buildRecalculationView({
  target,
  response,
  error,
  pending,
  selectedTitle,
  selectedGameTitleId,
}: {
  target: RecalculationTarget | undefined;
  response: SeriesAnalysisRecalculationAccepted | undefined;
  error: unknown;
  pending: boolean;
  selectedTitle: AnalysisAdminTitle | null;
  selectedGameTitleId: string | undefined;
}) {
  const acceptance =
    response && target
      ? target.kind === "all"
        ? {
            detail: "作品ごとの処理として順番に実行します。",
            title: `${response.targetCount}作品の再計算を受け付けました`,
          }
        : {
            detail: "受付後の状態は、この画面の実行状況と処理履歴へ反映されます。",
            title:
              response.target?.requestDisposition === "forced_run_reserved"
                ? `${target.gameTitleName}は現在の計算後に再計算します`
                : `${target.gameTitleName}の再計算を受け付けました`,
          }
      : undefined;
  const visibleError =
    target?.kind === "title" && target.gameTitleId !== selectedGameTitleId ? null : error;
  return {
    acceptance,
    error: visibleError
      ? normalizeDisplayApiError(visibleError, "再計算を受け付けられません")
      : undefined,
    status: {
      pending,
      allPending: pending && target?.kind === "all",
      titlePending: pending && target?.kind === "title",
      titlePendingLabel:
        target?.kind === "title" ? `${target.gameTitleName}を受け付け中` : "受け付け中",
      titleUnavailable: !selectedTitle,
      titleReserved: Boolean(selectedTitle?.pendingManualRun),
    },
  };
}

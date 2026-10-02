import type { PlayerRadarAdminModel } from "@/features/seriesAnalysisAdmin/playerRadarAdminModel";
import { formatApiError, normalizeUnknownApiError } from "@/shared/api/problemDetails";
import type {
  SeriesPlayerRadarOperation,
  SeriesPlayerRadarState,
} from "@/shared/api/seriesPlayerRadar";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { playerRadarAxes } from "@/shared/seriesAnalysis/playerRadarPresentation";

export function radarSubmissionUncertain(error: unknown): boolean {
  if (!error) return false;
  const normalized = normalizeUnknownApiError(error);
  return (
    normalized.status === undefined ||
    normalized.status >= 500 ||
    normalized.category === "idempotency_in_progress"
  );
}

export function radarCommandErrorMessage(error: unknown): string {
  if (radarSubmissionUncertain(error))
    return "操作の受付結果はまだ不明です。この確認を閉じて「操作の状態を確認する」を選んでください。";
  if (normalizeUnknownApiError(error).status === 409)
    return "記録・変更案・基準の状態が変わりました。この確認を閉じて「基準の状態を更新」から最新の比較を確認してください。";
  return formatApiError(error, "操作を受け付けられません");
}

const operationNames = {
  candidate: "変更案の作成",
  preview: "比較の計算",
  apply: "基準の適用",
  withdraw: "取り下げ",
  restore: "前回の基準からの変更案の作成",
  acknowledge: "見直し目安の確認",
  retry: "再試行",
} as const;

export function radarFailureMessage(code: string | null): string {
  switch (code) {
    case "source_changed":
    case "candidate_source_changed":
      return "変更案の作成元の記録が変わったため、適用できません。最新の記録から変更案を作り直してください。";
    case "preview_stale":
      return "比較後に記録または適用中の基準が変わりました。最新の記録で比較を計算してください。";
    case "basis_incompatible":
      return "現在の指標・計算方法ではこの基準を適用できません。新しい変更案を作成してください。";
    default:
      return "処理を完了できませんでした。現在の状態を確認し、変更案が有効なら再試行してください。";
  }
}

export function radarOperationPresentation(
  operation: SeriesPlayerRadarOperation,
): NonNullable<PlayerRadarAdminModel["operation"]> {
  const name = operationNames[operation.kind];
  const title =
    operation.status === "pending"
      ? `${name}を受け付けました`
      : operation.status === "running"
        ? `${name}中です`
        : operation.status === "failed"
          ? `${name}を完了できませんでした`
          : operation.status === "withdrawn"
            ? `${name}を取り下げました`
            : `${name}が完了しました`;
  return {
    operationId: operation.operationId,
    kind: operation.kind,
    status: operation.status,
    title,
    detail: operation.status === "failed" ? radarFailureMessage(operation.safeFailureCode) : "",
  };
}

export function radarReviewPresentation(
  state: SeriesPlayerRadarState,
): PlayerRadarAdminModel["review"] {
  const monitor = state.monitor;
  if (!monitor)
    return {
      explanation: state.currentBasis ? "見直しの目安は未計算です。" : null,
      reasons: [],
    };
  const explanation =
    monitor.status === "basis_unavailable"
      ? null
      : monitor.status === "insufficient_matches"
        ? `基準の作成元より新しい記録は${monitor.postSourceMatchCount}試合です。判定には40試合・8開催が必要です。`
        : monitor.status === "insufficient_events"
          ? `対象${monitor.evaluatedMatchCount}試合は${monitor.evaluatedHeldEventCount}開催分です（8開催以上で判定）。`
          : null;
  return {
    explanation,
    reasons: monitor.reasons.map((reason) => {
      const label =
        reason.kind === "initial_basis_eligible"
          ? "初回基準を作成できます。"
          : reason.kind === "source_changed"
            ? "基準を作った記録に訂正があります。"
            : reason.kind === "new_map"
              ? "作成元にないマップの記録が加わりました。"
              : `${reason.axisIds.map((id) => playerRadarAxes.find((axis) => axis.id === id)?.label ?? id).join("・")}で、続く2期間とも4人中3人以上が9点以上です。`;
      return {
        evidenceKey: reason.evidenceChecksum,
        label,
        acknowledged: state.acknowledgedEvidenceKeys.includes(reason.evidenceChecksum),
        evidence:
          reason.kind === "high_score_concentration"
            ? [
                {
                  label: "対象記録",
                  value: `${monitor.evaluatedMatchCount}試合・${monitor.evaluatedHeldEventCount}開催`,
                },
                ...monitor.latestWindows.map((window, index) => ({
                  label: `${index + 1}つ目の期間`,
                  value: `${formatDateTimeLong(window.firstMatch.playedAt)}〜${formatDateTimeLong(window.lastMatch.playedAt)}（${window.evaluation.sample.matchCount}試合・${window.evaluation.sample.heldEventCount}開催）`,
                })),
              ]
            : [],
      };
    }),
  };
}

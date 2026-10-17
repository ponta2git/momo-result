import type {
  PlayerRadarAdminModel,
  PlayerRadarApplyTarget,
} from "@/features/seriesAnalysisAdmin/radar/playerRadarAdminTypes";
import type { RadarApplyConfirmationView } from "@/features/seriesAnalysisAdmin/radar/radarThresholdEditorModel";

type RadarApplyConfirmation = {
  target: PlayerRadarApplyTarget & { basisId: string };
  gameTitleName: string;
  createdAt: string | null;
  matchCount: number;
  heldEventCount: number;
};
export function radarApplyConfirmation(
  model: PlayerRadarAdminModel,
): RadarApplyConfirmation | null {
  if (model.candidate?.status !== "ready" || !model.preview) return null;
  const basis = model.preview.candidateBasis;
  return {
    target: {
      gameTitleId: model.gameTitleId,
      candidateId: model.candidate.candidateId,
      previewId: model.preview.previewId,
      basisId: basis.basisId,
      expectedCurrentBasisId: model.currentBasis?.basisId ?? null,
    },
    gameTitleName: model.gameTitleName,
    createdAt: basis.createdAt,
    matchCount: basis.source.matchCount,
    heldEventCount: basis.source.heldEventCount,
  };
}
export function radarApplyConfirmationChanged(
  confirmed: RadarApplyConfirmation | null,
  current: RadarApplyConfirmation | null,
) {
  if (!confirmed) return false;
  return (
    !current ||
    confirmed.target.gameTitleId !== current.target.gameTitleId ||
    confirmed.target.candidateId !== current.target.candidateId ||
    confirmed.target.previewId !== current.target.previewId ||
    confirmed.target.expectedCurrentBasisId !== current.target.expectedCurrentBasisId
  );
}
export function radarApplyConfirmationView({
  model,
  confirmation,
  current,
  open,
  editorActive,
  active,
  canApply,
  applyError,
  formalMismatch,
  contextChanged,
  comparisonChanged,
}: {
  model: PlayerRadarAdminModel;
  confirmation: RadarApplyConfirmation | null;
  current: RadarApplyConfirmation | null;
  open: boolean;
  editorActive: boolean;
  active: boolean;
  canApply: boolean;
  applyError: string | null;
  formalMismatch: boolean;
  contextChanged: boolean;
  comparisonChanged: boolean;
}): RadarApplyConfirmationView {
  const changed = radarApplyConfirmationChanged(confirmation, current);
  const disabledReason =
    model.applyDisabledReason ??
    (editorActive && !canApply ? "入力した境界の確認が必要です。" : null);
  return {
    open: editorActive && active && (open || confirmation !== null),
    disabled: !confirmation || Boolean(disabledReason) || changed,
    changed,
    gameTitleName: confirmation?.gameTitleName ?? model.gameTitleName,
    facts: confirmation
      ? {
          createdAt: confirmation.createdAt,
          matchCount: confirmation.matchCount,
          heldEventCount: confirmation.heldEventCount,
        }
      : null,
    waitingMessage:
      editorActive && !canApply
        ? (model.editing?.permissionReason ??
          applyError ??
          (formalMismatch
            ? "比較結果が一致しません。キャンセルして入力と比較を確認してください。"
            : contextChanged || comparisonChanged
              ? "基準または比較が変わりました。キャンセルして最新の内容を確認してください。"
              : "入力した境界を確認しています。確認が終わるまで適用されません。"))
        : null,
  };
}

import { slotDefinitions } from "@/features/ocrCapture/captureState";
import type { OcrSubmissionPlan } from "@/features/ocrCapture/ocrSubmissionPlan";
import type {
  OcrSubmissionProgress,
  OcrSubmissionResult,
} from "@/features/ocrCapture/ocrSubmissionWorkflow";
import { formatApiError, normalizeUnknownApiError } from "@/shared/api/problemDetails";
import type { SlotKind } from "@/shared/domain/ocr";

export type OcrStartState =
  | { status: "closed" }
  | { plan: OcrSubmissionPlan; status: "confirming" }
  | {
      plan: OcrSubmissionPlan;
      progress: OcrSubmissionProgress | null;
      status: "submitting";
    }
  | {
      createdJobCount: number;
      failedJobCount: number;
      plan: OcrSubmissionPlan;
      status: "partial_result";
    }
  | { canEdit: boolean; message: string; plan: OcrSubmissionPlan; status: "recoverable_failure" }
  | { canRestart: boolean; plan: OcrSubmissionPlan; status: "submission_closed" };

export type OcrStartSummary = {
  readonly selectedKinds: readonly SlotKind[];
  readonly setup: Readonly<OcrSubmissionPlan["setupSummary"]>;
};
type OcrProgressView =
  | { kind: "preparing"; label: string }
  | { kind: "determinate"; label: string; value: number; total: number };
export type OcrStartDialogView =
  | { status: "closed" }
  | { status: "confirming"; summary: OcrStartSummary }
  | { status: "submitting"; progress: OcrProgressView }
  | {
      status: "partial_result";
      createdJobCount: number;
      failedJobCount: number;
      destinationLabel: string;
    }
  | { status: "recoverable_failure"; canEdit: boolean; message: string; destinationLabel: string }
  | { status: "submission_closed"; canRestart: boolean; destinationLabel: string };

export function buildOcrStartDialogView(state: OcrStartState): OcrStartDialogView {
  if (state.status === "closed") return state;
  const destinationLabel = state.plan.setup.heldEventId ? "開催詳細で確認" : "下書きで確認";
  switch (state.status) {
    case "confirming":
      return {
        status: state.status,
        summary: {
          setup: state.plan.setupSummary,
          selectedKinds: state.plan.slots.map((slot) => slot.kind),
        },
      };
    case "submitting":
      return { status: state.status, progress: ocrProgressView(state) };
    case "partial_result":
      return {
        status: state.status,
        createdJobCount: state.createdJobCount,
        failedJobCount: state.failedJobCount,
        destinationLabel,
      };
    case "recoverable_failure":
      return {
        status: state.status,
        canEdit: state.canEdit,
        message: state.message,
        destinationLabel,
      };
    case "submission_closed":
      return { status: state.status, canRestart: state.canRestart, destinationLabel };
  }
}

function ocrProgressView(state: Extract<OcrStartState, { status: "submitting" }>): OcrProgressView {
  const { progress } = state;
  const total = progress?.total ?? state.plan.slots.length;
  if (!progress || progress.phase === "creating_draft")
    return { kind: "preparing", label: "試合の記録を準備しています" };
  if (progress.phase === "finalizing")
    return {
      kind: "determinate",
      label: "読み取りの受け付けを確認しています",
      value: progress.completed,
      total,
    };
  const slotLabel =
    slotDefinitions.find((definition) => definition.kind === progress.slotKind)?.label ?? "画像";
  return {
    kind: "determinate",
    label: `${progress.current}/${progress.total}件目・${slotLabel}を送信しています`,
    value: progress.current - 1,
    total,
  };
}

export function resolveOcrStartResult(
  plan: OcrSubmissionPlan,
  result: OcrSubmissionResult,
  noUncertainAcceptance: boolean,
): { kind: "started"; createdJobCount: number } | { kind: "dialog"; state: OcrStartState } {
  if (result.status === "started")
    return { kind: "started", createdJobCount: result.createdJobCount };
  if (result.status === "submission_closed")
    return {
      kind: "dialog",
      state: { status: "submission_closed", plan, canRestart: result.canRestart },
    };
  if (result.status === "partial_started")
    return {
      kind: "dialog",
      state: {
        status: "partial_result",
        plan,
        createdJobCount: result.createdJobCount,
        failedJobCount: result.failedJobCount,
      },
    };
  const message =
    result.status === "draft_create_failed"
      ? formatApiError(result.error, "確定前の記録を作成できませんでした")
      : result.status === "invalid"
        ? result.message
        : result.status === "empty"
          ? "読み取る画像がありません。画像を確認してから、もう一度お試しください。"
          : "送信の完了を確認できませんでした。同じ内容で再試行すると、受け付け済みの処理から再開します。";
  const canEdit =
    noUncertainAcceptance &&
    (result.status === "invalid" ||
      result.status === "empty" ||
      (result.status === "draft_create_failed" && isDefinitiveRejection(result.error)));
  return { kind: "dialog", state: { canEdit, message, plan, status: "recoverable_failure" } };
}

function isDefinitiveRejection(error: unknown): boolean {
  const { status } = normalizeUnknownApiError(error);
  return (
    status !== undefined &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 409 &&
    status !== 429
  );
}

import type { CaptureSlotState, InputSource, SlotStatus } from "@/features/ocrCapture/captureState";
import { captureSlotCapabilities } from "@/features/ocrCapture/slotPolicy";
import type { OcrDraftResponse } from "@/shared/api/ocrDrafts";
import type { SlotKind } from "@/shared/domain/ocr";

export type CaptureSlotView = {
  readonly kind: SlotKind;
  readonly previewUrl: string | undefined;
  readonly source: InputSource | undefined;
  readonly status: SlotStatus;
  readonly detectedKind: SlotKind | undefined;
  readonly mismatch: boolean;
  readonly transportError: { readonly title: string; readonly detail: string } | undefined;
  readonly failureAction: string | undefined;
  readonly capabilities: Readonly<ReturnType<typeof captureSlotCapabilities>>;
  readonly refreshing: boolean;
  readonly draft: { readonly screen: string; readonly warning: string | null } | null;
};

function warningSummary(value: unknown): string | null {
  if (!value) return null;
  if (Array.isArray(value))
    return value.length === 0 ? null : `${value.length}件の確認事項があります。`;
  if (typeof value === "object")
    return Object.keys(value).length === 0
      ? null
      : "確認事項があります。結果確認画面で内容を確認してください。";
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

export function buildCaptureSlotView(
  slot: CaptureSlotState,
  draft: OcrDraftResponse | undefined,
  refreshing: boolean,
): CaptureSlotView {
  const screenLabels: Record<string, string> = {
    incident_log: "事件簿",
    revenue: "収益",
    total_assets: "総資産",
  };
  return {
    kind: slot.kind,
    previewUrl: slot.previewUrl,
    source: slot.source,
    status: slot.status,
    detectedKind: slot.detectedKind,
    mismatch: Boolean(slot.detectedKind && slot.detectedKind !== slot.kind),
    transportError: slot.transportError
      ? { title: slot.transportError.title, detail: slot.transportError.detail }
      : undefined,
    failureAction: slot.jobFailure
      ? (slot.jobFailure.userAction ?? "画像を確認して、もう一度読み取りを開始してください。")
      : undefined,
    capabilities: captureSlotCapabilities(slot),
    refreshing,
    draft: draft
      ? {
          screen: screenLabels[draft.detectedScreenType ?? ""] ?? "判定できませんでした",
          warning: warningSummary(draft.warningsJson),
        }
      : null,
  };
}

import type { DragEvent } from "react";

import type { OcrDraftResponse } from "@/features/ocrCapture/api";
import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import { DraftPreview } from "@/features/ocrCapture/DraftPreview";
import type { SlotKind } from "@/shared/api/enums";
import { parseSlotKind } from "@/shared/api/enums";
import { Button } from "@/shared/ui/actions/Button";
import { StatusBadge } from "@/shared/ui/StatusBadge";

type CaptureSlotCardProps = {
  slot: CaptureSlotState;
  label: string;
  stationLabel: string;
  accentClass: string;
  draft?: OcrDraftResponse | undefined;
  index: number;
  total: number;
  onClear: () => void;
  onDropImage: (sourceKind: SlotKind, targetKind: SlotKind) => void;
  onMoveImage: (direction: -1 | 1) => void;
  onManualRefresh: () => void;
};

const sourceLabels = {
  camera: "撮影",
  upload: "単体追加",
};

export function CaptureSlotCard({
  slot,
  label,
  stationLabel,
  accentClass,
  draft,
  index,
  total,
  onClear,
  onDropImage,
  onMoveImage,
  onManualRefresh,
}: CaptureSlotCardProps) {
  const mismatch = slot.detectedKind && slot.detectedKind !== slot.kind;
  const hasImage = Boolean(slot.previewUrl);

  function handleDragStart(event: DragEvent<HTMLDivElement>) {
    if (!hasImage) {
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", slot.kind);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const sourceKind = parseSlotKind(event.dataTransfer.getData("text/plain"));
    if (sourceKind) {
      onDropImage(sourceKind, slot.kind);
    }
  }

  return (
    <section
      className="relative overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={handleDrop}
    >
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${accentClass}`} />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-full border border-[var(--color-action)]/40 bg-[var(--color-action)]/10 text-sm font-semibold text-[var(--color-action)]">
              {stationLabel}
            </span>
            <div>
              <p className="text-xs font-semibold text-[var(--color-text-secondary)]">OCR種別</p>
              <h2 className="mt-0.5 text-lg font-semibold text-[var(--color-text-primary)]">
                {label}
              </h2>
            </div>
          </div>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            このホームの画像は「{label}」として送信します。
          </p>
        </div>
        <StatusBadge status={slot.status} />
      </div>

      {slot.previewUrl ? (
        <div
          className="mt-4 cursor-grab rounded-[var(--radius-md)] border border-[var(--color-border)] bg-slate-950 p-2 active:cursor-grabbing"
          draggable
          onDragStart={handleDragStart}
        >
          <img
            src={slot.previewUrl}
            alt={`${label}プレビュー`}
            className="aspect-video w-full rounded-[var(--radius-sm)] object-contain"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-200">
            <span>{slot.source ? `${sourceLabels[slot.source]}した画像` : "配置済み画像"}</span>
            <span>ドラッグして別の分類へ移動</span>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid aspect-video place-items-center rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-4 text-center text-sm text-[var(--color-text-secondary)]">
          <span>
            {label}画像をここへ配置
            <br />
            <span className="text-xs">空きホーム</span>
          </span>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onClear} disabled={slot.status === "empty"}>
          削除
        </Button>
        <Button
          variant="secondary"
          onClick={() => onMoveImage(-1)}
          disabled={!hasImage || index === 0}
        >
          前の分類へ
        </Button>
        <Button
          variant="secondary"
          onClick={() => onMoveImage(1)}
          disabled={!hasImage || index === total - 1}
        >
          次の分類へ
        </Button>
      </div>

      {mismatch ? (
        <div
          className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-warning)]/60 bg-[var(--color-warning)]/20 p-3 text-sm text-[var(--color-text-primary)]"
          role="alert"
        >
          OCR判定は <strong>{slot.detectedKind}</strong>{" "}
          でした。画像を正しい分類へ移動してから、もう一度「OCRにかけて下書き保存」を実行してください。
        </div>
      ) : null}

      {slot.transportError ? (
        <div
          className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-danger)]/45 bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-text-primary)]"
          role="alert"
        >
          <strong>{slot.transportError.title}</strong>
          <p className="mt-1">{slot.transportError.detail}</p>
        </div>
      ) : null}

      {slot.jobFailure ? (
        <div
          className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-danger)]/45 bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-text-primary)]"
          role="alert"
        >
          <strong>{slot.jobFailure.code}</strong>
          <p className="mt-1">{slot.jobFailure.userAction ?? slot.jobFailure.message}</p>
        </div>
      ) : null}

      {slot.pollAttempts >= 15 && !["succeeded", "failed", "cancelled"].includes(slot.status) ? (
        <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-warning)]/60 bg-[var(--color-warning)]/20 p-3 text-sm text-[var(--color-text-primary)]">
          Worker未接続の可能性があります。
          <Button className="ml-3" variant="secondary" onClick={onManualRefresh}>
            手動で再取得
          </Button>
        </div>
      ) : null}

      <DraftPreview draft={draft} />
    </section>
  );
}

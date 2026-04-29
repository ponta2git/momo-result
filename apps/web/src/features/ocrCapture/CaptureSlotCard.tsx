import type { DragEvent } from "react";
import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import { DraftPreview } from "@/features/ocrCapture/DraftPreview";
import type { OcrDraftResponse } from "@/features/ocrCapture/api";
import type { SlotKind } from "@/shared/api/enums";
import { parseSlotKind } from "@/shared/api/enums";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { StatusBadge } from "@/shared/ui/StatusBadge";

type CaptureSlotCardProps = {
  slot: CaptureSlotState;
  label: string;
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
    <Card
      className="relative overflow-hidden"
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={handleDrop}
    >
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${accentClass}`} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black tracking-[0.28em] text-ink-300 uppercase">
            Classification Tray
          </p>
          <h2 className="mt-1 text-2xl font-black">{label}</h2>
          <p className="mt-1 text-sm text-ink-300">
            ここに置いた画像は「{label}」としてOCRへ送ります。
          </p>
        </div>
        <StatusBadge status={slot.status} />
      </div>

      {slot.previewUrl ? (
        <div
          className="mt-4 cursor-grab rounded-2xl border border-white/10 bg-black/20 p-2 active:cursor-grabbing"
          draggable
          onDragStart={handleDragStart}
        >
          <img
            src={slot.previewUrl}
            alt={`${label}プレビュー`}
            className="aspect-video w-full rounded-xl object-cover"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-ink-300">
            <span>{slot.source ? `${sourceLabels[slot.source]}した画像` : "配置済み画像"}</span>
            <span>ドラッグして別の分類へ移動</span>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid aspect-video place-items-center rounded-2xl border border-dashed border-white/15 bg-white/[0.03] text-sm text-ink-300">
          撮影した画像をここへドロップ
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
          左へ
        </Button>
        <Button
          variant="secondary"
          onClick={() => onMoveImage(1)}
          disabled={!hasImage || index === total - 1}
        >
          右へ
        </Button>
      </div>

      {mismatch ? (
        <div
          className="mt-4 rounded-2xl border border-rail-gold/30 bg-rail-gold/10 p-3 text-sm text-yellow-50"
          role="alert"
        >
          OCR判定は <strong>{slot.detectedKind}</strong>{" "}
          でした。画像を正しい分類へ移動してから、もう一度「OCRにかけて下書き保存」を実行してください。
        </div>
      ) : null}

      {slot.transportError ? (
        <div
          className="mt-4 rounded-2xl border border-red-300/30 bg-red-950/40 p-3 text-sm text-red-50"
          role="alert"
        >
          <strong>{slot.transportError.title}</strong>
          <p className="mt-1">{slot.transportError.detail}</p>
        </div>
      ) : null}

      {slot.jobFailure ? (
        <div
          className="mt-4 rounded-2xl border border-red-300/30 bg-red-950/40 p-3 text-sm text-red-50"
          role="alert"
        >
          <strong>{slot.jobFailure.code}</strong>
          <p className="mt-1">{slot.jobFailure.userAction ?? slot.jobFailure.message}</p>
        </div>
      ) : null}

      {slot.pollAttempts >= 15 && !["succeeded", "failed", "cancelled"].includes(slot.status) ? (
        <div className="mt-4 rounded-2xl border border-rail-gold/30 bg-rail-gold/10 p-3 text-sm text-yellow-50">
          Worker未接続の可能性があります。
          <Button className="ml-3" variant="secondary" onClick={onManualRefresh}>
            手動で再取得
          </Button>
        </div>
      ) : null}

      <DraftPreview draft={draft} />
    </Card>
  );
}

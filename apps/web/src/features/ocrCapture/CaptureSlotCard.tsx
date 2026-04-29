import type { CaptureSlotState, InputSource } from "@/features/ocrCapture/captureState";
import { CameraCapture } from "@/features/ocrCapture/CameraCapture";
import { ImageInput } from "@/features/ocrCapture/ImageInput";
import { DraftPreview } from "@/features/ocrCapture/DraftPreview";
import type { OcrDraftResponse } from "@/features/ocrCapture/api";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { StatusBadge } from "@/shared/ui/StatusBadge";

type CaptureSlotCardProps = {
  slot: CaptureSlotState;
  label: string;
  accentClass: string;
  draft?: OcrDraftResponse | undefined;
  onSelect: (file: File, source: InputSource) => void;
  onClear: () => void;
  onForceKind: () => void;
  onValidationError: (message: string) => void;
  onManualRefresh: () => void;
};

export function CaptureSlotCard({
  slot,
  label,
  accentClass,
  draft,
  onSelect,
  onClear,
  onForceKind,
  onValidationError,
  onManualRefresh,
}: CaptureSlotCardProps) {
  const mismatch = slot.detectedKind && slot.detectedKind !== slot.kind;

  return (
    <Card className="relative overflow-hidden">
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${accentClass}`} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black tracking-[0.28em] text-ink-300 uppercase">
            Capture Slot
          </p>
          <h2 className="mt-1 text-2xl font-black">{label}</h2>
        </div>
        <StatusBadge status={slot.status} />
      </div>

      {slot.previewUrl ? (
        <img
          src={slot.previewUrl}
          alt={`${label}プレビュー`}
          className="mt-4 aspect-video w-full rounded-2xl border border-white/10 object-cover"
        />
      ) : (
        <div className="mt-4 grid aspect-video place-items-center rounded-2xl border border-dashed border-white/15 bg-white/[0.03] text-sm text-ink-300">
          {label} の画像を投入
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <ImageInput slotLabel={label} onSelect={onSelect} onValidationError={onValidationError} />
        <Button variant="secondary" onClick={onClear} disabled={slot.status === "empty"}>
          削除
        </Button>
        <Button variant={slot.forcedKind ? "primary" : "secondary"} onClick={onForceKind}>
          {slot.forcedKind ? "種別固定中" : "この種別で固定"}
        </Button>
      </div>

      <div className="mt-4">
        <CameraCapture
          slotLabel={label}
          onSelect={onSelect}
          onValidationError={onValidationError}
        />
      </div>

      {mismatch ? (
        <div
          className="mt-4 rounded-2xl border border-rail-gold/30 bg-rail-gold/10 p-3 text-sm text-yellow-50"
          role="alert"
        >
          OCR判定は <strong>{slot.detectedKind}</strong>{" "}
          でした。必要なら正しいスロットへ移動するか、このスロットで種別固定して再実行してください。
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

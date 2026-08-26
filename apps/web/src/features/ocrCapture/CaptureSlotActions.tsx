import { ArrowLeft, ArrowRight, Camera, Check, Trash2 } from "lucide-react";

import { Button } from "@/shared/ui/actions/Button";

type CaptureSlotActionsProps = {
  captureDisabled: boolean;
  captureLabel: string;
  captureSelected: boolean;
  canMoveBackward: boolean;
  canMoveForward: boolean;
  clearDisabled: boolean;
  moveBackwardLabel?: string | undefined;
  moveForwardLabel?: string | undefined;
  onClear: () => void;
  onMoveBackward: () => void;
  onMoveForward: () => void;
  onSelectCapture: () => void;
};

export function CaptureSlotActions({
  captureDisabled,
  captureLabel,
  captureSelected,
  canMoveBackward,
  canMoveForward,
  clearDisabled,
  moveBackwardLabel,
  moveForwardLabel,
  onClear,
  onMoveBackward,
  onMoveForward,
  onSelectCapture,
}: CaptureSlotActionsProps) {
  return (
    <div className="grid gap-2">
      <Button
        aria-pressed={captureSelected}
        className="w-full"
        disabled={captureDisabled}
        icon={
          captureSelected ? (
            <Check aria-hidden="true" className="size-4" />
          ) : (
            <Camera aria-hidden="true" className="size-4" />
          )
        }
        size="sm"
        variant={captureSelected ? "secondary" : "quiet"}
        onClick={onSelectCapture}
      >
        {captureSelected ? "撮影先に選択中" : captureLabel}
      </Button>
      <div className="flex flex-wrap gap-1">
        <Button
          aria-label={moveBackwardLabel ? `${moveBackwardLabel}へ移動` : "前の分類へ移動"}
          disabled={!canMoveBackward}
          icon={<ArrowLeft aria-hidden="true" className="size-4" />}
          size="sm"
          variant="quiet"
          onClick={onMoveBackward}
        >
          {moveBackwardLabel ? `${moveBackwardLabel}へ` : "前へ"}
        </Button>
        <Button
          aria-label={moveForwardLabel ? `${moveForwardLabel}へ移動` : "次の分類へ移動"}
          disabled={!canMoveForward}
          icon={<ArrowRight aria-hidden="true" className="size-4" />}
          size="sm"
          variant="quiet"
          onClick={onMoveForward}
        >
          {moveForwardLabel ? `${moveForwardLabel}へ` : "次へ"}
        </Button>
        <Button
          aria-label="画像を削除"
          disabled={clearDisabled}
          icon={<Trash2 aria-hidden="true" className="size-4" />}
          size="sm"
          variant="quiet"
          onClick={onClear}
        >
          削除
        </Button>
      </div>
    </div>
  );
}

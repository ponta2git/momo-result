import { Button } from "@/shared/ui/actions/Button";

type CaptureSlotActionsProps = {
  canMoveBackward: boolean;
  canMoveForward: boolean;
  clearDisabled: boolean;
  onClear: () => void;
  onMoveBackward: () => void;
  onMoveForward: () => void;
};

export function CaptureSlotActions({
  canMoveBackward,
  canMoveForward,
  clearDisabled,
  onClear,
  onMoveBackward,
  onMoveForward,
}: CaptureSlotActionsProps) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <Button variant="secondary" onClick={onClear} disabled={clearDisabled}>
        削除
      </Button>
      <Button variant="secondary" onClick={onMoveBackward} disabled={!canMoveBackward}>
        前の分類へ
      </Button>
      <Button variant="secondary" onClick={onMoveForward} disabled={!canMoveForward}>
        次の分類へ
      </Button>
    </div>
  );
}

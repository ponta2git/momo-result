import type { SourceImageKind } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { sourceImageKindLabels } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { Dialog } from "@/shared/ui/feedback/Dialog";

type SourceImagePreviewDialogProps = {
  kind: SourceImageKind;
  onClose: () => void;
  url: string;
};

export function SourceImagePreviewDialog({ kind, onClose, url }: SourceImagePreviewDialogProps) {
  return (
    <Dialog
      backdropClassName="bg-[var(--momo-night-900)]/65"
      popupClassName="max-w-none p-0 px-3 py-6"
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      surfaceClassName="max-w-4xl"
      title={`${sourceImageKindLabels[kind]}の拡大表示`}
    >
      <div className="max-h-[75dvh] overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-2">
        <img
          alt={`${sourceImageKindLabels[kind]}の元画像`}
          className="mx-auto h-auto max-w-full object-contain"
          src={url}
        />
      </div>
    </Dialog>
  );
}

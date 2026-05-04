import { useEffect, useEffectEvent } from "react";

import type { SourceImageKind } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { sourceImageKindLabels } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { Button } from "@/shared/ui/actions/Button";

type SourceImagePreviewDialogProps = {
  kind: SourceImageKind;
  onClose: () => void;
  url: string;
};

export function SourceImagePreviewDialog({ kind, onClose, url }: SourceImagePreviewDialogProps) {
  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[var(--z-dialog)] flex items-center justify-center bg-[var(--momo-night-900)]/65 px-3 py-6"
      role="dialog"
    >
      <div className="w-full max-w-4xl rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-lg">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-[var(--color-text-primary)]">
            {sourceImageKindLabels[kind]}の拡大表示
          </h3>
          <Button variant="secondary" onClick={onClose}>
            閉じる
          </Button>
        </div>
        <div className="max-h-[75dvh] overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-2">
          <img
            alt={`${sourceImageKindLabels[kind]}の元画像`}
            className="mx-auto h-auto max-w-full object-contain"
            src={url}
          />
        </div>
      </div>
    </div>
  );
}

import { useEffect } from "react";

import type { SourceImageKind } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { sourceImageKindLabels } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { Button } from "@/shared/ui/Button";

type SourceImagePreviewDialogProps = {
  kind: SourceImageKind;
  onClose: () => void;
  url: string;
};

export function SourceImagePreviewDialog({ kind, onClose, url }: SourceImagePreviewDialogProps) {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onClose]);

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-3 py-6"
      role="dialog"
    >
      <div className="border-line-soft bg-night-900/95 w-full max-w-4xl rounded-2xl border p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-ink-100 text-base font-black">
            {sourceImageKindLabels[kind]}の拡大表示
          </h3>
          <Button variant="secondary" onClick={onClose}>
            閉じる
          </Button>
        </div>
        <div className="border-line-soft bg-capture-black/20 max-h-[75dvh] overflow-auto rounded-xl border p-2">
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

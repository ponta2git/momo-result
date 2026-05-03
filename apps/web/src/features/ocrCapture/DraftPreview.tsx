import type { OcrDraftResponse } from "@/features/ocrCapture/api";

type DraftPreviewProps = {
  draft?: OcrDraftResponse | undefined;
};

export function DraftPreview({ draft }: DraftPreviewProps) {
  if (!draft) {
    return null;
  }

  return (
    <details className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-success)]/45 bg-[var(--color-success)]/10 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-[var(--color-text-primary)]">
        OCRドラフト JSON を表示
      </summary>
      <pre className="mt-3 max-h-56 overflow-auto rounded-[var(--radius-sm)] bg-slate-950 p-3 text-xs text-slate-100">
        {JSON.stringify(
          {
            draftId: draft.draftId,
            detectedImageType: draft.detectedImageType,
            profileId: draft.profileId,
            payloadJson: draft.payloadJson,
            warningsJson: draft.warningsJson,
          },
          null,
          2,
        )}
      </pre>
    </details>
  );
}

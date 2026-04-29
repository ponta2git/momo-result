import type { OcrDraftResponse } from "@/features/ocrCapture/api";

type DraftPreviewProps = {
  draft?: OcrDraftResponse | undefined;
};

export function DraftPreview({ draft }: DraftPreviewProps) {
  if (!draft) {
    return null;
  }

  return (
    <details className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-400/5 p-3">
      <summary className="cursor-pointer text-sm font-bold text-emerald-100">
        OCRドラフト JSON を表示
      </summary>
      <pre className="mt-3 max-h-56 overflow-auto rounded-xl bg-black/40 p-3 text-xs text-emerald-50">
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

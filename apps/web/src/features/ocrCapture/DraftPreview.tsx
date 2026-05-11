import type { OcrDraftResponse } from "@/features/ocrCapture/api";

type DraftPreviewProps = {
  draft?: OcrDraftResponse | undefined;
};

const imageTypeLabels: Record<string, string> = {
  incident_log: "事件簿",
  revenue: "収益",
  total_assets: "総資産",
};

function imageTypeLabel(value: string | undefined): string {
  if (!value) {
    return "判定できませんでした";
  }
  return imageTypeLabels[value] ?? "判定できませんでした";
}

function warningSummary(value: unknown): string {
  if (!value) {
    return "警告はありません。";
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? "警告はありません。" : `${value.length}件の確認事項があります。`;
  }
  if (typeof value === "object") {
    return Object.keys(value).length === 0
      ? "警告はありません。"
      : "確認事項があります。結果確認画面で内容を確認してください。";
  }
  return String(value);
}

export function DraftPreview({ draft }: DraftPreviewProps) {
  if (!draft) {
    return null;
  }

  return (
    <details className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-success)]/45 bg-[var(--color-success)]/10 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-[var(--color-text-primary)]">
        読み取り結果の詳細を表示
      </summary>
      <dl className="mt-3 grid gap-2 text-sm text-[var(--color-text-primary)]">
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--color-text-secondary)]">画像の種類</dt>
          <dd>{imageTypeLabel(draft.detectedImageType)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--color-text-secondary)]">確認事項</dt>
          <dd className="text-right">{warningSummary(draft.warningsJson)}</dd>
        </div>
      </dl>
    </details>
  );
}

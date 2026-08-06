import type { OcrDraftResponse } from "@/shared/api/ocrDrafts";
import { Disclosure } from "@/shared/ui/data/Collapsible";

type DraftPreviewProps = {
  draft?: OcrDraftResponse | undefined;
};

const screenTypeLabels: Record<string, string> = {
  incident_log: "事件簿",
  revenue: "収益",
  total_assets: "総資産",
};

function screenTypeLabel(value: string | undefined): string {
  if (!value) {
    return "判定できませんでした";
  }
  return screenTypeLabels[value] ?? "判定できませんでした";
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
    <Disclosure
      className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-success)]/45 bg-[var(--color-success)]/10"
      panelClassName="border-t border-[var(--color-success)]/30 px-3 py-3"
      summary="読み取り結果の詳細"
    >
      <dl className="grid gap-2 text-sm text-[var(--color-text-primary)]">
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--color-text-secondary)]">読み取り画面</dt>
          <dd>{screenTypeLabel(draft.detectedScreenType)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--color-text-secondary)]">確認事項</dt>
          <dd className="text-right">{warningSummary(draft.warningsJson)}</dd>
        </div>
      </dl>
    </Disclosure>
  );
}

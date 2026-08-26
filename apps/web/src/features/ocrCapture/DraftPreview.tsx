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

function warningSummary(value: unknown): string | null {
  if (!value) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? null : `${value.length}件の確認事項があります。`;
  }
  if (typeof value === "object") {
    return Object.keys(value).length === 0
      ? null
      : "確認事項があります。結果確認画面で内容を確認してください。";
  }
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

export function DraftPreview({ draft }: DraftPreviewProps) {
  if (!draft) {
    return null;
  }
  const warning = warningSummary(draft.warningsJson);

  return (
    <Disclosure
      className="mt-4"
      panelClassName="px-3 py-3"
      presentation="framed"
      summary="読み取り結果"
    >
      <dl className="grid gap-2 text-sm text-[var(--color-text-primary)]">
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--color-text-secondary)]">読み取り画面</dt>
          <dd>{screenTypeLabel(draft.detectedScreenType)}</dd>
        </div>
        {warning ? (
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--color-text-secondary)]">確認事項</dt>
            <dd className="text-right">{warning}</dd>
          </div>
        ) : null}
      </dl>
    </Disclosure>
  );
}

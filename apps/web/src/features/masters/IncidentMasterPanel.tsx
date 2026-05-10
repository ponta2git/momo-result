import type { IncidentMasterResponse } from "@/shared/api/masters";
import { Notice } from "@/shared/ui/feedback/Notice";

const labelClass = "text-xs font-semibold text-[var(--color-text-secondary)]";

type IncidentMasterPanelProps = {
  items: IncidentMasterResponse[];
};

export function IncidentMasterPanel({ items }: IncidentMasterPanelProps) {
  const hasExpectedCount = items.length === 6;

  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <header>
        <p className={labelClass}>事件簿</p>
        <h2 className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">
          事件簿マスタ（読み取り専用）
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          MVPでは6項目固定です。追加・編集はできません。
        </p>
      </header>

      {hasExpectedCount ? null : (
        <Notice className="mt-3" tone="warning" title="事件簿マスタ件数を確認してください">
          現在 {items.length} 件です。期待値は6件です。
        </Notice>
      )}

      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2"
          >
            <span className="line-clamp-2 text-sm font-semibold text-[var(--color-text-primary)]">
              {item.displayName}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

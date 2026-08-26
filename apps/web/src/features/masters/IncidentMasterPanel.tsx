import { MasterResourceRefreshNotice } from "@/features/masters/MasterResourceRefreshNotice";
import type { IncidentMasterResponse } from "@/shared/api/masters";
import { Notice } from "@/shared/ui/feedback/Notice";

type IncidentMasterPanelProps = {
  items: IncidentMasterResponse[];
  onRetry: () => void;
  refreshing: boolean;
  stale: boolean;
};

export function IncidentMasterPanel({
  items,
  onRetry,
  refreshing,
  stale,
}: IncidentMasterPanelProps) {
  const hasExpectedCount = items.length === 6;

  return (
    <section className="min-w-0">
      <header>
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">事件簿</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          現在は6項目固定です。追加・編集はできません。
        </p>
      </header>

      <MasterResourceRefreshNotice
        className="mt-3"
        onRetry={onRetry}
        resourceLabel="事件簿"
        retrying={refreshing}
        stale={stale}
      />

      {hasExpectedCount || stale ? null : (
        <Notice className="mt-3" tone="warning" title="事件簿の項目数を確認してください">
          現在 {items.length} 件です。期待値は6件です。
        </Notice>
      )}

      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-1 py-2"
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

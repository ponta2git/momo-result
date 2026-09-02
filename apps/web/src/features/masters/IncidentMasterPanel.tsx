import { MasterResourceRefreshNotice } from "@/features/masters/MasterResourceRefreshNotice";
import type { IncidentMasterResponse } from "@/shared/api/masters";
import { cn } from "@/shared/ui/cn";
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
        <h2 className="sr-only">事件簿</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          現在は6項目固定です。追加・編集はできません。
        </p>
      </header>

      <div className="mt-3 empty:hidden">
        <MasterResourceRefreshNotice
          onRetry={onRetry}
          resourceLabel="事件簿"
          retrying={refreshing}
          stale={stale}
        />
      </div>

      {hasExpectedCount || stale ? null : (
        <div className="mt-3">
          <Notice tone="warning" title="事件簿の項目数を確認してください">
            現在 {items.length} 件です。期待値は6件です。
          </Notice>
        </div>
      )}

      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, index) => (
          <li
            key={item.id}
            className={cn(
              "flex items-center justify-between gap-2 border-[var(--color-border)] px-1 py-2",
              isInLastGridRow(index, items.length, 1) ? "border-b-0" : "border-b",
              isInLastGridRow(index, items.length, 2) ? "sm:border-b-0" : "sm:border-b",
              isInLastGridRow(index, items.length, 3) ? "lg:border-b-0" : "lg:border-b",
            )}
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

function isInLastGridRow(index: number, itemCount: number, columnCount: number) {
  const lastRowItemCount = itemCount % columnCount || columnCount;
  return index >= itemCount - lastRowItemCount;
}

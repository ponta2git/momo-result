import { MasterResourceRefreshNotice } from "@/features/masters/MasterResourceRefreshNotice";
import type { IncidentMasterResponse } from "@/shared/api/masters";
import { Notice } from "@/shared/ui/feedback/Notice";
import { contentText } from "@/shared/ui/typography";

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
    <section className="grid min-w-0 gap-4">
      <header>
        <h2 className="sr-only">事件簿</h2>
        <p className={contentText.body}>現在は6項目固定です。追加・編集はできません。</p>
      </header>

      <div className="empty:hidden">
        <MasterResourceRefreshNotice
          onRetry={onRetry}
          resourceLabel="事件簿"
          retrying={refreshing}
          stale={stale}
        />
      </div>

      {hasExpectedCount || stale ? null : (
        <div>
          <Notice tone="warning" title="事件簿の項目数を確認してください">
            現在 {items.length} 件です。期待値は6件です。
          </Notice>
        </div>
      )}

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <li key={item.id} className={contentText.body}>
            {item.displayName}
          </li>
        ))}
      </ul>
    </section>
  );
}

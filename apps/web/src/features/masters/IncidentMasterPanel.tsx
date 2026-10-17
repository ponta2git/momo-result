import { MasterResourceRefreshNotice } from "@/features/masters/MasterResourceRefreshNotice";
import { incidentMasterCountIssue } from "@/features/masters/masterViewModel";
import type { IncidentMasterResponse } from "@/shared/api/masters";
import { Notice } from "@/shared/ui/feedback/Notice";
import { contentText } from "@/shared/ui/typography";

type IncidentMasterPanelProps = Readonly<{
  items: ReadonlyArray<Readonly<IncidentMasterResponse>>;
  onRetry: () => void;
  refreshing: boolean;
  stale: boolean;
}>;

export function IncidentMasterPanel({
  items,
  onRetry,
  refreshing,
  stale,
}: IncidentMasterPanelProps) {
  const countIssue = incidentMasterCountIssue(items.length, stale);

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

      {countIssue ? (
        <div>
          <Notice tone="warning" title="事件簿の項目数を確認してください">
            現在 {countIssue.actualCount} 件です。期待値は{countIssue.expectedCount}件です。
          </Notice>
        </div>
      ) : null}

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

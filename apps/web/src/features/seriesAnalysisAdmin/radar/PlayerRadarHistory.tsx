import { History, RefreshCw } from "lucide-react";

import {
  PlayerRadarHistoryDetail,
  playerRadarRevisionActor,
  playerRadarRevisionKind,
} from "@/features/seriesAnalysisAdmin/radar/PlayerRadarHistoryDetail";
import { usePlayerRadarHistoryModel } from "@/features/seriesAnalysisAdmin/radar/usePlayerRadarHistoryModel";
import type { PlayerRadarRevision } from "@/shared/api/seriesPlayerRadarHistory";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { Button } from "@/shared/ui/actions/Button";
import { DataTable } from "@/shared/ui/data/DataTable";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { FilterBar } from "@/shared/ui/forms/FilterBar";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { contentText } from "@/shared/ui/typography";

/** History filters own separate URL parameters, so browsing never changes the editing title. */
export function PlayerRadarHistory({
  titleOptions,
}: {
  titleOptions: ReadonlyArray<{ gameTitleId: string; gameTitleName: string }>;
}) {
  const model = usePlayerRadarHistoryModel();
  const { gameTitleId, cursor, revisionId, data, revision, error } = model;

  return (
    <section aria-label="採点基準の改訂履歴" className="grid min-w-0 gap-4">
      {revisionId ? null : (
        <p className={contentText.supporting}>適用が完了した改訂を、新しい順に表示します。</p>
      )}
      {revisionId ? (
        <div>
          <Button variant="secondary" size="sm" onClick={model.actions.showList}>
            改訂一覧を表示
          </Button>
        </div>
      ) : (
        <FilterBar
          ariaLabel="改訂履歴の表示条件"
          primary={
            <div className="max-w-lg">
              <SelectField
                label="履歴の作品"
                disabled={model.disabled}
                value={gameTitleId ?? ""}
                options={[
                  { value: "", label: "全作品" },
                  ...titleOptions.map((title) => ({
                    value: title.gameTitleId,
                    label: title.gameTitleName,
                  })),
                ]}
                onValueChange={model.actions.selectTitle}
              />
            </div>
          }
          action={
            data ? (
              <Button
                icon={<RefreshCw />}
                variant="secondary"
                size="sm"
                disabled={model.refreshDisabled}
                pending={model.refreshing}
                pendingLabel="履歴を更新中"
                onClick={model.actions.refresh}
              >
                履歴を更新
              </Button>
            ) : undefined
          }
        />
      )}
      {error ? (
        <Notice
          title={error.title}
          tone={error.tone}
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={model.actions.refresh}
              disabled={model.refreshDisabled}
            >
              再読み込み
            </Button>
          }
        >
          {error.detail}
        </Notice>
      ) : null}
      {model.loading ? (
        <div role="status" aria-label="改訂履歴を読み込み中" className="grid gap-3">
          <span className="sr-only">読み込み中</span>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : revisionId ? (
        revision ? (
          <PlayerRadarHistoryDetail key={revisionId} detail={revision} />
        ) : null
      ) : data ? (
        <>
          {data.items.length > 0 ? (
            <DataTable<PlayerRadarRevision>
              caption={{ content: "採点基準の改訂一覧" }}
              rows={data.items}
              getRowKey={(row) => row.revisionId}
              columns={[
                {
                  key: "title",
                  header: "作品",
                  rowHeader: true,
                  minWidth: "9rem",
                  renderCell: (row) => row.gameTitleName,
                },
                {
                  key: "time",
                  header: "適用日時",
                  minWidth: "11rem",
                  tabular: true,
                  renderCell: (row) => formatDateTimeLong(row.appliedAt),
                },
                {
                  key: "kind",
                  header: "変更方法",
                  minWidth: "5rem",
                  renderCell: (row) => playerRadarRevisionKind[row.kind],
                },
                {
                  key: "actor",
                  header: "適用者",
                  minWidth: "8rem",
                  renderCell: (row) => playerRadarRevisionActor(row.appliedBy),
                },
                {
                  key: "detail",
                  header: "詳細",
                  renderCell: (row) => (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`${row.gameTitleName} ${formatDateTimeLong(row.appliedAt)}の改訂詳細`}
                      onClick={() => model.actions.selectRevision(row.revisionId)}
                    >
                      採点境界の変更を確認
                    </Button>
                  ),
                },
              ]}
            />
          ) : (
            <EmptyState
              icon={<History />}
              placement="embedded"
              title="改訂履歴はありません"
              description="採点基準の適用が完了すると、ここに記録されます。"
            />
          )}
          {cursor || data.nextCursor ? (
            <nav aria-label="改訂履歴のページ送り" className="flex flex-wrap gap-2">
              {cursor ? (
                <Button variant="secondary" onClick={() => model.actions.selectCursor(undefined)}>
                  最新の履歴を表示
                </Button>
              ) : null}
              {data.nextCursor ? (
                <Button
                  variant="secondary"
                  onClick={() => model.actions.selectCursor(data.nextCursor ?? undefined)}
                >
                  次の20件
                </Button>
              ) : null}
            </nav>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

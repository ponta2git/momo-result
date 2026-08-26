import { Activity, Play, RotateCw } from "lucide-react";

import {
  AdminSkeleton,
  ExecutionStatus,
  RecentJobs,
  SelectedTitleStatus,
} from "@/features/seriesAnalysisAdmin/SeriesAnalysisAdminStatus";
import { useSeriesAnalysisAdminController } from "@/features/seriesAnalysisAdmin/useSeriesAnalysisAdminController";
import { Button } from "@/shared/ui/actions/Button";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

export function SeriesAnalysisAdminPage() {
  const page = useSeriesAnalysisAdminController();
  const data = page.data;
  const selectedTitleCandidate = data?.selectedTitle;
  const selectedGameTitleId = page.gameTitleId ?? selectedTitleCandidate?.gameTitleId;
  const selectedTitle =
    selectedTitleCandidate && selectedTitleCandidate.gameTitleId === selectedGameTitleId
      ? selectedTitleCandidate
      : null;
  const titleRecalculationReserved = Boolean(selectedTitle?.pendingManualRun);
  const titleOptions =
    data?.titleOptions.map((title) => ({
      label: `${title.gameTitleName} (${title.confirmedMatchCount}戦)`,
      value: title.gameTitleId,
    })) ?? [];
  return (
    <PageFrame width="wide">
      <PageHeader
        eyebrow="管理"
        title="戦績分析"
        description="保存済み分析の状態確認と、作品単位または全作品の再計算を行います。"
      />
      {page.mutationError ? (
        <Notice tone="danger" title={page.mutationError.title}>
          {page.mutationError.detail}
        </Notice>
      ) : null}
      {page.acceptanceMessage ? (
        <Notice tone="success" title={page.acceptanceMessage.title}>
          {page.acceptanceMessage.detail}
        </Notice>
      ) : null}
      {page.error ? (
        <Notice tone={data ? "warning" : "danger"} title={page.error.title}>
          <p>{page.error.detail}</p>
          <div className="mt-3">
            <Button
              pending={page.refreshing}
              pendingLabel="再読み込み中"
              size="sm"
              variant="secondary"
              onClick={page.actions.refresh}
            >
              状態を再読み込み
            </Button>
          </div>
        </Notice>
      ) : null}
      {page.loading && !data ? (
        <AdminSkeleton />
      ) : data?.titleOptions.length === 0 ? (
        <EmptyState
          icon={<Activity className="size-5" />}
          title="再計算できる作品がありません"
          description="設定管理で作品を登録すると、ここから再計算できます。"
        />
      ) : data ? (
        <>
          <section
            aria-label="再計算する対象"
            className="grid gap-3 border-y border-[var(--color-border)] py-4 lg:grid-cols-[minmax(16rem,1fr)_auto_auto] lg:items-end"
          >
            <SelectField
              label="対象作品"
              options={titleOptions}
              value={selectedGameTitleId ?? ""}
              onChange={(event) => page.actions.selectTitle(event.currentTarget.value)}
            />
            <Button
              disabled={!selectedGameTitleId || titleRecalculationReserved}
              icon={<Play className="size-4" />}
              pending={page.pendingTitle}
              pendingLabel="受け付け中"
              onClick={() => void page.actions.recalculateTitle()}
            >
              {titleRecalculationReserved ? "再計算を予約済み" : "この作品を再計算"}
            </Button>
            <AlertDialog
              confirmLabel="全作品を再計算"
              description={`${data.titleOptions.length}作品を対象として予約します。実行中の作品は完了後に再計算されます。`}
              pending={page.pendingAll}
              title="全作品の再計算を予約しますか？"
              tone="primary"
              trigger={
                <Button icon={<RotateCw className="size-4" />} variant="secondary">
                  全作品を再計算
                </Button>
              }
              onConfirm={async () => {
                await page.actions.recalculateAll();
              }}
            />
            {titleRecalculationReserved ? (
              <p className="text-sm text-[var(--color-text-secondary)] lg:col-span-full">
                この作品には未完了の手動再計算予約があります。完了後にもう一度予約できます。
              </p>
            ) : null}
          </section>
          <ExecutionStatus data={data} />
          <SelectedTitleStatus selected={selectedTitle} />
          <RecentJobs jobs={data.recentJobs} />
        </>
      ) : null}
    </PageFrame>
  );
}

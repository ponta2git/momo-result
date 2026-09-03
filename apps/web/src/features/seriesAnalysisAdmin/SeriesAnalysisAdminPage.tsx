import { Activity, Play, RefreshCw, RotateCw } from "lucide-react";

import {
  AdminSkeleton,
  ExecutionStatus,
  RecentJobs,
  SelectedTitleStatus,
} from "@/features/seriesAnalysisAdmin/SeriesAnalysisAdminStatus";
import { useSeriesAnalysisAdminPageModel } from "@/features/seriesAnalysisAdmin/useSeriesAnalysisAdminPageModel";
import { Button } from "@/shared/ui/actions/Button";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

export function SeriesAnalysisAdminPage() {
  const page = useSeriesAnalysisAdminPageModel();
  const { data } = page.resource;
  return (
    <PageFrame width="wide">
      <PageHeader
        actions={
          data && !page.feedback.resourceError ? (
            <Button
              icon={<RefreshCw aria-hidden="true" />}
              pending={page.resource.refreshing}
              pendingLabel="状態を更新中"
              size="sm"
              variant="secondary"
              onClick={page.actions.refresh}
            >
              状態を更新
            </Button>
          ) : null
        }
        eyebrow="管理"
        title="戦績分析"
        description="保存済み分析の状態確認と、作品単位または全作品の再計算を行います。"
      />
      <PageContentSurface className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
        {page.feedback.mutationError ? (
          <Notice tone="danger" title={page.feedback.mutationError.title}>
            {page.feedback.mutationError.detail}
          </Notice>
        ) : null}
        {page.feedback.acceptance ? (
          <Notice tone="success" title={page.feedback.acceptance.title}>
            {page.feedback.acceptance.detail}
          </Notice>
        ) : null}
        {page.feedback.resourceError ? (
          <Notice
            action={
              <Button
                pending={page.resource.refreshing}
                pendingLabel="再読み込み中"
                size="sm"
                variant={data ? "secondary" : "primary"}
                onClick={page.actions.refresh}
              >
                状態を再読み込み
              </Button>
            }
            tone={data ? "warning" : "danger"}
            title={page.feedback.resourceError.title}
          >
            <p>{page.feedback.resourceError.detail}</p>
          </Notice>
        ) : null}
        {page.resource.loading && !data ? (
          <AdminSkeleton />
        ) : data?.titleOptions.length === 0 ? (
          <EmptyState
            icon={<Activity />}
            placement="embedded"
            title="再計算できる作品がありません"
            description="設定管理で作品を登録すると、ここから再計算できます。"
          />
        ) : data ? (
          <>
            <section aria-label="再計算する対象" className="grid min-w-0 gap-1">
              <div className="grid min-w-0 gap-2 lg:grid-cols-[minmax(16rem,32rem)_auto_auto] lg:items-end lg:justify-start">
                <SelectField
                  label="対象作品"
                  options={page.selection.options}
                  value={page.selection.gameTitleId ?? ""}
                  onChange={(event) => page.actions.selectTitle(event.currentTarget.value)}
                />
                <Button
                  disabled={!page.selection.gameTitleId || page.recalculation.titleReserved}
                  icon={<Play />}
                  pending={page.recalculation.titlePending}
                  pendingLabel="受け付け中"
                  onClick={() => void page.actions.recalculateTitle()}
                >
                  {page.recalculation.titleReserved ? "再計算を予約済み" : "この作品を再計算"}
                </Button>
                <AlertDialog
                  confirmLabel="全作品を再計算"
                  description={`${data.titleOptions.length}作品を対象として予約します。実行中の作品は完了後に再計算されます。`}
                  pending={page.recalculation.allPending}
                  title="全作品の再計算を予約しますか？"
                  tone="primary"
                  trigger={
                    <Button icon={<RotateCw />} variant="secondary">
                      全作品を再計算
                    </Button>
                  }
                  onConfirm={async () => {
                    await page.actions.recalculateAll();
                  }}
                />
              </div>
              {page.recalculation.titleReserved ? (
                <p className="text-sm text-[var(--color-text-secondary)]">
                  この作品には処理待ちの手動再計算予約があります。完了後にもう一度予約できます。
                </p>
              ) : null}
            </section>
            <ExecutionStatus data={data} />
            <SelectedTitleStatus selected={page.selection.selectedTitle} />
            <RecentJobs jobs={data.recentJobs} />
          </>
        ) : null}
      </PageContentSurface>
    </PageFrame>
  );
}

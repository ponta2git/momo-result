import { Activity, Play, RefreshCw, RotateCw } from "lucide-react";
import { useState } from "react";

import { PlayerRadarAdministration } from "@/features/seriesAnalysisAdmin/PlayerRadarAdministration";
import {
  AdminSkeleton,
  ExecutionStatus,
  RecentJobs,
  SelectedTitleStatus,
} from "@/features/seriesAnalysisAdmin/SeriesAnalysisAdminStatus";
import { useSeriesAnalysisAdminPageModel } from "@/features/seriesAnalysisAdmin/useSeriesAnalysisAdminPageModel";
import { formatApiError } from "@/shared/api/problemDetails";
import { inlineActionGroupClass } from "@/shared/ui/actions/actionGroup";
import { Button } from "@/shared/ui/actions/Button";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { TabsList, TabsPanel, TabsRoot, TabsTab } from "@/shared/ui/forms/Tabs";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { contentText } from "@/shared/ui/typography";

export function SeriesAnalysisAdminPage() {
  const page = useSeriesAnalysisAdminPageModel();
  const [allDialogOpen, setAllDialogOpen] = useState(false);
  const { data } = page.resource;
  return (
    <PageFrame width="wide">
      <PageContentSurface
        aria-label="戦績分析管理"
        className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6"
        role="region"
      >
        <TabsRoot defaultValue="recalculation">
          <TabsList activateOnFocus={false} aria-label="戦績分析管理の表示切替">
            <TabsTab value="recalculation">分析の再計算</TabsTab>
            <TabsTab value="radar">レーダーの採点基準</TabsTab>
          </TabsList>
          <div className="mt-6 grid min-w-0 gap-6">
            {page.feedback.resourceError ? (
              <Notice
                action={
                  <Button
                    disabled={page.resource.refreshDisabled}
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
                title="対象作品がありません"
                description="設定管理で作品を登録してください。"
              />
            ) : data ? (
              <div className="max-w-lg">
                <SelectField
                  label="対象作品"
                  options={page.selection.options}
                  value={page.selection.gameTitleId ?? ""}
                  onValueChange={(nextValue) => page.actions.selectTitle(nextValue)}
                />
              </div>
            ) : null}
          </div>
          <TabsPanel keepMounted value="recalculation">
            {data && data.titleOptions.length > 0 ? (
              <div className="mt-6 grid min-w-0 gap-6">
                {page.feedback.mutationError && !allDialogOpen ? (
                  <Notice tone="danger" title={page.feedback.mutationError.title}>
                    {page.feedback.mutationError.detail}
                  </Notice>
                ) : null}
                {page.feedback.acceptance ? (
                  <Notice tone="success" title={page.feedback.acceptance.title}>
                    {page.feedback.acceptance.detail}
                  </Notice>
                ) : null}
                <section aria-label="再計算の操作" className="grid min-w-0 gap-1">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <div className={inlineActionGroupClass}>
                      <Button
                        disabled={
                          page.recalculation.titleUnavailable ||
                          page.recalculation.titleReserved ||
                          page.recalculation.pending
                        }
                        icon={<Play />}
                        pending={page.recalculation.titlePending}
                        pendingLabel={page.recalculation.titlePendingLabel}
                        onClick={page.actions.recalculateTitle}
                      >
                        {page.recalculation.titleReserved ? "再計算を予約済み" : "この作品を再計算"}
                      </Button>
                      <AlertDialog
                        open={allDialogOpen}
                        onOpenChange={setAllDialogOpen}
                        confirmLabel="全作品を再計算"
                        description={`${data.titleOptions.length}作品を対象として予約します。実行中の作品は完了後に再計算されます。`}
                        formatError={(error) => formatApiError(error, "再計算を受け付けられません")}
                        pending={page.recalculation.allPending}
                        title="全作品の再計算を予約しますか？"
                        tone="primary"
                        trigger={
                          <Button
                            disabled={page.recalculation.pending}
                            icon={<RotateCw />}
                            variant="secondary"
                          >
                            全作品を再計算
                          </Button>
                        }
                        onConfirm={async () => {
                          await page.actions.recalculateAll();
                        }}
                      />
                    </div>
                    {page.feedback.resourceError ? null : (
                      <Button
                        icon={<RefreshCw aria-hidden="true" />}
                        disabled={page.resource.refreshDisabled}
                        pending={page.resource.refreshing}
                        pendingLabel="状態を更新中"
                        size="sm"
                        variant="secondary"
                        onClick={page.actions.refresh}
                      >
                        状態を更新
                      </Button>
                    )}
                  </div>
                  {page.recalculation.titleReserved ? (
                    <p className={contentText.body}>
                      この作品には処理待ちの手動再計算予約があります。完了後にもう一度予約できます。
                    </p>
                  ) : null}
                </section>
                <ExecutionStatus data={data} />
                <SelectedTitleStatus selected={page.selection.selectedTitle} />
                <RecentJobs jobs={data.recentJobs} />
              </div>
            ) : null}
          </TabsPanel>
          <TabsPanel keepMounted value="radar">
            {page.selection.selectedTitle ? (
              <div className="mt-6 min-w-0">
                <PlayerRadarAdministration
                  key={page.selection.selectedTitle.gameTitleId}
                  gameTitleId={page.selection.selectedTitle.gameTitleId}
                  gameTitleName={page.selection.selectedTitle.gameTitleName}
                />
              </div>
            ) : null}
          </TabsPanel>
        </TabsRoot>
      </PageContentSurface>
    </PageFrame>
  );
}

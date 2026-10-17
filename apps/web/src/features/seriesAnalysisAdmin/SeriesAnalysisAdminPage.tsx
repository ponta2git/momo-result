import { Activity, Play, RefreshCw, RotateCw } from "lucide-react";

import { PlayerRadarAdministration } from "@/features/seriesAnalysisAdmin/radar/PlayerRadarAdministration";
import { PlayerRadarHistory } from "@/features/seriesAnalysisAdmin/radar/PlayerRadarHistory";
import {
  AdminSkeleton,
  ExecutionStatus,
  RecentJobs,
  SelectedTitleStatus,
} from "@/features/seriesAnalysisAdmin/SeriesAnalysisAdminStatus";
import { useSeriesAnalysisAdmin } from "@/features/seriesAnalysisAdmin/useSeriesAnalysisAdmin";
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
  const administration = useSeriesAnalysisAdmin();
  const { activeTab, radarView, allDialogOpen, setActiveTab, setRadarView, recalculationTabRef } =
    administration.navigation;
  const { data } = administration.resource;
  const { selectedTitle } = administration.selection;
  return (
    <PageFrame width="wide">
      <PageContentSurface
        aria-label="戦績分析管理"
        className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6"
        role="region"
      >
        <TabsRoot value={activeTab} onValueChange={(value) => setActiveTab(String(value))}>
          <TabsList activateOnFocus={false} aria-label="戦績分析管理の表示切替">
            <TabsTab value="recalculation" ref={recalculationTabRef}>
              分析の再計算
            </TabsTab>
            <TabsTab value="radar">レーダーの採点基準</TabsTab>
          </TabsList>
          <div className="mt-6 grid min-w-0 gap-6">
            {administration.feedback.resourceError ? (
              <Notice
                action={
                  <Button
                    disabled={administration.resource.refreshDisabled}
                    pending={administration.resource.refreshing}
                    pendingLabel="再読み込み中"
                    size="sm"
                    variant={data ? "secondary" : "primary"}
                    onClick={administration.actions.refresh}
                  >
                    状態を再読み込み
                  </Button>
                }
                tone={data ? "warning" : "danger"}
                title={administration.feedback.resourceError.title}
              >
                <p>{administration.feedback.resourceError.detail}</p>
              </Notice>
            ) : null}
            {administration.resource.loading && !data ? (
              <AdminSkeleton />
            ) : data?.titleOptions.length === 0 ? (
              <EmptyState
                icon={<Activity />}
                placement="embedded"
                title="対象作品がありません"
                description={
                  administration.authorization.retainAdmin
                    ? "設定管理で作品を登録してください。"
                    : "管理者による作品の登録が必要です。"
                }
              />
            ) : data && !(activeTab === "radar" && radarView === "history") ? (
              <div className="max-w-lg">
                <SelectField
                  label="対象作品"
                  disabled={!administration.authorization.canOperate}
                  options={administration.selection.options}
                  value={administration.selection.gameTitleId ?? ""}
                  onValueChange={(nextValue) => administration.actions.selectTitle(nextValue)}
                />
              </div>
            ) : null}
          </div>
          <TabsPanel keepMounted value="recalculation">
            {data && data.titleOptions.length > 0 ? (
              <div className="mt-6 grid min-w-0 gap-6">
                {administration.feedback.mutationError && !allDialogOpen ? (
                  <Notice tone="danger" title={administration.feedback.mutationError.title}>
                    {administration.feedback.mutationError.detail}
                  </Notice>
                ) : null}
                {administration.feedback.acceptance ? (
                  <Notice tone="success" title={administration.feedback.acceptance.title}>
                    {administration.feedback.acceptance.detail}
                  </Notice>
                ) : null}
                <section aria-label="再計算の操作" className="grid min-w-0 gap-1">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <div className={inlineActionGroupClass}>
                      <Button
                        disabled={
                          !administration.authorization.canOperate ||
                          administration.recalculation.titleUnavailable ||
                          administration.recalculation.titleReserved ||
                          administration.recalculation.pending
                        }
                        icon={<Play />}
                        pending={administration.recalculation.titlePending}
                        pendingLabel={administration.recalculation.titlePendingLabel}
                        onClick={administration.actions.recalculateTitle}
                      >
                        {administration.recalculation.titleReserved
                          ? "再計算を予約済み"
                          : "この作品を再計算"}
                      </Button>
                      {administration.authorization.retainAdmin ? (
                        <AlertDialog
                          open={allDialogOpen}
                          onOpenChange={administration.navigation.setAllDialogOpen}
                          confirmDisabled={!administration.authorization.canRecalculateAll}
                          confirmLabel="全作品を再計算"
                          description={`${data.titleOptions.length}作品を対象として予約します。実行中の作品は完了後に再計算されます。`}
                          formatError={(error) =>
                            formatApiError(error, "再計算を受け付けられません")
                          }
                          pending={administration.recalculation.allPending}
                          title="全作品の再計算を予約しますか？"
                          tone="primary"
                          trigger={
                            <Button
                              disabled={
                                !administration.authorization.canRecalculateAll ||
                                administration.recalculation.pending
                              }
                              icon={<RotateCw />}
                              variant="secondary"
                            >
                              全作品を再計算
                            </Button>
                          }
                          onConfirm={async () => {
                            await administration.actions.recalculateAll();
                          }}
                        />
                      ) : null}
                    </div>
                    {administration.feedback.resourceError ? null : (
                      <Button
                        icon={<RefreshCw aria-hidden="true" />}
                        disabled={administration.resource.refreshDisabled}
                        pending={administration.resource.refreshing}
                        pendingLabel="状態を更新中"
                        size="sm"
                        variant="secondary"
                        onClick={administration.actions.refresh}
                      >
                        状態を更新
                      </Button>
                    )}
                  </div>
                  {administration.recalculation.titleReserved ? (
                    <p className={contentText.body}>
                      この作品には処理待ちの手動再計算予約があります。完了後にもう一度予約できます。
                    </p>
                  ) : null}
                </section>
                <ExecutionStatus data={data} />
                <SelectedTitleStatus selected={selectedTitle} />
                <RecentJobs jobs={data.recentJobs} />
              </div>
            ) : null}
          </TabsPanel>
          <TabsPanel keepMounted value="radar">
            <div className="mt-6 grid min-w-0 gap-4">
              <TabsRoot value={radarView} onValueChange={(value) => setRadarView(String(value))}>
                <TabsList aria-label="採点基準の表示切替" variant="underline">
                  <TabsTab value="current">現在の採点境界</TabsTab>
                  {administration.authorization.retainOperations ? (
                    <TabsTab value="history">改訂履歴</TabsTab>
                  ) : null}
                </TabsList>
                <TabsPanel keepMounted value="current">
                  {selectedTitle ? (
                    <div className="mt-6 min-w-0">
                      <PlayerRadarAdministration
                        key={selectedTitle.gameTitleId}
                        gameTitleId={selectedTitle.gameTitleId}
                        gameTitleName={selectedTitle.gameTitleName}
                        active={administration.navigation.radarVisible}
                        onApplyAccepted={administration.navigation.onApplyAccepted}
                        applyFinalFocus={administration.navigation.applyFinalFocus}
                      />
                    </div>
                  ) : null}
                </TabsPanel>
                {administration.authorization.retainOperations ? (
                  <TabsPanel value="history">
                    {activeTab === "radar" && radarView === "history" ? (
                      <div className="mt-6 min-w-0">
                        <PlayerRadarHistory titleOptions={data?.titleOptions ?? []} />
                      </div>
                    ) : null}
                  </TabsPanel>
                ) : null}
              </TabsRoot>
            </div>
          </TabsPanel>
        </TabsRoot>
      </PageContentSurface>
    </PageFrame>
  );
}

import { Activity, Play, RefreshCw, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { PlayerRadarAdministration } from "@/features/seriesAnalysisAdmin/PlayerRadarAdministration";
import { PlayerRadarHistory } from "@/features/seriesAnalysisAdmin/PlayerRadarHistory";
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
import { showToast } from "@/shared/ui/feedback/Toast";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { TabsList, TabsPanel, TabsRoot, TabsTab } from "@/shared/ui/forms/Tabs";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { contentText } from "@/shared/ui/typography";

export function SeriesAnalysisAdminPage() {
  const page = useSeriesAnalysisAdminPageModel();
  const [allDialog, setAllDialog] = useState({ epoch: page.authorization.adminEpoch, open: false });
  const allDialogOpen =
    page.authorization.retainAdmin &&
    allDialog.epoch === page.authorization.adminEpoch &&
    allDialog.open;
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab =
    requestedTab === "radar" || requestedTab === "history" ? "radar" : "recalculation";
  const radarView =
    requestedTab === "history" || searchParams.get("radarView") === "history"
      ? "history"
      : "current";
  const setActiveTab = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", value);
    setSearchParams(next);
  };
  const setRadarView = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", "radar");
    if (value === "history") next.set("radarView", "history");
    else next.delete("radarView");
    setSearchParams(next);
  };
  const radarVisible = activeTab === "radar" && radarView === "current";
  const previouslyVisible = useRef(radarVisible);
  useEffect(() => {
    if (radarVisible && !previouslyVisible.current) page.actions.refreshRadar();
    previouslyVisible.current = radarVisible;
  }, [radarVisible, page.actions]);
  const recalculationTabRef = useRef<HTMLElement>(null);
  const applyFocusRef = useRef<HTMLElement | null>(null);
  const { data } = page.resource;
  const { selectedTitle } = page.selection;
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
                description={
                  page.authorization.retainAdmin
                    ? "設定管理で作品を登録してください。"
                    : "管理者による作品の登録が必要です。"
                }
              />
            ) : data && !(activeTab === "radar" && radarView === "history") ? (
              <div className="max-w-lg">
                <SelectField
                  label="対象作品"
                  disabled={!page.authorization.canOperate}
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
                          !page.authorization.canOperate ||
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
                      {page.authorization.retainAdmin ? (
                        <AlertDialog
                          open={allDialogOpen}
                          onOpenChange={(open) =>
                            setAllDialog({ epoch: page.authorization.adminEpoch, open })
                          }
                          confirmDisabled={!page.authorization.canRecalculateAll}
                          confirmLabel="全作品を再計算"
                          description={`${data.titleOptions.length}作品を対象として予約します。実行中の作品は完了後に再計算されます。`}
                          formatError={(error) =>
                            formatApiError(error, "再計算を受け付けられません")
                          }
                          pending={page.recalculation.allPending}
                          title="全作品の再計算を予約しますか？"
                          tone="primary"
                          trigger={
                            <Button
                              disabled={
                                !page.authorization.canRecalculateAll || page.recalculation.pending
                              }
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
                      ) : null}
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
                  {page.authorization.retainOperations ? (
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
                        active={activeTab === "radar" && radarView === "current"}
                        onApplyAccepted={(operationId) => {
                          applyFocusRef.current = recalculationTabRef.current;
                          page.actions.clearRecalculationFeedback();
                          setActiveTab("recalculation");
                          recalculationTabRef.current?.focus();
                          showToast({
                            id: `radar-apply-accepted:${operationId}`,
                            title: "採点基準の適用を受け付けました",
                            description: `${selectedTitle.gameTitleName}の再計算状況を表示しています。`,
                          });
                        }}
                        applyFinalFocus={() => {
                          const destination = applyFocusRef.current;
                          applyFocusRef.current = null;
                          return destination;
                        }}
                      />
                    </div>
                  ) : null}
                </TabsPanel>
                {page.authorization.retainOperations ? (
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

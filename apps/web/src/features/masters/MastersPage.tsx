import { IncidentMasterPanel } from "@/features/masters/IncidentMasterPanel";
import { MasterRelationBoard } from "@/features/masters/MasterRelationBoard";
import { MasterReturnNotice } from "@/features/masters/MasterReturnNotice";
import { defaultLayoutFamily } from "@/features/masters/masterValidation";
import { MemberAliasPanel } from "@/features/masters/MemberAliasPanel";
import { masterTabs, useMastersPageController } from "@/features/masters/useMastersPageController";
import { Notice } from "@/shared/ui/feedback/Notice";
import { TabsList, TabsPanel, TabsRoot, TabsTab } from "@/shared/ui/forms/Tabs";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

export function MastersPage() {
  const controller = useMastersPageController();
  const {
    activeTab,
    aliasCreateAction,
    aliasCreateState,
    auth,
    deleteGameTitle,
    deleteMapMaster,
    deleteMemberAlias,
    deleteSeasonMaster,
    gameTitleCreateAction,
    gameTitleCreateState,
    gameTitlesRefreshing,
    gameTitlesStale,
    hasInvalidReturnTo,
    hasPendingMutation,
    handoffStatus,
    incidentMasters,
    incidentMastersRefreshing,
    incidentMastersStale,
    isReturnNavigationPending,
    mapCreateAction,
    mapCreateState,
    mapMastersHasData,
    mapMastersLoadFailed,
    mapMastersLoading,
    mapMastersLoadError,
    mapMastersRefreshing,
    mapMastersStale,
    memberAliases,
    memberAliasesRefreshing,
    memberAliasesStale,
    navigateWithTransition,
    operationError,
    optimisticGameTitles,
    retryGameTitles,
    retryIncidentMasters,
    retryMapMasters,
    retryMemberAliases,
    retrySeasonMasters,
    returnDestination,
    seasonCreateAction,
    seasonCreateState,
    seasonMastersHasData,
    seasonMastersLoadFailed,
    seasonMastersLoading,
    seasonMastersLoadError,
    seasonMastersRefreshing,
    seasonMastersStale,
    setActiveTab,
    setSelectedGameTitleId,
    updateGameTitle,
    updateMapMaster,
    updateMemberAlias,
    updateSeasonMaster,
    viewModel,
  } = controller;
  const gameTitleRelation = {
    create: {
      action: gameTitleCreateAction,
      error: gameTitleCreateState.error,
      formKey: gameTitleCreateState.version,
    },
    defaultLayoutFamily,
    items: optimisticGameTitles,
    onDelete: deleteGameTitle,
    onRetry: retryGameTitles,
    onSelect: setSelectedGameTitleId,
    onUpdate: updateGameTitle,
    selectedId: viewModel.selectedGameTitleId,
    refreshing: gameTitlesRefreshing,
    stale: gameTitlesStale,
  };
  const mapRelation = {
    create: {
      action: mapCreateAction,
      error: mapCreateState.error,
      formKey: mapCreateState.version,
    },
    error: mapMastersLoadError,
    hasData: mapMastersHasData,
    items: viewModel.selectedMapMasters,
    loadFailed: mapMastersLoadFailed,
    loading: mapMastersLoading,
    onDelete: deleteMapMaster,
    onRetry: retryMapMasters,
    onUpdate: updateMapMaster,
    retrying: mapMastersRefreshing,
    stale: mapMastersStale,
  };
  const seasonRelation = {
    create: {
      action: seasonCreateAction,
      error: seasonCreateState.error,
      formKey: seasonCreateState.version,
    },
    error: seasonMastersLoadError,
    hasData: seasonMastersHasData,
    items: viewModel.selectedSeasonMasters,
    loadFailed: seasonMastersLoadFailed,
    loading: seasonMastersLoading,
    onDelete: deleteSeasonMaster,
    onRetry: retrySeasonMasters,
    onUpdate: updateSeasonMaster,
    retrying: seasonMastersRefreshing,
    stale: seasonMastersStale,
  };

  return (
    <PageFrame>
      <PageHeader
        eyebrow="管理"
        title="設定管理"
        description="作品、読み取り方式、マップ、シーズン、名前の読み替えを整えます。"
      />

      {auth.error ? (
        <Notice tone="danger" title={auth.error.title}>
          {auth.error.detail}
        </Notice>
      ) : null}

      {returnDestination ? (
        <MasterReturnNotice
          handoffStatus={handoffStatus}
          disabled={hasPendingMutation || isReturnNavigationPending}
          disabledReason={
            isReturnNavigationPending
              ? "元の入力画面へ移動しています。"
              : hasPendingMutation
                ? "設定の追加・保存・削除が完了すると戻れます。"
                : undefined
          }
          pending={isReturnNavigationPending}
          onReturn={() => navigateWithTransition(returnDestination)}
        />
      ) : null}

      <PageContentSurface aria-label="設定管理" role="region">
        {operationError || hasInvalidReturnTo ? (
          <div className="mb-6 grid gap-3">
            {operationError ? (
              <Notice tone="danger" title="設定の変更に失敗しました">
                {operationError}
              </Notice>
            ) : null}
            {hasInvalidReturnTo ? (
              <Notice tone="warning" title="戻り先を確認できませんでした">
                戻り先を確認できないため、試合一覧へ戻る導線だけを表示しています。
              </Notice>
            ) : null}
          </div>
        ) : null}

        <TabsRoot
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as typeof activeTab)}
        >
          <TabsList activateOnFocus aria-label="設定管理の表示切替">
            {masterTabs.map((tab) => (
              <TabsTab key={tab.id} value={tab.id}>
                {tab.label}
              </TabsTab>
            ))}
          </TabsList>

          <TabsPanel className="mt-6" keepMounted value="catalog">
            <MasterRelationBoard
              gameTitle={gameTitleRelation}
              map={mapRelation}
              selectedGameTitleName={viewModel.selectedGameTitle?.name}
              scopedDisabledReason={viewModel.scopedDisabledReason}
              season={seasonRelation}
            />
          </TabsPanel>

          <TabsPanel className="mt-6" keepMounted value="aliases">
            <MemberAliasPanel
              aliases={memberAliases}
              createAction={aliasCreateAction}
              createError={aliasCreateState.error}
              createFormKey={aliasCreateState.version}
              onDelete={deleteMemberAlias}
              onRetry={retryMemberAliases}
              onUpdate={updateMemberAlias}
              refreshing={memberAliasesRefreshing}
              stale={memberAliasesStale}
            />
          </TabsPanel>

          <TabsPanel className="mt-6" keepMounted value="incidents">
            <IncidentMasterPanel
              items={incidentMasters}
              onRetry={retryIncidentMasters}
              refreshing={incidentMastersRefreshing}
              stale={incidentMastersStale}
            />
          </TabsPanel>
        </TabsRoot>
      </PageContentSurface>
    </PageFrame>
  );
}

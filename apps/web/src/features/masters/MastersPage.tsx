import { IncidentMasterPanel } from "@/features/masters/IncidentMasterPanel";
import { MasterRelationBoard } from "@/features/masters/MasterRelationBoard";
import { MasterReturnNotice } from "@/features/masters/MasterReturnNotice";
import { defaultLayoutFamily } from "@/features/masters/masterValidation";
import { MemberAliasPanel } from "@/features/masters/MemberAliasPanel";
import { masterTabs, useMastersPageController } from "@/features/masters/useMastersPageController";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Notice } from "@/shared/ui/feedback/Notice";
import { TabsList, TabsPanel, TabsRoot, TabsTab } from "@/shared/ui/forms/Tabs";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

const sectionClass = "grid gap-4";

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
    hasInvalidReturnTo,
    hasPendingMutation,
    handoffStatus,
    incidentMasters,
    isReturnNavigationPending,
    mapCreateAction,
    mapCreateState,
    mapMastersLoading,
    mapMastersLoadError,
    mapMastersRefreshing,
    memberAliases,
    navigateWithTransition,
    operationError,
    optimisticGameTitles,
    retryMapMasters,
    retrySeasonMasters,
    returnDestination,
    seasonCreateAction,
    seasonCreateState,
    seasonMastersLoading,
    seasonMastersLoadError,
    seasonMastersRefreshing,
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
    onSelect: setSelectedGameTitleId,
    onUpdate: updateGameTitle,
    selectedId: viewModel.selectedGameTitleId,
  };
  const mapRelation = {
    create: {
      action: mapCreateAction,
      error: mapCreateState.error,
      formKey: mapCreateState.version,
    },
    error: mapMastersLoadError,
    items: viewModel.selectedMapMasters,
    loading: mapMastersLoading,
    onDelete: deleteMapMaster,
    onRetry: retryMapMasters,
    onUpdate: updateMapMaster,
    retrying: mapMastersRefreshing,
  };
  const seasonRelation = {
    create: {
      action: seasonCreateAction,
      error: seasonCreateState.error,
      formKey: seasonCreateState.version,
    },
    error: seasonMastersLoadError,
    items: viewModel.selectedSeasonMasters,
    loading: seasonMastersLoading,
    onDelete: deleteSeasonMaster,
    onRetry: retrySeasonMasters,
    onUpdate: updateSeasonMaster,
    retrying: seasonMastersRefreshing,
  };

  return (
    <PageFrame className={sectionClass}>
      <PageHeader
        eyebrow="管理"
        title="設定管理"
        description="作品、読み取り方式、マップ、シーズン、名前の読み替えを整えます。"
        actions={
          returnDestination ? (
            <Button
              pending={isReturnNavigationPending}
              pendingLabel="移動中…"
              variant="secondary"
              onClick={() => navigateWithTransition(returnDestination ?? "/matches")}
            >
              戻る
            </Button>
          ) : null
        }
      />

      {auth.error ? (
        <Notice tone="danger" title={auth.error.title}>
          {auth.error.detail}
        </Notice>
      ) : null}

      {operationError ? (
        <Notice tone="danger" title="設定の変更に失敗しました">
          {operationError}
        </Notice>
      ) : null}

      {returnDestination ? (
        <MasterReturnNotice
          destination={returnDestination}
          handoffStatus={handoffStatus}
          disabled={hasPendingMutation || isReturnNavigationPending}
          pending={isReturnNavigationPending}
          onReturn={() => navigateWithTransition(returnDestination)}
        />
      ) : null}

      <TabsRoot
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as typeof activeTab)}
      >
        <TabsList
          activateOnFocus
          aria-label="設定管理の表示切替"
          className="flex flex-wrap gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2"
        >
          {masterTabs.map((tab) => (
            <TabsTab
              key={tab.id}
              className={cn(
                "min-h-9 rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-semibold transition-colors duration-150",
                activeTab === tab.id
                  ? "bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)]",
              )}
              value={tab.id}
            >
              {tab.label}
            </TabsTab>
          ))}
        </TabsList>

        <TabsPanel className="mt-4" keepMounted value="catalog">
          <MasterRelationBoard
            gameTitle={gameTitleRelation}
            map={mapRelation}
            selectedGameTitleName={viewModel.selectedGameTitle?.name}
            scopedDisabledReason={viewModel.scopedDisabledReason}
            season={seasonRelation}
          />
        </TabsPanel>

        <TabsPanel className="mt-4" keepMounted value="aliases">
          <MemberAliasPanel
            aliases={memberAliases}
            createAction={aliasCreateAction}
            createError={aliasCreateState.error}
            createFormKey={aliasCreateState.version}
            onDelete={deleteMemberAlias}
            onUpdate={updateMemberAlias}
          />
        </TabsPanel>

        <TabsPanel className="mt-4" keepMounted value="incidents">
          <IncidentMasterPanel items={incidentMasters} />
        </TabsPanel>
      </TabsRoot>

      {hasInvalidReturnTo ? (
        <Notice tone="warning" title="戻り先を確認できませんでした">
          戻り先を確認できないため、試合一覧へ戻る導線だけを表示しています。
        </Notice>
      ) : null}

      {viewModel.shouldPromptGameTitleCreation ? (
        <Notice tone="info" title="作品が必要です">
          マップとシーズンは、作品を選ぶと追加できます。
        </Notice>
      ) : null}
    </PageFrame>
  );
}

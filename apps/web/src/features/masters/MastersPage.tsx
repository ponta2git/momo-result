import { Activity } from "react";

import { IncidentMasterPanel } from "@/features/masters/IncidentMasterPanel";
import { MasterRelationBoard } from "@/features/masters/MasterRelationBoard";
import { MasterReturnNotice } from "@/features/masters/MasterReturnNotice";
import { normalizeLayoutFamily } from "@/features/masters/masterValidation";
import { MemberAliasPanel } from "@/features/masters/MemberAliasPanel";
import { masterTabs, useMastersPageController } from "@/features/masters/useMastersPageController";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Notice } from "@/shared/ui/feedback/Notice";
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
    mapCreateAction,
    mapCreateState,
    mapMastersLoadError,
    memberAliases,
    navigateWithTransition,
    operationError,
    optimisticGameTitles,
    returnDestination,
    seasonCreateAction,
    seasonCreateState,
    seasonMastersLoadError,
    setActiveTab,
    setSelectedGameTitleId,
    updateGameTitle,
    updateMapMaster,
    updateMemberAlias,
    updateSeasonMaster,
    viewModel,
  } = controller;

  return (
    <PageFrame className={sectionClass}>
      <PageHeader
        eyebrow="管理"
        title="設定管理"
        description="作品、読み取り方式、マップ、シーズン、名前の読み替えを管理します。"
        actions={
          returnDestination ? (
            <Button
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
          disabled={hasPendingMutation}
          onReturn={() => navigateWithTransition(returnDestination)}
        />
      ) : null}

      {auth.isAuthenticated && mapMastersLoadError ? (
        <Notice tone="danger" title="マップを読み込めませんでした">
          {mapMastersLoadError}
        </Notice>
      ) : null}
      {auth.isAuthenticated && seasonMastersLoadError ? (
        <Notice tone="danger" title="シーズンを読み込めませんでした">
          {seasonMastersLoadError}
        </Notice>
      ) : null}

      <section
        aria-label="設定管理の表示切替"
        className="flex flex-wrap gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2"
      >
        {masterTabs.map((tab) => (
          <button
            key={tab.id}
            className={cn(
              "min-h-9 rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-semibold transition-colors duration-150",
              activeTab === tab.id
                ? "bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]"
                : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)]",
            )}
            type="button"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </section>

      <Activity mode={activeTab === "catalog" ? "visible" : "hidden"} name="master-catalog">
        <MasterRelationBoard
          gameTitles={optimisticGameTitles}
          selectedGameTitleId={viewModel.selectedGameTitleId}
          selectedGameTitleName={viewModel.selectedGameTitle?.name}
          onSelectGameTitle={setSelectedGameTitleId}
          onUpdateGameTitle={updateGameTitle}
          onDeleteGameTitle={deleteGameTitle}
          gameTitleCreateAction={gameTitleCreateAction}
          gameTitleCreateError={gameTitleCreateState.error}
          gameTitleCreateFormKey={gameTitleCreateState.version}
          gameTitleDefaultLayoutFamily={normalizeLayoutFamily("")}
          mapMasters={viewModel.selectedMapMasters}
          onUpdateMapMaster={updateMapMaster}
          onDeleteMapMaster={deleteMapMaster}
          mapCreateAction={mapCreateAction}
          mapCreateError={mapCreateState.error}
          mapCreateFormKey={mapCreateState.version}
          seasonMasters={viewModel.selectedSeasonMasters}
          onUpdateSeasonMaster={updateSeasonMaster}
          onDeleteSeasonMaster={deleteSeasonMaster}
          seasonCreateAction={seasonCreateAction}
          seasonCreateError={seasonCreateState.error}
          seasonCreateFormKey={seasonCreateState.version}
          scopedDisabledReason={viewModel.scopedDisabledReason}
        />
      </Activity>

      <Activity mode={activeTab === "aliases" ? "visible" : "hidden"} name="member-aliases">
        <MemberAliasPanel
          aliases={memberAliases}
          createAction={aliasCreateAction}
          createError={aliasCreateState.error}
          createFormKey={aliasCreateState.version}
          onDelete={deleteMemberAlias}
          onUpdate={updateMemberAlias}
        />
      </Activity>

      <Activity mode={activeTab === "incidents" ? "visible" : "hidden"} name="incident-masters">
        <IncidentMasterPanel items={incidentMasters} />
      </Activity>

      {hasInvalidReturnTo ? (
        <Notice tone="warning" title="戻り先を確認できませんでした">
          戻り先を確認できないため、試合一覧へ戻る導線だけを表示しています。
        </Notice>
      ) : null}

      {viewModel.shouldPromptGameTitleCreation ? (
        <Notice tone="info" title="最初に作品を追加してください">
          マップとシーズンは作品を選んでから追加できます。
        </Notice>
      ) : null}
    </PageFrame>
  );
}

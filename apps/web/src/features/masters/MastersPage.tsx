import { IncidentMasterPanel } from "@/features/masters/IncidentMasterPanel";
import { MasterRelationBoard } from "@/features/masters/MasterRelationBoard";
import { MasterReturnNotice } from "@/features/masters/MasterReturnNotice";
import { MemberAliasPanel } from "@/features/masters/MemberAliasPanel";
import { useMastersPageModel } from "@/features/masters/useMastersPageModel";
import { Notice } from "@/shared/ui/feedback/Notice";
import { TabsList, TabsPanel, TabsRoot, TabsTab } from "@/shared/ui/forms/Tabs";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

export function MastersPage() {
  const page = useMastersPageModel();

  return (
    <PageFrame>
      <PageHeader eyebrow="管理" title="設定管理" />

      {page.feedback.authError ? (
        <Notice tone="danger" title={page.feedback.authError.title}>
          {page.feedback.authError.detail}
        </Notice>
      ) : null}

      {page.navigation.destination ? (
        <MasterReturnNotice
          handoffStatus={page.navigation.handoffStatus}
          disabled={page.navigation.disabled}
          disabledReason={page.navigation.disabledReason}
          pending={page.navigation.pending}
          onReturn={page.navigation.onReturn}
        />
      ) : null}

      <PageContentSurface aria-label="設定管理" role="region">
        {page.feedback.operationError || page.feedback.invalidReturnTo ? (
          <div className="mb-6 grid gap-3">
            {page.feedback.operationError ? (
              <Notice tone="danger" title="設定の変更に失敗しました">
                {page.feedback.operationError}
              </Notice>
            ) : null}
            {page.feedback.invalidReturnTo ? (
              <Notice tone="warning" title="戻り先を確認できませんでした">
                戻り先を確認できないため、試合一覧へ戻る導線だけを表示しています。
              </Notice>
            ) : null}
          </div>
        ) : null}

        <TabsRoot
          value={page.tabs.active}
          onValueChange={(value) => page.tabs.onChange(value as typeof page.tabs.active)}
        >
          <TabsList activateOnFocus aria-label="設定管理の表示切替">
            {page.tabs.items.map((tab) => (
              <TabsTab key={tab.id} value={tab.id}>
                {tab.label}
              </TabsTab>
            ))}
          </TabsList>

          <TabsPanel className="mt-6" keepMounted value="catalog">
            <MasterRelationBoard
              gameTitle={page.catalog.gameTitle}
              map={page.catalog.map}
              scopedDisabledReason={page.catalog.scopedDisabledReason}
              season={page.catalog.season}
            />
          </TabsPanel>

          <TabsPanel className="mt-6" keepMounted value="aliases">
            <MemberAliasPanel
              aliases={page.aliases.items}
              createAction={page.aliases.createAction}
              createError={page.aliases.createError}
              createFormKey={page.aliases.createFormKey}
              onDelete={page.aliases.onDelete}
              onRetry={page.aliases.onRetry}
              onUpdate={page.aliases.onUpdate}
              refreshing={page.aliases.refreshing}
              stale={page.aliases.stale}
            />
          </TabsPanel>

          <TabsPanel className="mt-6" keepMounted value="incidents">
            <IncidentMasterPanel
              items={page.incidents.items}
              onRetry={page.incidents.onRetry}
              refreshing={page.incidents.refreshing}
              stale={page.incidents.stale}
            />
          </TabsPanel>
        </TabsRoot>
      </PageContentSurface>
    </PageFrame>
  );
}

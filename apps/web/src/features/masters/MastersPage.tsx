import { AccountSettingsPanel } from "@/features/masters/accounts/AccountSettingsPanel";
import { IncidentMasterPanel } from "@/features/masters/IncidentMasterPanel";
import type { MasterTabId } from "@/features/masters/masterNavigationModel";
import { MasterPanelContent } from "@/features/masters/MasterPanelContent";
import { MasterRelationBoard } from "@/features/masters/MasterRelationBoard";
import { MemberAliasPanel } from "@/features/masters/MemberAliasPanel";
import { NotificationSettingsPanel } from "@/features/masters/notifications/NotificationSettingsPanel";
import { useMastersPageModel } from "@/features/masters/useMastersPageModel";
import { UnsavedChangesGuard } from "@/shared/navigation/UnsavedChangesGuard";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";
import { TabsList, TabsPanel, TabsRoot, TabsTab } from "@/shared/ui/forms/Tabs";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";

export function MastersPage() {
  const page = useMastersPageModel();

  return (
    <PageFrame>
      <UnsavedChangesGuard
        {...page.guard}
        showPendingDialog={false}
        description="変更した通知設定はまだ保存されていません。このページに残れば、設定タブを切り替えても編集を続けられます。"
        pendingDescription="設定の追加・保存・削除の結果を確認しています。このページでお待ちください。"
      />
      {page.feedback.authError ? (
        <Notice tone="danger" title={page.feedback.authError.title}>
          {page.feedback.authError.detail}
        </Notice>
      ) : null}

      <PageContentSurface aria-label="設定管理" className="grid gap-6" role="region">
        <p className="text-sm text-[var(--color-text-secondary)] empty:hidden" role="status">
          {page.guard.pending
            ? "設定の追加・保存・削除の結果を確認しています。完了するまで別の画面への移動をお待ちください。"
            : null}
        </p>
        {page.feedback.invalidTab ? (
          <Notice
            action={
              <Button size="sm" onClick={() => page.tabs.onChange("catalog")}>
                設定項目をリセット
              </Button>
            }
            title="指定された設定項目が見つかりません"
            tone="warning"
          >
            作品・マップ・シーズンを表示しています。設定項目を選び直してください。
          </Notice>
        ) : null}
        {page.feedback.operationError ? (
          <Notice tone="danger" title="設定の変更に失敗しました">
            {page.feedback.operationError}
          </Notice>
        ) : null}
        {page.feedback.forbiddenTab ? (
          <Notice tone="danger" title="管理者権限が必要です">
            この設定項目は管理者専用です。
          </Notice>
        ) : null}

        <TabsRoot
          value={page.tabs.active}
          onValueChange={(value) => page.tabs.onChange(value as MasterTabId)}
        >
          <TabsList aria-label="設定管理の表示切替" activateOnFocus={false}>
            {page.tabs.items.map((tab) => (
              <TabsTab key={tab.id} value={tab.id}>
                {tab.label}
              </TabsTab>
            ))}
          </TabsList>

          <TabsPanel keepMounted value="catalog">
            <div className="mt-6">
              <MasterPanelContent resource={page.catalog.gameTitle} resourceLabel="作品">
                <MasterRelationBoard
                  gameTitle={page.catalog.gameTitle}
                  map={page.catalog.map}
                  scopedDisabledReason={page.catalog.scopedDisabledReason}
                  season={page.catalog.season}
                />
              </MasterPanelContent>
            </div>
          </TabsPanel>

          {page.tabs.admin ? (
            <TabsPanel key={`${page.tabs.adminEpoch}:aliases`} keepMounted value="aliases">
              <div className="mt-6">
                <MasterPanelContent resource={page.aliases} resourceLabel="メンバー名寄せ">
                  <MemberAliasPanel
                    aliases={page.aliases.items}
                    completion={page.aliases.completion}
                    createAction={page.aliases.createAction}
                    createError={page.aliases.createError}
                    createFormKey={page.aliases.createFormKey}
                    createPending={page.aliases.createPending}
                    onDelete={page.aliases.onDelete}
                    onRetry={page.aliases.onRetry}
                    onUpdate={page.aliases.onUpdate}
                    refreshing={page.aliases.refreshing}
                    stale={page.aliases.stale}
                  />
                </MasterPanelContent>
              </div>
            </TabsPanel>
          ) : null}

          <TabsPanel keepMounted value="incidents">
            <div className="mt-6">
              <MasterPanelContent resource={page.incidents} resourceLabel="事件簿">
                <IncidentMasterPanel
                  items={page.incidents.items}
                  onRetry={page.incidents.onRetry}
                  refreshing={page.incidents.refreshing}
                  stale={page.incidents.stale}
                />
              </MasterPanelContent>
            </div>
          </TabsPanel>

          {page.tabs.admin ? (
            <TabsPanel
              key={`${page.tabs.adminEpoch}:notifications`}
              keepMounted
              value="notifications"
            >
              <div className="mt-6">
                <NotificationSettingsPanel model={page.notifications} />
              </div>
            </TabsPanel>
          ) : null}

          {page.tabs.admin ? (
            <TabsPanel key={`${page.tabs.adminEpoch}:accounts`} keepMounted value="accounts">
              <div className="mt-6">
                <AccountSettingsPanel model={page.accounts} />
              </div>
            </TabsPanel>
          ) : null}
        </TabsRoot>
      </PageContentSurface>
    </PageFrame>
  );
}

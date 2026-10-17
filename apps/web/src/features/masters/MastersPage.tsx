import type { MasterTabId } from "@/features/masters/masterNavigationModel";
import {
  AccountsPanel,
  AliasesPanel,
  CatalogPanel,
  IncidentsPanel,
  NotificationsPanel,
} from "@/features/masters/MasterPanels";
import { MastersWorkBoundary, MastersWorkFeedback } from "@/features/masters/MastersWorkBoundary";
import { useMastersPageModel } from "@/features/masters/useMastersPageModel";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";
import { TabsList, TabsRoot, TabsTab } from "@/shared/ui/forms/Tabs";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";

export function MastersPage() {
  const page = useMastersPageModel();
  const admin = { retained: page.tabs.admin, epoch: page.tabs.adminEpoch };
  return (
    <PageFrame>
      <MastersWorkBoundary>
        {page.feedback.authError ? (
          <Notice tone="danger" title={page.feedback.authError.title}>
            {page.feedback.authError.detail}
          </Notice>
        ) : null}
        <PageContentSurface aria-label="設定管理" className="grid gap-6" role="region">
          <MastersWorkFeedback />
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
            <CatalogPanel enabled={page.openedTabs.includes("catalog")} />
            <AliasesPanel {...admin} enabled={page.openedTabs.includes("aliases")} />
            <IncidentsPanel enabled={page.openedTabs.includes("incidents")} />
            <NotificationsPanel {...admin} enabled={page.openedTabs.includes("notifications")} />
            <AccountsPanel {...admin} enabled={page.openedTabs.includes("accounts")} />
          </TabsRoot>
        </PageContentSurface>
      </MastersWorkBoundary>
    </PageFrame>
  );
}

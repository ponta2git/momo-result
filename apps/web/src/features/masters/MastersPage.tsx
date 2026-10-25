import {
  MastersEditStatusProvider,
  MastersEditFeedback,
} from "@/features/masters/MastersEditStatus";
import type { MasterTabId } from "@/features/masters/mastersNavigation";
import {
  AccountsTab,
  AchievementsTab,
  AliasesTab,
  CatalogTab,
  IncidentsTab,
  NotificationsTab,
} from "@/features/masters/MastersTabs";
import { useMastersPageNavigation } from "@/features/masters/useMastersPageNavigation";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";
import { TabsList, TabsRoot, TabsTab } from "@/shared/ui/forms/Tabs";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";

export function MastersPage() {
  const navigation = useMastersPageNavigation();
  const adminAccess = { retained: navigation.tabs.admin, epoch: navigation.tabs.adminEpoch };
  return (
    <PageFrame>
      <MastersEditStatusProvider>
        {navigation.feedback.authError ? (
          <Notice tone="danger" title={navigation.feedback.authError.title}>
            {navigation.feedback.authError.detail}
          </Notice>
        ) : null}
        <PageContentSurface aria-label="設定管理" className="grid gap-6" role="region">
          <MastersEditFeedback />
          {navigation.feedback.invalidTab ? (
            <Notice
              action={
                <Button size="sm" onClick={() => navigation.tabs.onChange("catalog")}>
                  設定項目をリセット
                </Button>
              }
              title="指定された設定項目が見つかりません"
              tone="warning"
            >
              作品・マップ・シーズンを表示しています。設定項目を選び直してください。
            </Notice>
          ) : null}
          {navigation.feedback.forbiddenTab ? (
            <Notice tone="danger" title="管理者権限が必要です">
              この設定項目は管理者専用です。
            </Notice>
          ) : null}
          <TabsRoot
            value={navigation.tabs.active}
            onValueChange={(value) => navigation.tabs.onChange(value as MasterTabId)}
          >
            <TabsList aria-label="設定管理の表示切替" activateOnFocus={false}>
              {navigation.tabs.items.map((tab) => (
                <TabsTab key={tab.id} value={tab.id}>
                  {tab.label}
                </TabsTab>
              ))}
            </TabsList>
            <CatalogTab enabled={navigation.openedTabs.includes("catalog")} />
            <AchievementsTab enabled={navigation.openedTabs.includes("achievements")} />
            <AliasesTab {...adminAccess} enabled={navigation.openedTabs.includes("aliases")} />
            <IncidentsTab enabled={navigation.openedTabs.includes("incidents")} />
            <NotificationsTab
              {...adminAccess}
              enabled={navigation.openedTabs.includes("notifications")}
            />
            <AccountsTab {...adminAccess} enabled={navigation.openedTabs.includes("accounts")} />
          </TabsRoot>
        </PageContentSurface>
      </MastersEditStatusProvider>
    </PageFrame>
  );
}

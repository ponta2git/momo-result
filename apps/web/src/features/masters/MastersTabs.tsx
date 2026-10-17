import { AccountSettingsPanel } from "@/features/masters/accounts/AccountSettingsPanel";
import { useAccountSettings } from "@/features/masters/accounts/useAccountSettings";
import { MemberAliasPanel } from "@/features/masters/aliases/MemberAliasPanel";
import { useMemberAliases } from "@/features/masters/aliases/useMemberAliases";
import { MasterCatalogPanel } from "@/features/masters/catalog/MasterCatalogPanel";
import { useMasterCatalog } from "@/features/masters/catalog/useMasterCatalog";
import { IncidentMasterPanel } from "@/features/masters/incidents/IncidentMasterPanel";
import { useIncidentMasters } from "@/features/masters/incidents/useIncidentMasters";
import { MasterPanelContent } from "@/features/masters/MasterPanelContent";
import { useReportMasterEditStatus } from "@/features/masters/MastersEditStatus";
import { NotificationSettingsPanel } from "@/features/masters/notifications/NotificationSettingsPanel";
import { useNotificationSettingsEditor } from "@/features/masters/notifications/useNotificationSettingsEditor";
import { TabsPanel } from "@/shared/ui/forms/Tabs";

type TabAccess = { enabled: boolean };
type AdminTabAccess = TabAccess & { retained: boolean; epoch: number };

// These connectors stay mounted for the route. Epoch keys reset inputs without resetting queues.
export function CatalogTab({ enabled }: TabAccess) {
  const { catalog, pending, operationError } = useMasterCatalog(enabled);
  useReportMasterEditStatus("catalog", { pending, error: operationError });
  return (
    <TabsPanel keepMounted value="catalog">
      <div className="mt-6">
        <MasterPanelContent resource={catalog.gameTitle} resourceLabel="作品">
          <MasterCatalogPanel
            gameTitle={catalog.gameTitle}
            map={catalog.map}
            scopedDisabledReason={catalog.scopedDisabledReason}
            season={catalog.season}
          />
        </MasterPanelContent>
      </div>
    </TabsPanel>
  );
}

export function AliasesTab({ enabled, retained, epoch }: AdminTabAccess) {
  const aliases = useMemberAliases(enabled);
  useReportMasterEditStatus("aliases", { pending: aliases.pending });
  return retained ? (
    <TabsPanel key={`${epoch}:aliases`} keepMounted value="aliases">
      <div className="mt-6">
        <MasterPanelContent resource={aliases} resourceLabel="メンバー名寄せ">
          <MemberAliasPanel
            aliases={aliases.items}
            completion={aliases.completion}
            createAction={aliases.createAction}
            createError={aliases.createError}
            createFormKey={aliases.createFormKey}
            createPending={aliases.createPending}
            onDelete={aliases.onDelete}
            onRetry={aliases.onRetry}
            onUpdate={aliases.onUpdate}
            refreshing={aliases.refreshing}
            stale={aliases.stale}
          />
        </MasterPanelContent>
      </div>
    </TabsPanel>
  ) : null;
}

export function IncidentsTab({ enabled }: TabAccess) {
  const incidents = useIncidentMasters(enabled);
  return (
    <TabsPanel keepMounted value="incidents">
      <div className="mt-6">
        <MasterPanelContent resource={incidents} resourceLabel="事件簿">
          <IncidentMasterPanel
            items={incidents.items}
            onRetry={incidents.onRetry}
            refreshing={incidents.refreshing}
            stale={incidents.stale}
          />
        </MasterPanelContent>
      </div>
    </TabsPanel>
  );
}

export function NotificationsTab({ enabled, retained, epoch }: AdminTabAccess) {
  const notificationEditor = useNotificationSettingsEditor(enabled);
  useReportMasterEditStatus("notifications", {
    pending: notificationEditor.pending,
    dirty: notificationEditor.dirty,
    discard: notificationEditor.discardChanges,
  });
  return retained ? (
    <TabsPanel key={`${epoch}:notifications`} keepMounted value="notifications">
      <div className="mt-6">
        <NotificationSettingsPanel editor={notificationEditor} />
      </div>
    </TabsPanel>
  ) : null;
}

export function AccountsTab({ enabled, retained, epoch }: AdminTabAccess) {
  const accountSettings = useAccountSettings(enabled);
  useReportMasterEditStatus("accounts", { pending: accountSettings.pending });
  return retained ? (
    <TabsPanel key={`${epoch}:accounts`} keepMounted value="accounts">
      <div className="mt-6">
        <AccountSettingsPanel settings={accountSettings} />
      </div>
    </TabsPanel>
  ) : null;
}

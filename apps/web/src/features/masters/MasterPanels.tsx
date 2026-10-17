import { AccountSettingsPanel } from "@/features/masters/accounts/AccountSettingsPanel";
import { useAccountSettingsModel } from "@/features/masters/accounts/useAccountSettingsModel";
import { IncidentMasterPanel } from "@/features/masters/IncidentMasterPanel";
import { MasterPanelContent } from "@/features/masters/MasterPanelContent";
import { MasterRelationBoard } from "@/features/masters/MasterRelationBoard";
import { useReportMasterWork } from "@/features/masters/MastersWorkBoundary";
import { MemberAliasPanel } from "@/features/masters/MemberAliasPanel";
import { NotificationSettingsPanel } from "@/features/masters/notifications/NotificationSettingsPanel";
import { useNotificationSettingsModel } from "@/features/masters/notifications/useNotificationSettingsModel";
import { useIncidentMasters } from "@/features/masters/useIncidentMasters";
import { useMasterCatalog } from "@/features/masters/useMasterCatalog";
import { useMemberAliases } from "@/features/masters/useMemberAliases";
import { TabsPanel } from "@/shared/ui/forms/Tabs";

type PanelAccess = { enabled: boolean };
type AdminPanelAccess = PanelAccess & { retained: boolean; epoch: number };

// These connectors stay mounted for the route. Epoch keys reset inputs without resetting queues.
export function CatalogPanel({ enabled }: PanelAccess) {
  const { catalog, pending, operationError } = useMasterCatalog(enabled);
  useReportMasterWork("catalog", { pending, error: operationError });
  return (
    <TabsPanel keepMounted value="catalog">
      <div className="mt-6">
        <MasterPanelContent resource={catalog.gameTitle} resourceLabel="作品">
          <MasterRelationBoard
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

export function AliasesPanel({ enabled, retained, epoch }: AdminPanelAccess) {
  const aliases = useMemberAliases(enabled);
  useReportMasterWork("aliases", { pending: aliases.pending });
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

export function IncidentsPanel({ enabled }: PanelAccess) {
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

export function NotificationsPanel({ enabled, retained, epoch }: AdminPanelAccess) {
  const notifications = useNotificationSettingsModel(enabled);
  useReportMasterWork("notifications", {
    pending: notifications.pending,
    dirty: notifications.dirty,
    discard: notifications.discardChanges,
  });
  return retained ? (
    <TabsPanel key={`${epoch}:notifications`} keepMounted value="notifications">
      <div className="mt-6">
        <NotificationSettingsPanel model={notifications} />
      </div>
    </TabsPanel>
  ) : null;
}

export function AccountsPanel({ enabled, retained, epoch }: AdminPanelAccess) {
  const accounts = useAccountSettingsModel(enabled);
  useReportMasterWork("accounts", { pending: accounts.pending });
  return retained ? (
    <TabsPanel key={`${epoch}:accounts`} keepMounted value="accounts">
      <div className="mt-6">
        <AccountSettingsPanel model={accounts} />
      </div>
    </TabsPanel>
  ) : null;
}

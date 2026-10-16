import { useAccountSettingsModel } from "@/features/masters/accounts/useAccountSettingsModel";
import { useNotificationSettingsModel } from "@/features/masters/notifications/useNotificationSettingsModel";
import { useMasterDirectories } from "@/features/masters/useMasterDirectories";
import { useMasterNavigation } from "@/features/masters/useMasterNavigation";
import { useAuthorization } from "@/shared/auth/useAuthorization";

/** Composes the independently owned settings workflows into the page contract. */
export function useMastersPageModel() {
  const authorization = useAuthorization();
  const navigation = useMasterNavigation();
  const directories = useMasterDirectories({
    catalog: navigation.openedTabs.includes("catalog"),
    aliases: navigation.openedTabs.includes("aliases"),
    incidents: navigation.openedTabs.includes("incidents"),
  });
  const notifications = useNotificationSettingsModel(
    navigation.openedTabs.includes("notifications"),
  );
  const accounts = useAccountSettingsModel(navigation.openedTabs.includes("accounts"));

  return {
    aliases: directories.aliases,
    catalog: directories.catalog,
    incidents: directories.incidents,
    notifications,
    accounts,
    feedback: {
      ...navigation.feedback,
      authError: authorization.auth.error,
      operationError: directories.operationError,
    },
    guard: {
      model: {
        dirty: notifications.dirty,
        navigationAllowedRef: navigation.guard.navigationAllowedRef,
        onDiscard: notifications.reset,
      },
      pending: directories.pending || notifications.pending || accounts.pending,
      preservesInput: navigation.guard.preservesInput,
    },
    tabs: navigation.tabs,
  };
}

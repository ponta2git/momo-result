import { useMastersTabs } from "@/features/masters/useMastersTabs";
import { useAuthStatus } from "@/shared/auth/useAuthStatus";

/** The page subscribes to navigation and access; each retained panel owns its workflow. */
export function useMastersPageNavigation() {
  const authStatus = useAuthStatus();
  const tabNavigation = useMastersTabs();
  return {
    openedTabs: tabNavigation.openedTabs,
    feedback: {
      ...tabNavigation.feedback,
      authError: authStatus.error,
    },
    tabs: tabNavigation.tabs,
  } as const;
}

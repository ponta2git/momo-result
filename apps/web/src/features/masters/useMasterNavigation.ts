import { useOptimistic, useRef, useState, useTransition } from "react";
import { useSearchParams } from "react-router-dom";

import {
  masterTabFromSearch,
  masterTabPermission,
  masterTabSearch,
  preservesMastersInput,
  resolveMasterNavigation,
} from "@/features/masters/masterNavigationModel";
import type { MasterTabId } from "@/features/masters/masterNavigationModel";
import { useAuthorization } from "@/shared/auth/useAuthorization";

/** Owns URL navigation and the lifetime of visited settings panels. */
export function useMasterNavigation() {
  const authorization = useAuthorization();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setOptimisticTab] = useOptimistic(masterTabFromSearch(searchParams));
  const [, startTabTransition] = useTransition();
  const [visitedTabs, setVisitedTabs] = useState<MasterTabId[]>([]);
  const navigationAllowedRef = useRef(false);
  const navigation = resolveMasterNavigation({
    activeTab,
    rawTab: searchParams.get("tab"),
    retained: authorization.retained,
    visitedTabs,
  });
  if (navigation.nextVisitedTabs !== visitedTabs) setVisitedTabs(navigation.nextVisitedTabs);

  return {
    guard: { navigationAllowedRef, preservesInput: preservesMastersInput },
    openedTabs: navigation.openedTabs,
    feedback: {
      invalidTab: navigation.invalidTab,
      forbiddenTab: navigation.forbiddenTab,
    },
    tabs: {
      active: navigation.active,
      admin: authorization.retained.admin,
      adminEpoch: authorization.epoch.admin,
      items: navigation.items,
      onChange: (nextTab: MasterTabId) => {
        if (!authorization.can(masterTabPermission(nextTab))) return;
        const next = masterTabSearch(searchParams, nextTab);
        startTabTransition(() => {
          setOptimisticTab(nextTab);
          setSearchParams(next, { replace: true });
        });
      },
    },
  };
}

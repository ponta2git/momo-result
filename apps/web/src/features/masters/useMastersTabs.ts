import { useOptimistic, useState, useTransition } from "react";
import { useSearchParams } from "react-router-dom";

import {
  masterTabFromSearch,
  masterTabPermission,
  masterTabSearch,
  resolveMasterNavigation,
} from "@/features/masters/mastersNavigation";
import type { MasterTabId } from "@/features/masters/mastersNavigation";
import { useAuthorizationOperations, usePermissionFacts } from "@/shared/auth/useAuthorization";

/** Owns URL navigation and the lifetime of visited settings panels. */
export function useMastersTabs() {
  const authorization = useAuthorizationOperations();
  const admin = usePermissionFacts("admin");
  const operations = usePermissionFacts("operations");
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setOptimisticTab] = useOptimistic(masterTabFromSearch(searchParams));
  const [, startTabTransition] = useTransition();
  const [visitedTabs, setVisitedTabs] = useState<MasterTabId[]>([]);
  const navigation = resolveMasterNavigation({
    activeTab,
    rawTab: searchParams.get("tab"),
    retained: { admin: admin.retained, operations: operations.retained },
    visitedTabs,
  });
  if (navigation.nextVisitedTabs !== visitedTabs) setVisitedTabs(navigation.nextVisitedTabs);
  const openedTabs: readonly MasterTabId[] = navigation.openedTabs;
  const items: ReadonlyArray<{ readonly id: MasterTabId; readonly label: string }> =
    navigation.items;

  return {
    openedTabs,
    feedback: {
      invalidTab: navigation.invalidTab,
      forbiddenTab: navigation.forbiddenTab,
    },
    tabs: {
      active: navigation.active,
      admin: admin.retained,
      adminEpoch: admin.epoch,
      items,
      onChange: (nextTab: MasterTabId) => {
        if (!authorization.can(masterTabPermission(nextTab))) return;
        const next = masterTabSearch(searchParams, nextTab);
        startTabTransition(() => {
          setOptimisticTab(nextTab);
          setSearchParams(next, { replace: true });
        });
      },
    },
  } as const;
}

import type { ManagementPermission } from "@/shared/auth/permissions";

export const masterTabs = [
  { id: "catalog", label: "作品・マップ・シーズン" },
  { id: "achievements", label: "実績" },
  { id: "aliases", label: "メンバー名寄せ" },
  { id: "incidents", label: "事件簿" },
  { id: "notifications", label: "通知" },
  { id: "accounts", label: "アカウント" },
] as const;

export type MasterTabId = (typeof masterTabs)[number]["id"];

export function isMasterTabId(value: string | null): value is MasterTabId {
  return masterTabs.some((tab) => tab.id === value);
}

export function masterTabFromSearch(search: URLSearchParams): MasterTabId {
  const tab = search.get("tab");
  return isMasterTabId(tab) ? tab : "catalog";
}

export function masterTabPermission(tab: MasterTabId): ManagementPermission {
  return tab === "catalog" || tab === "incidents" || tab === "achievements"
    ? "operations"
    : "admin";
}

/** Only permitted, visited panels keep their inputs and resources alive. */
export function resolveMasterNavigation(input: {
  activeTab: MasterTabId;
  rawTab: string | null;
  retained: { admin: boolean; operations: boolean };
  visitedTabs: MasterTabId[];
}) {
  const items = masterTabs.filter(
    (tab) => input.retained.admin || masterTabPermission(tab.id) === "operations",
  );
  const isAllowed = (tab: MasterTabId) =>
    input.retained.operations && items.some((item) => item.id === tab);
  const openedTabs = input.visitedTabs.filter(isAllowed);
  const nextVisitedTabs =
    isAllowed(input.activeTab) && !input.visitedTabs.includes(input.activeTab)
      ? [...openedTabs, input.activeTab]
      : openedTabs.length === input.visitedTabs.length
        ? input.visitedTabs
        : openedTabs;

  return {
    active: isAllowed(input.activeTab) ? input.activeTab : null,
    items,
    openedTabs,
    nextVisitedTabs,
    invalidTab: input.rawTab !== null && !isMasterTabId(input.rawTab),
    forbiddenTab: isMasterTabId(input.rawTab) && !isAllowed(input.rawTab),
  };
}

export function masterTabSearch(search: URLSearchParams, tab: MasterTabId): URLSearchParams {
  const next = new URLSearchParams(search);
  next.delete("returnTo");
  next.delete("handoffId");
  if (tab === "catalog") next.delete("tab");
  else next.set("tab", tab);
  return next;
}

export function preservesMastersInput(
  current: { pathname: string },
  next: { pathname: string },
): boolean {
  return current.pathname === next.pathname;
}

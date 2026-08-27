import type { QueryClient, QueryKey } from "@tanstack/react-query";

import { clearCsrfToken } from "@/shared/api/csrfTokenStore";

function isSameQueryKey(left: QueryKey, right: QueryKey): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function clearPrincipalSessionStorage(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    // sessionStorage is tab-local and all persisted entries are invalid across principals.
    window.sessionStorage.clear();
  } catch {
    // Storage access is best effort; account-scoped keys still prevent cross-principal reads.
  }
}

export async function clearPrincipalClientState(
  queryClient: QueryClient,
  options: { loggedOutAuthQueryKey?: QueryKey } = {},
): Promise<void> {
  clearCsrfToken();
  clearPrincipalSessionStorage();
  await queryClient.cancelQueries();

  const loggedOutAuthQueryKey = options.loggedOutAuthQueryKey;
  if (loggedOutAuthQueryKey) {
    queryClient.setQueryData(loggedOutAuthQueryKey, null);
  }
  queryClient.removeQueries({
    predicate: (query) =>
      !loggedOutAuthQueryKey || !isSameQueryKey(query.queryKey, loggedOutAuthQueryKey),
  });
}

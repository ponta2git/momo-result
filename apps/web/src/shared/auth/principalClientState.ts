import type { QueryClient, QueryKey } from "@tanstack/react-query";

import { clearCsrfToken } from "@/shared/api/csrfTokenStore";
import { clearPrincipalRequestScope } from "@/shared/api/principalRequestScope";
import { clearAccountOperationNotice } from "@/shared/auth/accountOperationNotice";
import { momoToastManager } from "@/shared/ui/feedback/Toast";

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
  retainedAuth?: { queryKey: QueryKey; state: "authenticated" | "logged-out" },
): Promise<void> {
  clearPrincipalRequestScope(queryClient);
  // A newly confirmed account already owns its auth request and CSRF token.
  // Logout and the development picker instead discard the entire previous session.
  if (retainedAuth?.state !== "authenticated") clearCsrfToken();
  clearAccountOperationNotice();
  momoToastManager.close();
  clearPrincipalSessionStorage();
  await queryClient.cancelQueries({
    predicate: (query) =>
      retainedAuth?.state !== "authenticated" ||
      !isSameQueryKey(query.queryKey, retainedAuth.queryKey),
  });

  if (retainedAuth?.state === "logged-out") {
    queryClient.setQueryData(retainedAuth.queryKey, null);
  }
  queryClient.removeQueries({
    predicate: (query) => !retainedAuth || !isSameQueryKey(query.queryKey, retainedAuth.queryKey),
  });
}

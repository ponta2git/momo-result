import type { QueryClient } from "@tanstack/react-query";

import type { LoginAccountListResponse, LoginAccountResponse } from "@/shared/api/adminAccounts";
import { adminAccountKeys } from "@/shared/api/queryKeys";
import { authMeQueryKey } from "@/shared/auth/authQueries";

export async function cacheSavedAccount(queryClient: QueryClient, saved: LoginAccountResponse) {
  const queryKey = adminAccountKeys.all();
  await queryClient.cancelQueries({ queryKey, exact: true });
  queryClient.setQueryData<LoginAccountListResponse>(queryKey, (current) => {
    if (!current) return current;
    const items = current.items ?? [];
    return {
      ...current,
      items: items.some((account) => account.accountId === saved.accountId)
        ? items.map((account) => (account.accountId === saved.accountId ? saved : account))
        : [...items, saved],
    };
  });
}

export async function invalidateAdminAccountCaches(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: adminAccountKeys.all() }),
    queryClient.invalidateQueries({ queryKey: authMeQueryKey }),
  ]);
}

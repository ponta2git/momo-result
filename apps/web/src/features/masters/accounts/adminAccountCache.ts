import type { QueryClient } from "@tanstack/react-query";

import type { LoginAccountListResponse, LoginAccountResponse } from "@/shared/api/adminAccounts";
import type { AuthMeResponse } from "@/shared/api/auth";
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

export async function cacheSelfDemotion(queryClient: QueryClient, saved: LoginAccountResponse) {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: adminAccountKeys.all() }),
    queryClient.cancelQueries({ queryKey: authMeQueryKey }),
  ]);
  // The committed role must take effect even when a later auth read is unavailable.
  // Keep this session's other fields, including its CSRF token, intact.
  queryClient.setQueriesData<AuthMeResponse | null>({ queryKey: authMeQueryKey }, (current) =>
    current?.accountId === saved.accountId ? { ...current, role: saved.role } : current,
  );
  queryClient.removeQueries({ queryKey: adminAccountKeys.all() });
}

import type { QueryClient } from "@tanstack/react-query";

import { adminAccountsQueryKeys } from "@/features/adminAccounts/queryKeys";
import { authMeQueryKey } from "@/shared/auth/authQueries";

export async function invalidateAdminAccountCaches(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: adminAccountsQueryKeys.all() }),
    queryClient.invalidateQueries({ queryKey: authMeQueryKey }),
  ]);
}

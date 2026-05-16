import type { QueryClient } from "@tanstack/react-query";

import { adminAccountsQueryKeys } from "@/features/adminAccounts/queryKeys";

export async function invalidateAdminAccountCaches(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: adminAccountsQueryKeys.all() });
}

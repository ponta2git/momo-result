import type { QueryClient } from "@tanstack/react-query";

import { adminAccountKeys } from "@/shared/api/queryKeys";
import { authMeQueryKey } from "@/shared/auth/authQueries";

export async function invalidateAdminAccountCaches(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: adminAccountKeys.all() }),
    queryClient.invalidateQueries({ queryKey: authMeQueryKey }),
  ]);
}

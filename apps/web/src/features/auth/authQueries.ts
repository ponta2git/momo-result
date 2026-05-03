import { queryOptions } from "@tanstack/react-query";

import { getAuthMe } from "@/shared/api/client";

export const authMeQueryKey = ["auth-me"] as const;

export function authQueryOptions() {
  return queryOptions({
    queryKey: authMeQueryKey,
    queryFn: getAuthMe,
  });
}

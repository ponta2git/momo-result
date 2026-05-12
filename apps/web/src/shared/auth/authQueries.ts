import { queryOptions } from "@tanstack/react-query";

import { getAuthMe } from "@/shared/api/client";

export const authMeQueryKey = ["auth-me"] as const;

export function authMeQueryKeyFor(devUser: string | undefined) {
  return [...authMeQueryKey, import.meta.env.DEV ? devUser || "none" : "session"] as const;
}

export function authQueryOptions(devUser?: string) {
  return queryOptions({
    queryKey: authMeQueryKeyFor(devUser),
    queryFn: getAuthMe,
    enabled: !import.meta.env.DEV || Boolean(devUser),
  });
}

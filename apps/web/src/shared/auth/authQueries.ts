import { queryOptions } from "@tanstack/react-query";

import { getAuthMe } from "@/shared/api/auth";
import type { AuthMeResponse } from "@/shared/api/auth";
import { clearPrincipalClientState } from "@/shared/auth/principalClientState";

export const authMeQueryKey = ["auth-me"] as const;

export function authMeQueryKeyFor(devUser: string | undefined) {
  return [...authMeQueryKey, import.meta.env.DEV ? devUser || "none" : "session"] as const;
}

export function authQueryOptions(devUser?: string) {
  return queryOptions({
    queryKey: authMeQueryKeyFor(devUser),
    queryFn: async ({ client, queryKey, signal }) => {
      const previous = client.getQueryData<AuthMeResponse | null>(queryKey);
      const current = await getAuthMe({ signal });
      if (previous?.accountId && previous.accountId !== current.accountId) {
        await clearPrincipalClientState(client, { queryKey, state: "authenticated" });
        signal.throwIfAborted();
      }
      return current;
    },
    enabled: !import.meta.env.DEV || Boolean(devUser),
    refetchOnMount: false,
  });
}

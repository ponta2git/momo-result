import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient, QueryKey } from "@tanstack/react-query";

import { logout } from "@/shared/api/auth";
import { clearCsrfToken } from "@/shared/api/csrfTokenStore";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { authMeQueryKeyFor, authQueryOptions } from "@/shared/auth/authQueries";
import { useDevUser } from "@/shared/auth/useDevUser";

function isSameQueryKey(left: QueryKey, right: QueryKey): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function clearSessionQueryCache(
  queryClient: QueryClient,
  currentAuthQueryKey: QueryKey,
): Promise<void> {
  await queryClient.cancelQueries();
  queryClient.setQueryData(currentAuthQueryKey, null);
  queryClient.removeQueries({
    predicate: (query) => !isSameQueryKey(query.queryKey, currentAuthQueryKey),
  });
}

export function useAuth() {
  const queryClient = useQueryClient();
  const { devUser, setDevUser } = useDevUser();
  const authQuery = useQuery(authQueryOptions(devUser));
  const isMissingDevUser = import.meta.env.DEV && !devUser;
  const isLoggedOut = authQuery.data === null;
  const normalizedError = authQuery.error ? normalizeUnknownApiError(authQuery.error) : undefined;
  const isChecking = authQuery.isPending && authQuery.fetchStatus !== "idle";

  const logoutMutation = useMutation({
    mutationFn: async () => {
      if (import.meta.env.DEV && Boolean(devUser)) {
        return { clearsMutableDevOverride: true };
      }
      try {
        await logout();
      } catch (error) {
        if (normalizeUnknownApiError(error).status !== 401) {
          throw error;
        }
        clearCsrfToken();
        // Logout is idempotently complete when the server reports that the session
        // has already ended. The response also expires the session cookie.
      }
      return { clearsMutableDevOverride: false };
    },
    onSuccess: async ({ clearsMutableDevOverride }) => {
      if (clearsMutableDevOverride) {
        setDevUser("");
      }
      await clearSessionQueryCache(queryClient, authMeQueryKeyFor(devUser));
    },
  });

  return {
    auth: authQuery.data ?? undefined,
    error: normalizedError,
    isAuthenticated: authQuery.isSuccess && !isLoggedOut,
    isChecking,
    isForbidden: normalizedError?.status === 403,
    isRefetching: authQuery.isFetching && !authQuery.isPending,
    isUnauthorized: normalizedError?.status === 401 || isMissingDevUser || isLoggedOut,
    logoutError: logoutMutation.error ? normalizeUnknownApiError(logoutMutation.error) : undefined,
    isLogoutPending: logoutMutation.isPending,
    logout: () => logoutMutation.mutate(),
    refetch: authQuery.refetch,
  };
}

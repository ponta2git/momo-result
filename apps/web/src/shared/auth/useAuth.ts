import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { logout } from "@/shared/api/auth";
import { clearCsrfToken } from "@/shared/api/csrfTokenStore";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { authMeQueryKeyFor, authQueryOptions } from "@/shared/auth/authQueries";
import { clearPrincipalClientState } from "@/shared/auth/principalClientState";
import { useDevUser } from "@/shared/auth/useDevUser";

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
      await clearPrincipalClientState(queryClient, {
        loggedOutAuthQueryKey: authMeQueryKeyFor(devUser),
      });
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

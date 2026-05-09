import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { authMeQueryKey, authQueryOptions } from "@/features/auth/authQueries";
import { logout } from "@/shared/api/client";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { useDevUser } from "@/shared/auth/useDevUser";

export function useAuth() {
  const queryClient = useQueryClient();
  const { devUser, lockedByEnv, setDevUser } = useDevUser();
  const authQuery = useQuery(authQueryOptions(devUser));
  const isMissingDevUser = import.meta.env.DEV && !devUser;
  const normalizedError = authQuery.error ? normalizeUnknownApiError(authQuery.error) : undefined;

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSettled: async () => {
      if (import.meta.env.DEV && !lockedByEnv) {
        setDevUser("");
      }
      await queryClient.invalidateQueries({ queryKey: authMeQueryKey });
    },
  });

  return {
    auth: authQuery.data,
    error: normalizedError,
    isAuthenticated: authQuery.isSuccess,
    isChecking: authQuery.isPending && authQuery.fetchStatus !== "idle",
    isForbidden: normalizedError?.status === 403,
    isUnauthorized: normalizedError?.status === 401 || isMissingDevUser,
    isLogoutPending: logoutMutation.isPending,
    logout: () => logoutMutation.mutate(),
    refetch: authQuery.refetch,
  };
}

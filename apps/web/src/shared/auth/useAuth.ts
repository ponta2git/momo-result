import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { authMeQueryKey, authQueryOptions } from "@/features/auth/authQueries";
import { logout } from "@/shared/api/client";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";

export function useAuth() {
  const queryClient = useQueryClient();
  const authQuery = useQuery(authQueryOptions());
  const normalizedError = authQuery.error ? normalizeUnknownApiError(authQuery.error) : undefined;

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: authMeQueryKey });
    },
  });

  return {
    auth: authQuery.data,
    error: normalizedError,
    isAuthenticated: authQuery.isSuccess,
    isChecking: authQuery.isPending,
    isForbidden: normalizedError?.status === 403,
    isUnauthorized: normalizedError?.status === 401,
    isLogoutPending: logoutMutation.isPending,
    logout: () => logoutMutation.mutate(),
    refetch: authQuery.refetch,
  };
}

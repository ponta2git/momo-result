import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { authQueryOptions } from "@/shared/auth/authQueries";
import type { AuthStatus } from "@/shared/auth/authStatus";
import { useDevUser } from "@/shared/auth/useDevUser";

export function useAuthStatus(): AuthStatus {
  const { devUser } = useDevUser();
  const authQuery = useQuery(authQueryOptions(devUser));
  const { refetch } = authQuery;
  const refreshAuthentication = useCallback(async () => {
    await refetch();
  }, [refetch]);
  const isMissingDevUser = import.meta.env.DEV && !devUser;
  const isLoggedOut = authQuery.data === null;
  const normalizedError = authQuery.error ? normalizeUnknownApiError(authQuery.error) : undefined;
  const isChecking = authQuery.isPending && authQuery.fetchStatus !== "idle";

  return {
    auth: authQuery.data ?? undefined,
    error: normalizedError,
    isAuthenticated: authQuery.isSuccess && !isLoggedOut,
    isChecking,
    isForbidden: normalizedError?.status === 403,
    isRefetching: authQuery.isFetching && !authQuery.isPending,
    isUnauthorized: normalizedError?.status === 401 || isMissingDevUser || isLoggedOut,
    refetch: refreshAuthentication,
  };
}

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { logout } from "@/shared/api/auth";
import { clearCsrfToken } from "@/shared/api/csrfTokenStore";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { authMeQueryKeyFor } from "@/shared/auth/authQueries";
import { clearPrincipalClientState } from "@/shared/auth/principalClientState";
import { useAuthStatus } from "@/shared/auth/useAuthStatus";
import { useDevUser } from "@/shared/auth/useDevUser";

export function useAuthSession() {
  const queryClient = useQueryClient();
  const { devUser, setDevUser } = useDevUser();
  const auth = useAuthStatus();

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
        queryKey: authMeQueryKeyFor(devUser),
        state: "logged-out",
      });
    },
  });

  return {
    ...auth,
    logoutError: logoutMutation.error ? normalizeUnknownApiError(logoutMutation.error) : undefined,
    isLogoutPending: logoutMutation.isPending,
    logout: () => logoutMutation.mutate(),
  };
}

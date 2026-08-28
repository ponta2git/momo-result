import { useQueryClient } from "@tanstack/react-query";

import { clearPrincipalClientState } from "@/shared/auth/principalClientState";
import { useDevUser } from "@/shared/auth/useDevUser";

/** Switches the development principal only after principal-bound client state is cleared. */
export function usePrincipalSwitchCommand() {
  const queryClient = useQueryClient();
  const { devUser, setDevUser } = useDevUser();
  const switchPrincipal = async (nextPrincipal: string) => {
    if (nextPrincipal === devUser) {
      return;
    }
    await clearPrincipalClientState(queryClient);
    setDevUser(nextPrincipal);
  };

  return { currentPrincipal: devUser, switchPrincipal };
}

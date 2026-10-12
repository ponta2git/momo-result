import { useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { getAuthorization } from "@/shared/auth/authorization";
import { useAuth } from "@/shared/auth/useAuth";
import { useDevUser } from "@/shared/auth/useDevUser";

export function useAuthorization() {
  const client = useQueryClient();
  const auth = useAuth();
  const { devUser } = useDevUser();
  const owner = getAuthorization(client, devUser);
  const revision = useSyncExternalStore(owner.subscribe, owner.snapshot, owner.snapshot);
  const allowed = { admin: owner.can("admin"), operations: owner.can("operations") };
  const retained = { admin: owner.has("admin"), operations: owner.has("operations") };

  return {
    revision,
    auth,
    allowed,
    retained,
    paused: retained.operations && !allowed.operations && !auth.isUnauthorized && !auth.isForbidden,
    epoch: { admin: owner.epoch("admin"), operations: owner.epoch("operations") },
    begin: owner.begin,
    can: owner.can,
    canRead: owner.canRead,
    isCurrent: owner.isCurrent,
    isSameAccount: owner.isSameAccount,
    canCommit: owner.canCommit,
    reportError: owner.reportError,
    recheck: owner.recheck,
    acceptSelfRole: owner.acceptSelfRole,
  };
}

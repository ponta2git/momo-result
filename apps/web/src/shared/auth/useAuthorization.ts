import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";

import type {
  AuthorizationAccess,
  AuthorizationOperations,
  PermissionFacts,
} from "@/shared/auth/authorization";
import { getAuthorization } from "@/shared/auth/authorizationQueryAdapter";
import { authQueryOptions } from "@/shared/auth/authQueries";
import type { ManagementPermission } from "@/shared/auth/permissions";
import { useAuthStatus } from "@/shared/auth/useAuthStatus";
import { useDevUser } from "@/shared/auth/useDevUser";

function useAuthorizationOwner() {
  const client = useQueryClient();
  const { devUser } = useDevUser();
  return getAuthorization(client, devUser);
}

export function useAuthorizationOperations(): AuthorizationOperations {
  return useAuthorizationOwner().operations;
}

/** Subscribe only to the permission needed by a panel; the cache still owns authentication. */
export function usePermissionFacts(permission: ManagementPermission): PermissionFacts {
  const { devUser } = useDevUser();
  const owner = useAuthorizationOwner();
  useQuery({ ...authQueryOptions(devUser), notifyOnChangeProps: [] });
  const snapshot = useMemo(() => () => owner.permissionSnapshot(permission), [owner, permission]);
  return useSyncExternalStore(owner.subscribe, snapshot, snapshot);
}

export function useAuthorization(): AuthorizationAccess {
  const auth = useAuthStatus();
  const owner = useAuthorizationOwner();
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
    ...owner.operations,
  };
}

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { selectMemberAliases } from "@/features/masters/aliases/memberAliases";
import { masterDirectoryState } from "@/features/masters/masterDirectoryState";
import {
  cacheCreatedMaster,
  cacheMasterUpdate,
  invalidateMemberAliasCaches,
} from "@/features/masters/masterResourceCache";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { createMemberAlias, deleteMemberAlias, updateMemberAlias } from "@/shared/api/masters";
import type {
  CreateMemberAliasRequest,
  MemberAliasResponse,
  UpdateMemberAliasRequest,
} from "@/shared/api/masters";
import { isInitialQueryLoading, shouldShowQueryError } from "@/shared/api/queryErrorState";
import { masterKeys } from "@/shared/api/queryKeys";
import { memberAliasesQueryOptions } from "@/shared/api/queryOptions";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import type { AuthorizationLease } from "@/shared/auth/authorization";
import { useAuthorizationOperations, usePermissionFacts } from "@/shared/auth/useAuthorization";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

/** Owns alias reads and the confirmed cache changes made by each write. */
export function useMemberAliasResource(enabled: boolean) {
  const permission = usePermissionFacts("admin");
  const authorization = useAuthorizationOperations();
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const query = useQuery({
    ...memberAliasesQueryOptions(),
    select: selectMemberAliases,
    enabled: () => enabled && permission.allowed && authorization.can("admin"),
  });
  const failed = useRetryNotice(
    shouldShowQueryError(query),
    query.isFetching,
    String(permission.epoch),
  );
  const items: ReadonlyArray<Readonly<MemberAliasResponse>> = query.data ?? [];
  const applyChange = async (
    id: string,
    saved: MemberAliasResponse | null,
    lease: AuthorizationLease,
  ) => {
    if (!authorization.isSameAccount(lease)) return;
    await cacheMasterUpdate(queryClient, masterKeys.memberAliases.all(), id, saved, () =>
      authorization.isSameAccount(lease),
    );
    if (!authorization.isSameAccount(lease)) return;
    await invalidateMemberAliasCaches(queryClient);
  };
  return {
    directory: {
      ...masterDirectoryState({
        hasData: query.data !== undefined,
        failed,
        initialLoading: isInitialQueryLoading(query),
        fetching: query.isFetching,
        mutationPending: false,
      }),
      items,
      refresh: async () =>
        Boolean(authorization.begin("admin")) && (await query.refetch()).isSuccess,
    },
    create: async (request: CreateMemberAliasRequest, lease: AuthorizationLease) => {
      const saved = await runIdempotentMutation(
        idempotencyKeys,
        "masters.createMemberAlias",
        request,
        (options) => createMemberAlias(request, options),
      );
      if (!authorization.isSameAccount(lease)) return;
      await cacheCreatedMaster(queryClient, masterKeys.memberAliases.list(), saved, () =>
        authorization.isSameAccount(lease),
      );
      await invalidateMemberAliasCaches(queryClient);
    },
    update: async (id: string, request: UpdateMemberAliasRequest, lease: AuthorizationLease) => {
      const saved = await runIdempotentMutation(
        idempotencyKeys,
        "masters.updateMemberAlias",
        { id, request },
        (options) => updateMemberAlias(id, request, options),
      );
      await applyChange(id, saved, lease);
    },
    remove: async (id: string, lease: AuthorizationLease) => {
      await runIdempotentMutation(idempotencyKeys, "masters.deleteMemberAlias", { id }, (options) =>
        deleteMemberAlias(id, options),
      );
      await applyChange(id, null, lease);
    },
  };
}

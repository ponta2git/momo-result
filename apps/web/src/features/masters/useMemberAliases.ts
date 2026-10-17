import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  normalizeMemberAliasEdit,
  parseMemberAliasCreate,
} from "@/features/masters/masterFormModel";
import { selectMemberAliases } from "@/features/masters/masterQueries";
import {
  cacheCreatedMaster,
  cacheMasterUpdate,
  invalidateMemberAliasCaches,
} from "@/features/masters/masterResourceCache";
import { masterDirectoryState } from "@/features/masters/masterViewModel";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { createMemberAlias, deleteMemberAlias, updateMemberAlias } from "@/shared/api/masters";
import type { MemberAliasResponse } from "@/shared/api/masters";
import { formatApiError } from "@/shared/api/problemDetails";
import { isInitialQueryLoading, shouldShowQueryError } from "@/shared/api/queryErrorState";
import { masterKeys } from "@/shared/api/queryKeys";
import { memberAliasesQueryOptions } from "@/shared/api/queryOptions";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import type { AuthorizationLease } from "@/shared/auth/authorization";
import { useAuthorizationOperations, usePermissionFacts } from "@/shared/auth/useAuthorization";
import { useAuthorizedAction } from "@/shared/auth/useAuthorizedAction";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";
import { showToast } from "@/shared/ui/feedback/Toast";

type CreateResult = { error?: string | undefined; version: number };

/** Alias reads and writes outlive their visible panel, including an authorization recheck. */
export function useMemberAliases(enabled: boolean) {
  const permission = usePermissionFacts("admin");
  const authorization = useAuthorizationOperations();
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const [completion, setCompletion] = useState("");
  const [editing, setEditing] = useState<AuthorizationLease[]>([]);
  const query = useQuery({
    ...memberAliasesQueryOptions(),
    select: selectMemberAliases,
    enabled: () => enabled && permission.allowed && authorization.can("admin"),
  });
  const [createState, createAction, createPending] = useAuthorizedAction<CreateResult>(
    authorization,
    "admin",
    async (previous, formData, lease) => {
      setCompletion("");
      const parsed = parseMemberAliasCreate(formData);
      if (parsed.kind === "invalid") return { ...previous, error: parsed.error };
      const { request } = parsed;
      try {
        const created = await runIdempotentMutation(
          idempotencyKeys,
          "masters.createMemberAlias",
          request,
          (options) => createMemberAlias(request, options),
        );
        if (!authorization.isSameAccount(lease)) return previous;
        await cacheCreatedMaster(queryClient, masterKeys.memberAliases.list(), created, () =>
          authorization.isSameAccount(lease),
        );
        await invalidateMemberAliasCaches(queryClient);
        if (!authorization.isCurrent(lease)) return previous;
        setCompletion("別名を追加しました");
        return { version: previous.version + 1 };
      } catch (error) {
        authorization.reportError(error, lease);
        if (!authorization.isCurrent(lease)) return previous;
        return { ...previous, error: formatApiError(error, "別名の追加に失敗しました") };
      }
    },
    { version: 0 },
  );

  const edit = async (id: string, request: { memberId: string; alias: string } | undefined) => {
    const lease = authorization.begin("admin");
    if (!lease) throw new DOMException("権限を確認できません", "AbortError");
    setEditing((current) => [...current, lease]);
    setCompletion("");
    try {
      const normalized = request ? normalizeMemberAliasEdit(request) : undefined;
      const saved = normalized
        ? await runIdempotentMutation(
            idempotencyKeys,
            "masters.updateMemberAlias",
            { id, request: normalized },
            (options) => updateMemberAlias(id, normalized, options),
          )
        : await runIdempotentMutation(
            idempotencyKeys,
            "masters.deleteMemberAlias",
            { id },
            async (options) => {
              await deleteMemberAlias(id, options);
              return null;
            },
          );
      if (!authorization.isSameAccount(lease)) return;
      await cacheMasterUpdate(queryClient, masterKeys.memberAliases.all(), id, saved, () =>
        authorization.isSameAccount(lease),
      );
      if (!authorization.isSameAccount(lease)) return;
      await invalidateMemberAliasCaches(queryClient);
      if (normalized && authorization.isCurrent(lease)) setCompletion("別名を保存しました");
      else if (!normalized && authorization.canCommit(lease))
        showToast({ title: "別名を削除しました", tone: "success" });
    } catch (error) {
      authorization.reportError(error, lease);
      throw error;
    } finally {
      setEditing((current) => current.filter((active) => active !== lease));
    }
  };
  const pending = permission.retained && (createPending || editing.some(authorization.isCurrent));
  const failed = useRetryNotice(
    shouldShowQueryError(query),
    query.isFetching,
    String(permission.epoch),
  );
  const items: ReadonlyArray<Readonly<MemberAliasResponse>> = query.data ?? [];
  return {
    ...masterDirectoryState({
      hasData: query.data !== undefined,
      failed,
      initialLoading: isInitialQueryLoading(query),
      fetching: query.isFetching,
      mutationPending: pending,
    }),
    completion,
    createAction,
    createError: createState.error,
    createFormKey: createState.version,
    createPending,
    items,
    onDelete: (id: string) => edit(id, undefined),
    onUpdate: (id: string, request: { memberId: string; alias: string }) => edit(id, request),
    onRetry: async () => Boolean(authorization.begin("admin")) && (await query.refetch()).isSuccess,
    pending,
  } as const;
}

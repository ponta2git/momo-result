import { useState } from "react";

import {
  normalizeMemberAliasEdit,
  parseMemberAliasCreate,
} from "@/features/masters/aliases/memberAliases";
import { useMemberAliasResource } from "@/features/masters/aliases/useMemberAliasResource";
import { formatApiError } from "@/shared/api/problemDetails";
import type { AuthorizationLease } from "@/shared/auth/authorization";
import { useAuthorizationOperations, usePermissionFacts } from "@/shared/auth/useAuthorization";
import { useAuthorizedAction } from "@/shared/auth/useAuthorizedAction";
import { showToast } from "@/shared/ui/feedback/Toast";

type CreateResult = { error?: string | undefined; version: number };

/** Alias reads and writes outlive their visible panel, including an authorization recheck. */
export function useMemberAliases(enabled: boolean) {
  const permission = usePermissionFacts("admin");
  const authorization = useAuthorizationOperations();
  const resource = useMemberAliasResource(enabled);
  const [completion, setCompletion] = useState("");
  const [editing, setEditing] = useState<AuthorizationLease[]>([]);
  const [createState, createAction, createPending] = useAuthorizedAction<CreateResult>(
    authorization,
    "admin",
    async (previous, formData, lease) => {
      setCompletion("");
      const parsed = parseMemberAliasCreate(formData);
      if (parsed.kind === "invalid") return { ...previous, error: parsed.error };
      const { request } = parsed;
      try {
        await resource.create(request, lease);
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
      if (normalized) await resource.update(id, normalized, lease);
      else await resource.remove(id, lease);
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
  const { refresh, ...directory } = resource.directory;
  return {
    ...directory,
    refreshing: directory.refreshing && !pending,
    completion,
    createAction,
    createError: createState.error,
    createFormKey: createState.version,
    createPending,
    onDelete: (id: string) => edit(id, undefined),
    onUpdate: (id: string, request: { memberId: string; alias: string }) => edit(id, request),
    onRetry: refresh,
    pending,
  } as const;
}

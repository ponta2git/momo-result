import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import type { NotificationSettingsRead } from "@/features/masters/notifications/notificationSettingsEditing";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { updateNotificationSettings } from "@/shared/api/notificationSettings";
import type {
  NotificationSettings,
  NotificationSettingsUpdate,
} from "@/shared/api/notificationSettings";
import { notificationSettingsKeys } from "@/shared/api/queryKeys";
import { notificationSettingsQueryOptions } from "@/shared/api/queryOptions";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import type { AuthorizationLease } from "@/shared/auth/authorization";
import { canReadProtectedQuery } from "@/shared/auth/authorizationQueryAdapter";
import { useAuthorizationOperations, usePermissionFacts } from "@/shared/auth/useAuthorization";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

export type NotificationSaveEvent =
  | { kind: "started" | "accepted" | "finished" }
  | { kind: "failed"; error: unknown };

/** A confirmed save may wait for authorization before updating the cache and its editor. */
export function useNotificationSettingsResource(
  enabled: boolean,
  onSaveEvent: (event: NotificationSaveEvent) => void,
) {
  const authorization = useAuthorizationOperations();
  const permission = usePermissionFacts("admin");
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const canReadSettings =
    permission.allowed &&
    canReadProtectedQuery(authorization, queryClient, "admin", notificationSettingsKeys.all());
  const query = useQuery({
    ...notificationSettingsQueryOptions(),
    enabled: () =>
      enabled &&
      canReadSettings &&
      canReadProtectedQuery(authorization, queryClient, "admin", notificationSettingsKeys.all()),
  });
  const savingLease = useRef<AuthorizationLease | undefined>(undefined);
  const isSaving = () =>
    Boolean(savingLease.current && authorization.isCurrent(savingLease.current));
  const appliedSettings = useRef<NotificationSettings | undefined>(undefined);
  const mutation = useMutation({
    mutationFn: ({
      request,
      lease,
    }: {
      request: NotificationSettingsUpdate;
      lease: AuthorizationLease;
    }) => {
      if (!authorization.canCommit(lease))
        throw new DOMException("権限を確認できません", "AbortError");
      return runIdempotentMutation(
        idempotencyKeys,
        "notificationSettings.update",
        request,
        (options) => updateNotificationSettings(request, options),
      );
    },
    onMutate: () => {
      onSaveEvent({ kind: "started" });
      return queryClient.cancelQueries({ queryKey: notificationSettingsKeys.all() });
    },
    onError: (error, { lease }) => {
      authorization.reportError(error, lease);
      if (authorization.isCurrent(lease)) onSaveEvent({ kind: "failed", error });
    },
    onSettled: (_data, _error, { lease }) => {
      if (savingLease.current === lease) savingLease.current = undefined;
      if (authorization.isCurrent(lease)) onSaveEvent({ kind: "finished" });
    },
  });
  const { data: saved, variables } = mutation;
  const { refetch } = query;
  useEffect(() => {
    if (
      !permission.allowed ||
      !saved ||
      !variables ||
      appliedSettings.current === saved ||
      !authorization.canCommit(variables.lease)
    )
      return;
    appliedSettings.current = saved;
    queryClient.setQueryData(notificationSettingsKeys.all(), saved);
    onSaveEvent({ kind: "accepted" });
    // Reconcile a confirmed replay only while this same admin workflow is still valid.
    void refetch();
  }, [authorization, permission.allowed, onSaveEvent, queryClient, refetch, saved, variables]);
  const pending =
    mutation.isPending && Boolean(variables && authorization.isCurrent(variables.lease));
  const confirmed = permission.retained ? query.data : undefined;
  const failed = useRetryNotice(query.isError, query.isFetching);
  const read: NotificationSettingsRead = {
    ...(confirmed
      ? { kind: "ready", confirmed, stale: failed }
      : { kind: failed ? "failed" : "loading" }),
    refreshing: query.isFetching,
    reloadRequired: query.isError,
  };

  return {
    read,
    pending,
    isSaving,
    save: (request: NotificationSettingsUpdate) => {
      const lease = authorization.begin("admin");
      if (!lease || isSaving()) return;
      savingLease.current = lease;
      mutation.mutate({ lease, request });
    },
    reload: async () => {
      const lease = authorization.begin("admin");
      if (!lease || isSaving() || query.isFetching) return false;
      const result = await refetch();
      if (!authorization.canCommit(lease)) return false;
      if (result.isSuccess) idempotencyKeys.reset("notificationSettings.update");
      return result.isSuccess;
    },
  };
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import {
  buildNotificationSettingsView,
  changeNotificationDraft,
  notificationSaveError,
} from "@/features/masters/notifications/notificationSettingsModel";
import type {
  NotificationDraft,
  NotificationFeedback,
  NotificationKind,
  NotificationSettingsModel,
} from "@/features/masters/notifications/notificationSettingsModel";
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
import { useAuthorizationOperations, usePermissionFacts } from "@/shared/auth/useAuthorization";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

/** Keeps editable choices tied to the confirmed generations from which editing began. */
export function useNotificationSettingsModel(queryEnabled = true): NotificationSettingsModel {
  const authorization = useAuthorizationOperations();
  const permission = usePermissionFacts("admin");
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const canReadSettings =
    permission.allowed && authorization.canRead("admin", notificationSettingsKeys.all());
  const query = useQuery({
    ...notificationSettingsQueryOptions(),
    enabled: () =>
      queryEnabled &&
      canReadSettings &&
      authorization.canRead("admin", notificationSettingsKeys.all()),
  });
  const [draft, setDraft] = useState<NotificationDraft>();
  const [feedback, setFeedback] = useState<NotificationFeedback>();
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const saving = useRef<AuthorizationLease | undefined>(undefined);
  const isSaving = () => Boolean(saving.current && authorization.isCurrent(saving.current));
  const applied = useRef<NotificationSettings | undefined>(undefined);
  const [draftEpoch, setDraftEpoch] = useState(permission.epoch);
  if (draftEpoch !== permission.epoch) {
    setDraftEpoch(permission.epoch);
    setDraft(undefined);
    setFeedback(undefined);
    setConfirmationOpen(false);
  }

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
      setFeedback(undefined);
      return queryClient.cancelQueries({ queryKey: notificationSettingsKeys.all() });
    },
    onError: (error, { lease }) => {
      authorization.reportError(error, lease);
      if (authorization.isCurrent(lease)) setFeedback(notificationSaveError(error));
    },
    onSettled: (_data, _error, { lease }) => {
      if (saving.current === lease) saving.current = undefined;
      if (!authorization.isCurrent(lease)) return;
      setConfirmationOpen(false);
    },
  });
  const { data: saved, variables } = mutation;
  useEffect(() => {
    if (
      !permission.allowed ||
      !saved ||
      !variables ||
      applied.current === saved ||
      !authorization.canCommit(variables.lease)
    )
      return;
    applied.current = saved;
    queryClient.setQueryData(notificationSettingsKeys.all(), saved);
    setDraft(undefined);
    setFeedback({ tone: "success", message: "通知設定を保存しました。" });
    // Reconcile a confirmed replay only while this same admin workflow is still valid.
    void query.refetch();
  }, [authorization, permission.allowed, query, queryClient, saved, variables]);
  const pending =
    mutation.isPending && Boolean(variables && authorization.isCurrent(variables.lease));

  const confirmed = permission.retained ? query.data : undefined;
  const failed = useRetryNotice(query.isError, query.isFetching);
  const { savePlan, ...view } = buildNotificationSettingsView({
    confirmed,
    draft,
    feedback,
    canEdit: permission.allowed,
    retainEdits: permission.retained,
    pending,
    fetching: query.isFetching,
    failed,
    queryError: query.isError,
  });

  const change = (kind: NotificationKind, enabled: boolean) => {
    if (!authorization.can("admin") || !confirmed || view.disabled || isSaving()) return;
    setDraft((current) => changeNotificationDraft(current, confirmed, kind, enabled));
    setFeedback(undefined);
  };

  const save = () => {
    const lease = authorization.begin("admin");
    if (!lease || savePlan.kind === "blocked" || isSaving()) return;
    saving.current = lease;
    mutation.mutate({ lease, request: savePlan.request });
  };

  const submit = () => {
    if (!authorization.can("admin") || savePlan.kind === "blocked") return;
    if (savePlan.requiresConfirmation) setConfirmationOpen(true);
    else save();
  };

  const reload = async () => {
    const lease = authorization.begin("admin");
    if (!lease || isSaving() || query.isFetching) return false;
    const result = await query.refetch();
    if (!authorization.canCommit(lease)) return false;
    if (result.isSuccess) {
      setDraft(undefined);
      idempotencyKeys.reset("notificationSettings.update");
      setFeedback(undefined);
    }
    return result.isSuccess;
  };

  return {
    ...view,
    change,
    submit,
    reload,
    discardChanges: () => {
      setDraft(undefined);
      setFeedback(undefined);
    },
    confirmation: {
      open: permission.retained && confirmationOpen,
      cancel: () => setConfirmationOpen(false),
      save,
    },
  };
}

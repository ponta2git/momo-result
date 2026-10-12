import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { runIdempotentMutation } from "@/shared/api/idempotency";
import { updateNotificationSettings } from "@/shared/api/notificationSettings";
import type {
  NotificationSettings,
  NotificationSettingsUpdate,
} from "@/shared/api/notificationSettings";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { notificationSettingsKeys } from "@/shared/api/queryKeys";
import { notificationSettingsQueryOptions } from "@/shared/api/queryOptions";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import type { AuthorizationLease } from "@/shared/auth/authorization";
import { useAuthorization } from "@/shared/auth/useAuthorization";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

type Kind = keyof NotificationSettings;
type Values = Record<Kind, boolean>;
type Draft = { base: NotificationSettings; values: Values };
type Feedback = {
  tone: "success" | "danger" | "warning";
  message: string;
  requiresReload?: true;
};
type SettingsResource =
  | { status: "loading" | "failed" }
  | { status: "ready"; confirmed: NotificationSettings; values: Values };

function valuesOf(settings: NotificationSettings): Values {
  return {
    ocrCompleted: settings.ocrCompleted.enabled,
    analysisCompleted: settings.analysisCompleted.enabled,
  };
}

function saveErrorFeedback(error: unknown): Feedback {
  const problem = normalizeUnknownApiError(error);
  if (problem.code === "NOTIFICATION_SETTINGS_VERSION_CONFLICT") {
    return {
      tone: "warning",
      requiresReload: true,
      message: "通知設定が別の画面で更新されています。現在の設定を読み込んで選び直してください。",
    };
  }
  if (
    problem.status === undefined ||
    problem.status >= 500 ||
    problem.code === "IDEMPOTENCY_IN_PROGRESS"
  ) {
    return {
      tone: "warning",
      requiresReload: true,
      message:
        "保存結果を確認できません。現在の設定を読み込んで、反映された内容を確認してください。",
    };
  }
  return { tone: "danger", message: `保存できませんでした。${problem.detail}` };
}

/** Keeps editable choices tied to the confirmed generations from which editing began. */
export function useNotificationSettingsModel(queryEnabled = true) {
  const authorization = useAuthorization();
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const canReadSettings = authorization.canRead("admin", notificationSettingsKeys.all());
  const query = useQuery({
    ...notificationSettingsQueryOptions(),
    enabled: () =>
      queryEnabled &&
      canReadSettings &&
      authorization.canRead("admin", notificationSettingsKeys.all()),
  });
  const [draft, setDraft] = useState<Draft>();
  const [feedback, setFeedback] = useState<Feedback>();
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const saving = useRef<AuthorizationLease | undefined>(undefined);
  const isSaving = () => Boolean(saving.current && authorization.isCurrent(saving.current));
  const applied = useRef<NotificationSettings | undefined>(undefined);
  const [draftEpoch, setDraftEpoch] = useState(authorization.epoch.admin);
  if (draftEpoch !== authorization.epoch.admin) {
    setDraftEpoch(authorization.epoch.admin);
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
      if (authorization.isCurrent(lease)) setFeedback(saveErrorFeedback(error));
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
  }, [authorization, query, queryClient, saved, variables]);
  const pending =
    mutation.isPending && Boolean(variables && authorization.isCurrent(variables.lease));

  const confirmed = authorization.retained.admin ? query.data : undefined;
  const failed = useRetryNotice(query.isError, query.isFetching);
  const resource: SettingsResource = confirmed
    ? { status: "ready", confirmed, values: draft?.values ?? valuesOf(confirmed) }
    : { status: failed ? "failed" : "loading" };
  const dirty = Boolean(
    draft &&
    (draft.values.ocrCompleted !== draft.base.ocrCompleted.enabled ||
      draft.values.analysisCompleted !== draft.base.analysisCompleted.enabled),
  );
  const needsReload = Boolean(feedback?.requiresReload || query.isError);
  const disabled = !authorization.allowed.admin || pending || query.isFetching || needsReload;
  const turnsOff = Boolean(
    draft &&
    (Object.keys(draft.values) as Kind[]).some(
      (kind) => draft.base[kind].enabled && !draft.values[kind],
    ),
  );

  const change = (kind: Kind, enabled: boolean) => {
    if (!authorization.can("admin") || !confirmed || disabled || isSaving()) return;
    setDraft((current) => ({
      base: current?.base ?? confirmed,
      values: { ...(current?.values ?? valuesOf(confirmed)), [kind]: enabled },
    }));
    setFeedback(undefined);
  };

  const save = () => {
    const lease = authorization.begin("admin");
    if (!lease || !draft || !dirty || disabled || isSaving()) return;
    saving.current = lease;
    mutation.mutate({
      lease,
      request: {
        ocrCompleted: {
          enabled: draft.values.ocrCompleted,
          expectedGeneration: draft.base.ocrCompleted.generation,
        },
        analysisCompleted: {
          enabled: draft.values.analysisCompleted,
          expectedGeneration: draft.base.analysisCompleted.generation,
        },
      },
    });
  };

  const submit = () => {
    if (!authorization.can("admin") || !draft || !dirty || disabled) return;
    if (turnsOff) setConfirmationOpen(true);
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
    resource,
    dirty: authorization.retained.admin && dirty,
    disabled,
    feedback,
    change,
    submit,
    pending,
    stale: confirmed !== undefined && failed,
    needsReload,
    refreshing: query.isFetching,
    reload,
    reset: () => {
      setDraft(undefined);
      setFeedback(undefined);
    },
    confirmation: {
      open: authorization.retained.admin && confirmationOpen,
      setOpen: setConfirmationOpen,
      save,
    },
  };
}

export type NotificationSettingsModel = ReturnType<typeof useNotificationSettingsModel>;

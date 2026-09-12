import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

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
export function useNotificationSettingsPageModel() {
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const query = useQuery(notificationSettingsQueryOptions());
  const [draft, setDraft] = useState<Draft>();
  const [feedback, setFeedback] = useState<Feedback>();
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const saving = useRef(false);

  const mutation = useMutation({
    mutationFn: (request: NotificationSettingsUpdate) =>
      runIdempotentMutation(idempotencyKeys, "notificationSettings.update", request, (options) =>
        updateNotificationSettings(request, options),
      ),
    onMutate: () => {
      setFeedback(undefined);
      return queryClient.cancelQueries({ queryKey: notificationSettingsKeys.all() });
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(notificationSettingsKeys.all(), saved);
      setDraft(undefined);
      setFeedback({ tone: "success", message: "通知設定を保存しました。" });
      // A replay may describe an earlier save. Reconcile independently so a read failure
      // cannot turn a confirmed mutation into a failed save.
      void query.refetch();
    },
    onError: (error) => setFeedback(saveErrorFeedback(error)),
    onSettled: () => {
      saving.current = false;
      setConfirmationOpen(false);
    },
  });

  const confirmed = query.data;
  const resource: SettingsResource = confirmed
    ? { status: "ready", confirmed, values: draft?.values ?? valuesOf(confirmed) }
    : { status: query.isError ? "failed" : "loading" };
  const dirty = Boolean(
    draft &&
    (draft.values.ocrCompleted !== draft.base.ocrCompleted.enabled ||
      draft.values.analysisCompleted !== draft.base.analysisCompleted.enabled),
  );
  const needsReload = Boolean(feedback?.requiresReload || query.isError);
  const disabled = mutation.isPending || query.isFetching || needsReload;

  const change = (kind: Kind, enabled: boolean) => {
    if (!confirmed || disabled || saving.current) return;
    setDraft((current) => ({
      base: current?.base ?? confirmed,
      values: { ...(current?.values ?? valuesOf(confirmed)), [kind]: enabled },
    }));
    setFeedback(undefined);
  };

  const save = () => {
    if (!draft || !dirty || disabled || saving.current) return;
    saving.current = true;
    mutation.mutate({
      ocrCompleted: {
        enabled: draft.values.ocrCompleted,
        expectedGeneration: draft.base.ocrCompleted.generation,
      },
      analysisCompleted: {
        enabled: draft.values.analysisCompleted,
        expectedGeneration: draft.base.analysisCompleted.generation,
      },
    });
  };

  const submit = () => {
    if (!draft || !dirty || disabled) return;
    const turnsOff = (Object.keys(draft.values) as Kind[]).some(
      (kind) => draft.base[kind].enabled && !draft.values[kind],
    );
    if (turnsOff) setConfirmationOpen(true);
    else save();
  };

  const reload = async () => {
    if (saving.current || query.isFetching) return;
    const result = await query.refetch();
    if (result.isSuccess) {
      setDraft(undefined);
      idempotencyKeys.reset("notificationSettings.update");
      setFeedback(undefined);
    }
  };

  return {
    resource,
    dirty,
    disabled,
    feedback,
    change,
    submit,
    pending: mutation.isPending,
    stale: confirmed !== undefined && query.isError,
    needsReload,
    refreshing: query.isFetching,
    reload: () => {
      void reload();
    },
    reset: () => {
      setDraft(undefined);
      setFeedback(undefined);
    },
    confirmation: { open: confirmationOpen, setOpen: setConfirmationOpen, save },
  };
}

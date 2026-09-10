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
type Feedback = { kind: "success" | "failed" | "conflict" | "unknown"; message: string };

function valuesOf(settings: NotificationSettings): Values {
  return {
    ocrCompleted: settings.ocrCompleted.enabled,
    analysisCompleted: settings.analysisCompleted.enabled,
  };
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
  });

  const confirmed = query.data;
  const values = draft?.values ?? (confirmed ? valuesOf(confirmed) : undefined);
  const dirty = Boolean(
    draft &&
    (draft.values.ocrCompleted !== draft.base.ocrCompleted.enabled ||
      draft.values.analysisCompleted !== draft.base.analysisCompleted.enabled),
  );
  const needsReload =
    feedback?.kind === "conflict" || feedback?.kind === "unknown" || query.isError;
  const disabled = mutation.isPending || query.isFetching || needsReload;

  const change = (kind: Kind, enabled: boolean) => {
    if (!confirmed || disabled) return;
    setDraft((current) => ({
      base: current?.base ?? confirmed,
      values: { ...(current?.values ?? valuesOf(confirmed)), [kind]: enabled },
    }));
    setFeedback(undefined);
  };

  const save = async () => {
    if (!draft || !dirty || disabled || saving.current) return;
    saving.current = true;
    const request: NotificationSettingsUpdate = {
      ocrCompleted: {
        enabled: draft.values.ocrCompleted,
        expectedGeneration: draft.base.ocrCompleted.generation,
      },
      analysisCompleted: {
        enabled: draft.values.analysisCompleted,
        expectedGeneration: draft.base.analysisCompleted.generation,
      },
    };
    try {
      await queryClient.cancelQueries({ queryKey: notificationSettingsKeys.all() });
      const saved = await mutation.mutateAsync(request);
      queryClient.setQueryData(notificationSettingsKeys.all(), saved);
      setDraft(undefined);
      setFeedback({ kind: "success", message: "通知設定を保存しました。" });
      // A replay may describe an earlier successful save. Reconcile with the current settings;
      // a subsequent read failure is separate from the confirmed mutation result.
      void query.refetch();
    } catch (error) {
      const problem = normalizeUnknownApiError(error);
      if (problem.code === "NOTIFICATION_SETTINGS_VERSION_CONFLICT") {
        setFeedback({
          kind: "conflict",
          message:
            "通知設定が別の画面で更新されています。現在の設定を読み込んで選び直してください。",
        });
      } else if (
        problem.status === undefined ||
        problem.status >= 500 ||
        problem.code === "IDEMPOTENCY_IN_PROGRESS"
      ) {
        setFeedback({
          kind: "unknown",
          message:
            "保存結果を確認できません。現在の設定を読み込んで、反映された内容を確認してください。",
        });
      } else {
        setFeedback({ kind: "failed", message: `保存できませんでした。${problem.detail}` });
      }
    } finally {
      saving.current = false;
      setConfirmationOpen(false);
    }
  };

  const submit = () => {
    if (!draft || !dirty || disabled) return;
    const turnsOff = (Object.keys(draft.values) as Kind[]).some(
      (kind) => draft.base[kind].enabled && !draft.values[kind],
    );
    if (turnsOff) setConfirmationOpen(true);
    else void save();
  };

  const reload = async () => {
    const result = await query.refetch();
    if (result.isSuccess) {
      setDraft(undefined);
      idempotencyKeys.reset("notificationSettings.update");
      setFeedback(undefined);
    }
  };

  return {
    confirmed,
    values,
    dirty,
    disabled,
    feedback,
    change,
    submit,
    pending: mutation.isPending,
    loading: confirmed === undefined && query.isPending,
    loadFailed: confirmed === undefined && query.isError,
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

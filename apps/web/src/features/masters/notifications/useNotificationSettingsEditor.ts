import { useCallback, useState } from "react";

import {
  buildNotificationSettingsView,
  changeNotificationDraft,
  notificationSaveError,
} from "@/features/masters/notifications/notificationSettingsEditing";
import type {
  NotificationDraft,
  NotificationFeedback,
  NotificationKind,
  NotificationSettingsEditor,
} from "@/features/masters/notifications/notificationSettingsEditing";
import { useNotificationSettingsResource } from "@/features/masters/notifications/useNotificationSettingsResource";
import type { NotificationSaveEvent } from "@/features/masters/notifications/useNotificationSettingsResource";
import { useAuthorizationOperations, usePermissionFacts } from "@/shared/auth/useAuthorization";

/** Keeps editable choices tied to the confirmed generations from which editing began. */
export function useNotificationSettingsEditor(queryEnabled = true): NotificationSettingsEditor {
  const authorization = useAuthorizationOperations();
  const permission = usePermissionFacts("admin");
  const [draft, setDraft] = useState<NotificationDraft>();
  const [feedback, setFeedback] = useState<NotificationFeedback>();
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [draftEpoch, setDraftEpoch] = useState(permission.epoch);
  if (draftEpoch !== permission.epoch) {
    setDraftEpoch(permission.epoch);
    setDraft(undefined);
    setFeedback(undefined);
    setConfirmationOpen(false);
  }
  const onSaveEvent = useCallback((event: NotificationSaveEvent) => {
    if (event.kind === "started") setFeedback(undefined);
    if (event.kind === "failed") setFeedback(notificationSaveError(event.error));
    if (event.kind === "finished") setConfirmationOpen(false);
    if (event.kind === "accepted") {
      setDraft(undefined);
      setFeedback({ tone: "success", message: "通知設定を保存しました。" });
    }
  }, []);
  const resource = useNotificationSettingsResource(queryEnabled, onSaveEvent);
  const { savePlan, ...view } = buildNotificationSettingsView({
    read: resource.read,
    draft,
    feedback,
    canEdit: permission.allowed,
    retainEdits: permission.retained,
    pending: resource.pending,
  });
  const change = (kind: NotificationKind, enabled: boolean) => {
    if (
      !authorization.can("admin") ||
      resource.read.kind !== "ready" ||
      view.disabled ||
      resource.isSaving()
    )
      return;
    const confirmed = resource.read.confirmed;
    setDraft((current) => changeNotificationDraft(current, confirmed, kind, enabled));
    setFeedback(undefined);
  };
  const save = () => {
    if (savePlan.kind !== "blocked") resource.save(savePlan.request);
  };
  const submit = () => {
    if (!authorization.can("admin") || savePlan.kind === "blocked") return;
    if (savePlan.requiresConfirmation) setConfirmationOpen(true);
    else save();
  };
  const reload = async () => {
    const reloaded = await resource.reload();
    if (reloaded) {
      setDraft(undefined);
      setFeedback(undefined);
    }
    return reloaded;
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

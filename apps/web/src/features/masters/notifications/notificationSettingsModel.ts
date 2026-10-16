import type {
  NotificationSettings,
  NotificationSettingsUpdate,
} from "@/shared/api/notificationSettings";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";

export type NotificationKind = keyof NotificationSettings;
type Values = Record<NotificationKind, boolean>;
export type NotificationDraft = { base: NotificationSettings; values: Values };
export type NotificationFeedback = {
  tone: "success" | "danger" | "warning";
  message: string;
  requiresReload?: true;
};
type SettingsResource =
  | { status: "loading" | "failed" }
  | { status: "ready"; confirmed: NotificationSettings; values: Values };
type SavePlan =
  | { kind: "blocked" }
  | { kind: "ready"; requiresConfirmation: boolean; request: NotificationSettingsUpdate };

function valuesOf(settings: NotificationSettings): Values {
  return {
    ocrCompleted: settings.ocrCompleted.enabled,
    analysisCompleted: settings.analysisCompleted.enabled,
  };
}

/** Later reads must not replace the generations against which editing began. */
export function changeNotificationDraft(
  draft: NotificationDraft | undefined,
  confirmed: NotificationSettings,
  kind: NotificationKind,
  enabled: boolean,
): NotificationDraft {
  return {
    base: draft?.base ?? confirmed,
    values: { ...(draft?.values ?? valuesOf(confirmed)), [kind]: enabled },
  };
}

export function notificationSaveError(error: unknown): NotificationFeedback {
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

/** Resolves the editable resource and the exact versioned save represented by the draft. */
export function buildNotificationSettingsView(input: {
  confirmed: NotificationSettings | undefined;
  draft: NotificationDraft | undefined;
  feedback: NotificationFeedback | undefined;
  canEdit: boolean;
  retainEdits: boolean;
  pending: boolean;
  fetching: boolean;
  failed: boolean;
  queryError: boolean;
}) {
  const { confirmed, draft, feedback } = input;
  const resource: SettingsResource = confirmed
    ? { status: "ready", confirmed, values: draft?.values ?? valuesOf(confirmed) }
    : { status: input.failed ? "failed" : "loading" };
  const dirty = Boolean(
    draft &&
    (draft.values.ocrCompleted !== draft.base.ocrCompleted.enabled ||
      draft.values.analysisCompleted !== draft.base.analysisCompleted.enabled),
  );
  const needsReload = Boolean(feedback?.requiresReload || input.queryError);
  const disabled = !input.canEdit || input.pending || input.fetching || needsReload;
  const turnsOff = Boolean(
    draft &&
    (Object.keys(draft.values) as NotificationKind[]).some(
      (kind) => draft.base[kind].enabled && !draft.values[kind],
    ),
  );
  const savePlan: SavePlan =
    draft && dirty && !disabled
      ? {
          kind: "ready",
          requiresConfirmation: turnsOff,
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
        }
      : { kind: "blocked" };
  const stale = confirmed !== undefined && input.failed;
  const retainedDirty = input.retainEdits && dirty;

  return {
    resource,
    dirty: retainedDirty,
    disabled,
    actionsDisabled: !retainedDirty || disabled,
    feedback,
    issue: feedback?.tone === "success" ? undefined : feedback,
    status: {
      completion: !input.pending && feedback?.tone === "success" ? feedback.message : undefined,
      checking: input.fetching && !input.pending && !needsReload && !stale,
      unsaved: !input.pending && !feedback && !needsReload && retainedDirty,
    },
    pending: input.pending,
    stale,
    needsReload,
    refreshing: input.fetching,
    savePlan,
  };
}

export type NotificationSettingsModel = Omit<
  ReturnType<typeof buildNotificationSettingsView>,
  "savePlan"
> & {
  change: (kind: NotificationKind, enabled: boolean) => void;
  submit: () => void;
  reload: () => Promise<boolean>;
  reset: () => void;
  confirmation: {
    open: boolean;
    setOpen: (open: boolean) => void;
    save: () => void;
  };
};

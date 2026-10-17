import { useCallback, useState } from "react";

import {
  buildAccountSettingsView,
  parseAccountCreateForm,
} from "@/features/masters/accounts/accountSettingsEditing";
import type { AccountSettingsControls } from "@/features/masters/accounts/accountSettingsEditing";
import { useAccountSettingsResource } from "@/features/masters/accounts/useAccountSettingsResource";
import { formatApiError } from "@/shared/api/problemDetails";
import { useAuthorizationOperations, usePermissionFacts } from "@/shared/auth/useAuthorization";
import { useAuthorizedAction } from "@/shared/auth/useAuthorizedAction";
import { showToast } from "@/shared/ui/feedback/Toast";

/** Keeps account editing alive while the user moves between settings tabs. */
export function useAccountSettings(queryEnabled = true): AccountSettingsControls {
  const authorization = useAuthorizationOperations();
  const permission = usePermissionFacts("admin");
  const [createOpen, setCreateOpen] = useState(false);
  const [createEpoch, setCreateEpoch] = useState(permission.epoch);
  if (createEpoch !== permission.epoch) {
    setCreateEpoch(permission.epoch);
    setCreateOpen(false);
  }
  const onSaved = useCallback((kind: "created" | "updated") => {
    if (kind === "created") setCreateOpen(false);
    showToast({
      title: kind === "created" ? "アカウントを追加しました" : "アカウント設定を更新しました",
      tone: "success",
    });
  }, []);
  const resource = useAccountSettingsResource(queryEnabled, onSaved);
  const [createError, createAction, createPending] = useAuthorizedAction(
    authorization,
    "admin",
    async (previous, formData, lease) => {
      const parsed = parseAccountCreateForm(formData);
      if (parsed.kind === "invalid") return parsed.error;
      try {
        await resource.create(parsed.request, lease);
        return "";
      } catch (error) {
        authorization.reportError(error, lease);
        if (!authorization.isCurrent(lease)) return previous;
        return formatApiError(error, "ログインアカウントの作成に失敗しました");
      }
    },
    "",
  );
  const currentCreatePending = createPending || resource.creationAwaitingAcceptance;
  const view = buildAccountSettingsView({
    list: resource.list,
    createPending: currentCreatePending,
    updatePending: resource.update.pending,
  });
  return {
    create: {
      action: createAction,
      disabled: view.createDisabled,
      error: createError,
      open: permission.retained && createOpen,
      pending: currentCreatePending,
      setOpen: (open) => {
        if (!open || authorization.can("admin")) setCreateOpen(open);
      },
    },
    list: view.list,
    pending: view.pending,
    update: resource.update,
  };
}

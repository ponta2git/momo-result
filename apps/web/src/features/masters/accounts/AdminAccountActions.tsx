import { useState } from "react";

import { accountRoleFromInput, accountRoleOptions } from "@/features/masters/accounts/accountRoles";
import type { AccountRole } from "@/features/masters/accounts/accountRoles";
import { accountActionView } from "@/features/masters/accounts/accountSettingsModel";
import type { LoginAccountResponse, UpdateLoginAccountRequest } from "@/shared/api/adminAccounts";
import { formatApiError } from "@/shared/api/problemDetails";
import { Button } from "@/shared/ui/actions/Button";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { SelectField } from "@/shared/ui/forms/SelectField";

export function AdminAccountActions({
  account,
  isPending,
  onPatch,
  pendingRequest,
}: {
  account: LoginAccountResponse;
  isPending: boolean;
  onPatch: (request: UpdateLoginAccountRequest) => Promise<void>;
  pendingRequest?: UpdateLoginAccountRequest | undefined;
}) {
  const actions = useAccountActions(account, pendingRequest, onPatch);

  return (
    <div
      aria-label={`${account.displayName}のアカウント操作`}
      className="flex flex-wrap gap-2"
      role="group"
    >
      <AlertDialog
        title={actions.login.title}
        description={`${account.displayName} のログイン状態を変更します。変更後すぐに利用可否へ反映されます。`}
        confirmLabel={actions.login.confirmLabel}
        formatError={(error) => formatApiError(error, "アカウント設定の更新に失敗しました")}
        pending={actions.login.pending}
        pendingLabel="更新中…"
        tone={actions.login.tone}
        trigger={
          <Button disabled={isPending} size="sm" variant="quiet">
            {actions.login.triggerLabel}
          </Button>
        }
        onConfirm={actions.confirmLogin}
      />
      <AlertDialog
        confirmDisabled={actions.role.confirmDisabled}
        confirmLabel="変更する"
        description={`${account.displayName} のロールを変更します。変更後すぐに操作できる範囲へ反映されます。`}
        formatError={(error) => formatApiError(error, "ロールの変更に失敗しました")}
        pending={actions.role.pending}
        pendingLabel="更新中…"
        title="ロールを変更しますか？"
        tone={actions.role.tone}
        trigger={
          <Button disabled={isPending} size="sm" variant="quiet">
            ロール変更
          </Button>
        }
        onConfirm={actions.confirmRole}
        onOpenChange={actions.openRole}
      >
        <SelectField
          disabled={actions.role.pending}
          label="ロール"
          options={accountRoleOptions}
          value={actions.selectedRole}
          onValueChange={actions.selectRole}
        />
      </AlertDialog>
    </div>
  );
}

/** The role draft belongs to its confirmation dialog and survives a rejected update. */
function useAccountActions(
  account: LoginAccountResponse,
  pendingRequest: UpdateLoginAccountRequest | undefined,
  onPatch: (request: UpdateLoginAccountRequest) => Promise<void>,
) {
  const [selectedRole, setSelectedRole] = useState<AccountRole>(account.role);
  const view = accountActionView(account, selectedRole, pendingRequest);
  return {
    ...view,
    selectedRole,
    confirmLogin: () => onPatch(view.login.request),
    confirmRole: () => onPatch(view.role.request),
    openRole: (open: boolean) => {
      if (open) setSelectedRole(account.role);
    },
    selectRole: (value: string) => {
      const role = accountRoleFromInput(value);
      if (role) setSelectedRole(role);
    },
  };
}

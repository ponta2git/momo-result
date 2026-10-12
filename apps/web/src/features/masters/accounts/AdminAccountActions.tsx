import { useState } from "react";

import { accountRoleOptions } from "@/features/masters/accounts/accountRoles";
import type { AccountRole } from "@/features/masters/accounts/accountRoles";
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
  const loginPending = pendingRequest?.loginEnabled !== undefined;
  const rolePending = pendingRequest?.role !== undefined;
  const [selectedRole, setSelectedRole] = useState<AccountRole>(account.role);

  return (
    <div
      aria-label={`${account.displayName}のアカウント操作`}
      className="flex flex-wrap gap-2"
      role="group"
    >
      <AlertDialog
        title={account.loginEnabled ? "ログインを停止しますか？" : "ログインを許可しますか？"}
        description={`${account.displayName} のログイン状態を変更します。変更後すぐに利用可否へ反映されます。`}
        confirmLabel={account.loginEnabled ? "停止する" : "許可する"}
        formatError={(error) => formatApiError(error, "アカウント設定の更新に失敗しました")}
        pending={loginPending}
        pendingLabel="更新中…"
        tone={account.loginEnabled ? "danger" : "primary"}
        trigger={
          <Button disabled={isPending} size="sm" variant="quiet">
            {account.loginEnabled ? "ログイン停止" : "ログイン許可"}
          </Button>
        }
        onConfirm={() => onPatch({ loginEnabled: !account.loginEnabled })}
      />
      <AlertDialog
        confirmDisabled={selectedRole === account.role}
        confirmLabel="変更する"
        description={`${account.displayName} のロールを変更します。変更後すぐに操作できる範囲へ反映されます。`}
        formatError={(error) => formatApiError(error, "ロールの変更に失敗しました")}
        pending={rolePending}
        pendingLabel="更新中…"
        title="ロールを変更しますか？"
        tone={account.role === "admin" && selectedRole !== "admin" ? "danger" : "primary"}
        trigger={
          <Button disabled={isPending} size="sm" variant="quiet">
            ロール変更
          </Button>
        }
        onConfirm={() => onPatch({ role: selectedRole })}
        onOpenChange={(open) => {
          if (open) setSelectedRole(account.role);
        }}
      >
        <SelectField
          disabled={rolePending}
          label="ロール"
          options={accountRoleOptions}
          value={selectedRole}
          onValueChange={(value) => {
            const option = accountRoleOptions.find((candidate) => candidate.value === value);
            if (option) setSelectedRole(option.value);
          }}
        />
      </AlertDialog>
    </div>
  );
}

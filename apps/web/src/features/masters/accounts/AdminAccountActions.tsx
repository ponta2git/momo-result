import type { LoginAccountResponse, UpdateLoginAccountRequest } from "@/shared/api/adminAccounts";
import { formatApiError } from "@/shared/api/problemDetails";
import { Button } from "@/shared/ui/actions/Button";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";

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
  const adminPending = pendingRequest?.isAdmin !== undefined;

  return (
    <div
      aria-label={`${account.displayName}のアカウント操作`}
      className="flex flex-wrap gap-2"
      role="group"
    >
      <AccountActionConfirm
        disabled={isPending}
        title={account.loginEnabled ? "ログインを停止しますか？" : "ログインを許可しますか？"}
        description={`${account.displayName} のログイン状態を変更します。変更後すぐに利用可否へ反映されます。`}
        label={account.loginEnabled ? "ログイン停止" : "ログイン許可"}
        confirmLabel={account.loginEnabled ? "停止する" : "許可する"}
        pending={loginPending}
        tone={account.loginEnabled ? "danger" : "primary"}
        onConfirm={() => onPatch({ loginEnabled: !account.loginEnabled })}
      />
      <AccountActionConfirm
        disabled={isPending}
        title={account.isAdmin ? "管理者権限を解除しますか？" : "管理者権限を付与しますか？"}
        description={`${account.displayName} の管理者権限を変更します。設定の変更や分析の管理を行える範囲が変わります。`}
        label={account.isAdmin ? "管理者解除" : "管理者にする"}
        confirmLabel={account.isAdmin ? "解除する" : "付与する"}
        pending={adminPending}
        tone={account.isAdmin ? "danger" : "primary"}
        onConfirm={() => onPatch({ isAdmin: !account.isAdmin })}
      />
    </div>
  );
}

function AccountActionConfirm({
  confirmLabel,
  description,
  disabled,
  label,
  onConfirm,
  pending = false,
  tone,
  title,
}: {
  confirmLabel: string;
  description: string;
  disabled: boolean;
  label: string;
  onConfirm: () => Promise<void> | void;
  pending?: boolean;
  tone: "danger" | "primary";
  title: string;
}) {
  return (
    <AlertDialog
      cancelLabel="キャンセル"
      confirmLabel={confirmLabel}
      pendingLabel="更新中…"
      description={description}
      pending={pending}
      formatError={(error) => formatApiError(error, "アカウント設定の更新に失敗しました")}
      tone={tone}
      title={title}
      trigger={
        <Button disabled={disabled} size="sm" variant="quiet">
          {label}
        </Button>
      }
      onConfirm={onConfirm}
    />
  );
}

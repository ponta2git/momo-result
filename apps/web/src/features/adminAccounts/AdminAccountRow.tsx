import type { LoginAccountResponse, UpdateLoginAccountRequest } from "@/shared/api/adminAccounts";
import { formatApiError } from "@/shared/api/problemDetails";
import { memberDisplayName } from "@/shared/domain/members";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { dataTableBodyCellClassName, DataTableBodyRow } from "@/shared/ui/data/DataTable";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { StatusBadge } from "@/shared/ui/status/StatusBadge";

export function AdminAccountRow({
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
    <DataTableBodyRow aria-busy={Boolean(pendingRequest) || undefined}>
      <th
        className={cn(
          dataTableBodyCellClassName,
          "sticky left-0 z-[var(--z-base)] bg-[var(--color-surface)] text-left font-semibold",
        )}
        scope="row"
      >
        {account.displayName}
      </th>
      <td className={cn(dataTableBodyCellClassName, "momo-data max-w-[14rem] truncate text-xs")}>
        {account.discordUserId}
      </td>
      <td className={dataTableBodyCellClassName}>{memberDisplayName(account.playerMemberId)}</td>
      <td className={dataTableBodyCellClassName}>
        <div className="flex flex-wrap gap-2">
          <StatusBadge label={account.isAdmin ? "管理者" : "一般"} tone="neutral" />
          <StatusBadge
            label={account.loginEnabled ? "ログイン許可" : "ログイン停止"}
            tone={account.loginEnabled ? "success" : "warning"}
          />
        </div>
      </td>
      <td className={dataTableBodyCellClassName}>
        <div className="flex flex-wrap gap-2">
          <AccountActionConfirm
            disabled={isPending}
            title={account.loginEnabled ? "ログインを停止しますか？" : "ログインを許可しますか？"}
            description={`${account.displayName} のログイン状態を変更します。変更後すぐに利用可否へ反映されます。`}
            label={account.loginEnabled ? "ログイン停止" : "ログイン許可"}
            confirmLabel={loginPending ? "更新中…" : account.loginEnabled ? "停止する" : "許可する"}
            pending={loginPending}
            tone={account.loginEnabled ? "danger" : "primary"}
            onConfirm={() => onPatch({ loginEnabled: !account.loginEnabled })}
          />
          <AccountActionConfirm
            disabled={isPending}
            title={account.isAdmin ? "管理者権限を解除しますか？" : "管理者権限を付与しますか？"}
            description={`${account.displayName} の管理者権限を変更します。設定管理とアカウント管理の操作範囲が変わります。`}
            label={account.isAdmin ? "管理者解除" : "管理者にする"}
            confirmLabel={adminPending ? "更新中…" : account.isAdmin ? "解除する" : "付与する"}
            pending={adminPending}
            tone={account.isAdmin ? "danger" : "primary"}
            onConfirm={() => onPatch({ isAdmin: !account.isAdmin })}
          />
        </div>
      </td>
    </DataTableBodyRow>
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

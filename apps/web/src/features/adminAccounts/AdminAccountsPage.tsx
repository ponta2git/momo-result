import { ShieldCheck } from "lucide-react";
import { useFormStatus } from "react-dom";

import { useAdminAccountsPageController } from "@/features/adminAccounts/useAdminAccountsPageController";
import type { LoginAccountResponse, UpdateLoginAccountRequest } from "@/shared/api/adminAccounts";
import { formatApiError } from "@/shared/api/problemDetails";
import { fixedMembers, memberDisplayName } from "@/shared/domain/members";
import { Button } from "@/shared/ui/actions/Button";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { checkboxInputClass, checkboxLabelClass } from "@/shared/ui/forms/controlStyles";
import { Fieldset } from "@/shared/ui/forms/Fieldset";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { TextField } from "@/shared/ui/forms/TextField";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

export function AdminAccountsPage() {
  const {
    accounts,
    accountsError,
    accountsLoadFailed,
    accountsLoading,
    accountsRefreshing,
    createAction,
    createState,
    retryAccounts,
    updateMutation,
  } = useAdminAccountsPageController();

  return (
    <PageFrame className="gap-4">
      <PageHeader
        eyebrow="管理"
        title="ログインアカウント"
        description="Discordでログインできるアカウントと管理者権限を管理します。試合参加者とは別に扱います。"
      />

      {createState.error ? (
        <Notice tone="danger" title="アカウントを追加できません">
          {createState.error}
        </Notice>
      ) : null}

      <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <ShieldCheck className="size-5" />
          アカウントを追加
        </h2>
        <form
          key={createState.version}
          action={createAction}
          className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_16rem_auto]"
        >
          <TextField
            inputMode="numeric"
            label="DiscordユーザーID"
            name="discordUserId"
            placeholder="例: 523484457705930752"
            required
          />
          <TextField label="表示名" name="displayName" placeholder="例: 代理入力者" required />
          <SelectField
            defaultValue=""
            label="紐づくプレーヤー"
            name="playerMemberId"
            options={[
              { label: "試合参加者に紐づけない", value: "" },
              ...fixedMembers.map((member) => ({
                label: member.displayName,
                value: member.memberId,
              })),
            ]}
          />
          <Fieldset legend="権限">
            <label className={checkboxLabelClass}>
              <input
                className={checkboxInputClass}
                defaultChecked
                name="loginEnabled"
                type="checkbox"
              />
              ログイン許可
            </label>
            <label className={checkboxLabelClass}>
              <input className={checkboxInputClass} name="isAdmin" type="checkbox" />
              管理者
            </label>
          </Fieldset>
          <div className="flex items-end">
            <CreateAccountSubmitButton />
          </div>
        </form>
      </section>

      <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        {accountsLoading ? (
          <div className="grid gap-3 p-4" aria-label="ログインアカウントを読み込み中">
            <Skeleton className="min-h-10" />
            <Skeleton className="min-h-16" />
            <Skeleton className="min-h-16" />
          </div>
        ) : accountsLoadFailed ? (
          <div className="p-4">
            <Notice tone="danger" title={accountsError?.title ?? "アカウントを読み込めません"}>
              <p>{accountsError?.detail ?? "通信状態を確認して、もう一度お試しください。"}</p>
              <div className="mt-3">
                <Button
                  pending={accountsRefreshing}
                  pendingLabel="再読み込み中"
                  size="sm"
                  variant="secondary"
                  onClick={retryAccounts}
                >
                  アカウントを再読み込み
                </Button>
              </div>
            </Notice>
          </div>
        ) : accounts.length === 0 ? (
          <EmptyState
            className="border-0"
            description="DiscordユーザーIDと表示名を入力し、最初のアカウントを追加します。"
            icon={<ShieldCheck className="size-5" />}
            title="ログイン可能なアカウントはまだありません"
          />
        ) : (
          <div className="grid">
            {accountsError ? (
              <Notice
                className="m-4 mb-0"
                tone="warning"
                title="最新のアカウント情報を取得できません"
              >
                <p>直前に取得した内容を表示しています。</p>
                <div className="mt-3">
                  <Button
                    pending={accountsRefreshing}
                    pendingLabel="再読み込み中"
                    size="sm"
                    variant="secondary"
                    onClick={retryAccounts}
                  >
                    最新情報を再読み込み
                  </Button>
                </div>
              </Notice>
            ) : null}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-left text-sm">
                <thead className="bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]">
                  <tr>
                    <th className="px-3 py-2">表示名</th>
                    <th className="px-3 py-2">DiscordユーザーID</th>
                    <th className="px-3 py-2">プレーヤー</th>
                    <th className="px-3 py-2">権限</th>
                    <th className="px-3 py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account) => {
                    const rowPending =
                      updateMutation.isPending &&
                      updateMutation.variables?.accountId === account.accountId;
                    return (
                      <AccountRow
                        account={account}
                        isPending={updateMutation.isPending}
                        key={account.accountId}
                        pendingRequest={rowPending ? updateMutation.variables?.request : undefined}
                        onPatch={async (request) => {
                          await updateMutation.mutateAsync({
                            accountId: account.accountId,
                            request,
                          });
                        }}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </PageFrame>
  );
}

function CreateAccountSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button pending={pending} pendingLabel="追加中" type="submit">
      追加
    </Button>
  );
}

function AccountRow({
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
    <tr
      aria-busy={Boolean(pendingRequest) || undefined}
      className="border-t border-[var(--color-border)]"
    >
      <td className="px-3 py-2 font-semibold">{account.displayName}</td>
      <td className="momo-data max-w-[14rem] truncate px-3 py-2 text-xs">
        {account.discordUserId}
      </td>
      <td className="px-3 py-2">{memberDisplayName(account.playerMemberId)}</td>
      <td className="px-3 py-2">
        {account.isAdmin ? "管理者" : "一般"} / {account.loginEnabled ? "許可" : "停止"}
      </td>
      <td className="flex flex-wrap gap-2 px-3 py-2">
        <AccountActionConfirm
          disabled={isPending}
          title={account.loginEnabled ? "ログインを停止しますか？" : "ログインを許可しますか？"}
          description={`${account.displayName} のログイン状態を変更します。変更後すぐに利用可否へ反映されます。`}
          label={account.loginEnabled ? "ログイン停止" : "ログイン許可"}
          confirmLabel={loginPending ? "更新中…" : account.loginEnabled ? "停止する" : "許可する"}
          pending={loginPending}
          onConfirm={() => onPatch({ loginEnabled: !account.loginEnabled })}
        />
        <AccountActionConfirm
          disabled={isPending}
          title={account.isAdmin ? "管理者権限を解除しますか？" : "管理者権限を付与しますか？"}
          description={`${account.displayName} の管理者権限を変更します。設定管理とアカウント管理の操作範囲が変わります。`}
          label={account.isAdmin ? "管理者解除" : "管理者にする"}
          confirmLabel={adminPending ? "更新中…" : account.isAdmin ? "解除する" : "付与する"}
          pending={adminPending}
          onConfirm={() => onPatch({ isAdmin: !account.isAdmin })}
        />
      </td>
    </tr>
  );
}

function AccountActionConfirm({
  confirmLabel,
  description,
  disabled,
  label,
  onConfirm,
  pending = false,
  title,
}: {
  confirmLabel: string;
  description: string;
  disabled: boolean;
  label: string;
  onConfirm: () => Promise<void> | void;
  pending?: boolean;
  title: string;
}) {
  return (
    <AlertDialog
      cancelLabel="キャンセル"
      confirmLabel={confirmLabel}
      description={description}
      pending={pending}
      formatError={(error) => formatApiError(error, "アカウント設定の更新に失敗しました")}
      tone="primary"
      title={title}
      trigger={
        <Button disabled={disabled} size="sm" variant="secondary">
          {label}
        </Button>
      }
      onConfirm={onConfirm}
    />
  );
}

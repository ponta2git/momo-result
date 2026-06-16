import { ShieldCheck } from "lucide-react";
import { useFormStatus } from "react-dom";

import { useAdminAccountsPageController } from "@/features/adminAccounts/useAdminAccountsPageController";
import type { LoginAccountResponse, UpdateLoginAccountRequest } from "@/shared/api/adminAccounts";
import { fixedMembers, memberDisplayName } from "@/shared/domain/members";
import { Button } from "@/shared/ui/actions/Button";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { Field } from "@/shared/ui/forms/Field";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

const inputClass =
  "w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)]";

export function AdminAccountsPage() {
  const { accounts, accountsLoading, createAction, createState, normalizedError, updateMutation } =
    useAdminAccountsPageController();

  return (
    <PageFrame className="gap-5">
      <PageHeader
        eyebrow="管理"
        title="ログインアカウント"
        description="Discordでログインできるアカウントと管理者権限を管理します。試合参加者とは別に扱います。"
      />

      {createState.error || normalizedError ? (
        <Notice tone="danger" title={normalizedError?.title ?? "操作に失敗しました"}>
          {createState.error || normalizedError?.detail}
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
          <Field label="DiscordユーザーID">
            <input
              className={inputClass}
              inputMode="numeric"
              name="discordUserId"
              placeholder="例: 523484457705930752"
              required
            />
          </Field>
          <Field label="表示名">
            <input
              className={inputClass}
              name="displayName"
              placeholder="例: 代理入力者"
              required
            />
          </Field>
          <Field label="紐づくプレーヤー">
            <select className={inputClass} name="playerMemberId" defaultValue="">
              <option value="">試合参加者に紐づけない</option>
              {fixedMembers.map((member) => (
                <option key={member.memberId} value={member.memberId}>
                  {member.displayName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="権限">
            <div className="flex min-h-10 flex-wrap items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
              <label className="inline-flex items-center gap-2 text-sm">
                <input defaultChecked name="loginEnabled" type="checkbox" />
                ログイン許可
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input name="isAdmin" type="checkbox" />
                管理者
              </label>
            </div>
          </Field>
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
        ) : accounts.length === 0 ? (
          <EmptyState
            className="border-0"
            description="DiscordユーザーIDと表示名を入力し、最初のアカウントを追加します。"
            icon={<ShieldCheck className="size-5" />}
            title="ログイン可能なアカウントはまだありません"
          />
        ) : (
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

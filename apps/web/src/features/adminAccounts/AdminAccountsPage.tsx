import { ShieldCheck } from "lucide-react";
import { useFormStatus } from "react-dom";

import { useAdminAccountsPageController } from "@/features/adminAccounts/useAdminAccountsPageController";
import type { LoginAccountResponse, UpdateLoginAccountRequest } from "@/shared/api/adminAccounts";
import { fixedMembers, memberDisplayName } from "@/shared/domain/members";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Field } from "@/shared/ui/forms/Field";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

const inputClass =
  "w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)]";

export function AdminAccountsPage() {
  const { accounts, createAction, createState, normalizedError, updateMutation } =
    useAdminAccountsPageController();

  return (
    <PageFrame className="gap-5">
      <PageHeader
        eyebrow="管理"
        title="ログインアカウント管理"
        description="Discordでログインできるアカウントと管理者権限を管理します。試合参加者とは別に設定できます。"
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

      <section className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
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
            {accounts.map((account) => (
              <AccountRow
                account={account}
                isPending={updateMutation.isPending}
                key={account.accountId}
                onPatch={(request) =>
                  updateMutation.mutate({ accountId: account.accountId, request })
                }
              />
            ))}
          </tbody>
        </table>
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
}: {
  account: LoginAccountResponse;
  isPending: boolean;
  onPatch: (request: UpdateLoginAccountRequest) => void;
}) {
  return (
    <tr className="border-t border-[var(--color-border)]">
      <td className="px-3 py-2 font-semibold">{account.displayName}</td>
      <td className="max-w-[14rem] truncate px-3 py-2 font-mono text-xs">
        {account.discordUserId}
      </td>
      <td className="px-3 py-2">{memberDisplayName(account.playerMemberId)}</td>
      <td className="px-3 py-2">
        {account.isAdmin ? "管理者" : "一般"} / {account.loginEnabled ? "許可" : "停止"}
      </td>
      <td className="flex flex-wrap gap-2 px-3 py-2">
        <Button
          disabled={isPending}
          onClick={() => onPatch({ loginEnabled: !account.loginEnabled })}
          size="sm"
          variant="secondary"
        >
          {account.loginEnabled ? "ログイン停止" : "ログイン許可"}
        </Button>
        <Button
          disabled={isPending}
          onClick={() => onPatch({ isAdmin: !account.isAdmin })}
          size="sm"
          variant="secondary"
        >
          {account.isAdmin ? "管理者解除" : "管理者にする"}
        </Button>
      </td>
    </tr>
  );
}

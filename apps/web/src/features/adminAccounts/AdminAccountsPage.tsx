import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";

import { fixedMembers } from "@/features/auth/members";
import { createLoginAccount, listLoginAccounts, updateLoginAccount } from "@/shared/api/client";
import type {
  CreateLoginAccountRequest,
  LoginAccountResponse,
  UpdateLoginAccountRequest,
} from "@/shared/api/client";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Field } from "@/shared/ui/forms/Field";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

const queryKey = ["admin", "login-accounts"] as const;
const blankForm: CreateLoginAccountRequest = {
  discordUserId: "",
  displayName: "",
  loginEnabled: true,
  isAdmin: false,
};

const inputClass =
  "w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)]";

function memberName(memberId: string | undefined): string {
  if (!memberId) return "操作専用";
  return fixedMembers.find((member) => member.memberId === memberId)?.displayName ?? memberId;
}

export function AdminAccountsPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateLoginAccountRequest>(blankForm);

  const accountsQuery = useQuery({
    queryKey,
    queryFn: listLoginAccounts,
  });

  const createMutation = useMutation({
    mutationFn: (request: CreateLoginAccountRequest) => createLoginAccount(request),
    onSuccess: async () => {
      setForm(blankForm);
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      accountId,
      request,
    }: {
      accountId: string;
      request: UpdateLoginAccountRequest;
    }) => updateLoginAccount(accountId, request),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  const error = createMutation.error ?? updateMutation.error ?? accountsQuery.error;
  const normalizedError = error ? normalizeUnknownApiError(error) : undefined;
  const accounts = accountsQuery.data?.items ?? [];

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="Admin"
        title="ログインアカウント管理"
        description="Discordログインできる操作アカウントと管理者権限を管理します。試合参加者とは別の権限です。"
      />

      {normalizedError ? (
        <Notice tone="danger" title={normalizedError.title}>
          {normalizedError.detail}
        </Notice>
      ) : null}

      <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <ShieldCheck className="size-5" />
          新規アカウント
        </h2>
        <form
          className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            createMutation.mutate(form);
          }}
        >
          <Field label="Discord User ID">
            <input
              className={inputClass}
              inputMode="numeric"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  discordUserId: event.target.value,
                }))
              }
              placeholder="例: 523484457705930752"
              required
              value={form.discordUserId}
            />
          </Field>
          <Field label="表示名">
            <input
              className={inputClass}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  displayName: event.target.value,
                }))
              }
              placeholder="例: 代理入力者"
              required
              value={form.displayName}
            />
          </Field>
          <Field label="紐づくプレイヤー">
            <select
              className={inputClass}
              onChange={(event) =>
                setForm((current) => {
                  const { playerMemberId: _playerMemberId, ...rest } = current;
                  return event.target.value
                    ? { ...rest, playerMemberId: event.target.value }
                    : rest;
                })
              }
              value={form.playerMemberId ?? ""}
            >
              <option value="">操作専用</option>
              {fixedMembers.map((member) => (
                <option key={member.memberId} value={member.memberId}>
                  {member.displayName}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex flex-wrap items-end gap-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                checked={form.loginEnabled}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    loginEnabled: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              ログイン許可
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                checked={form.isAdmin}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    isAdmin: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              管理者
            </label>
            <Button pending={createMutation.isPending} pendingLabel="追加中" type="submit">
              追加
            </Button>
          </div>
        </form>
      </section>

      <section className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]">
            <tr>
              <th className="px-3 py-2">表示名</th>
              <th className="px-3 py-2">Discord ID</th>
              <th className="px-3 py-2">プレイヤー</th>
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
    </div>
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
      <td className="px-3 py-2 font-mono text-xs">{account.discordUserId}</td>
      <td className="px-3 py-2">{memberName(account.playerMemberId)}</td>
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

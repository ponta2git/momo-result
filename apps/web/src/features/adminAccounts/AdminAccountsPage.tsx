import { ShieldCheck, UserPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AdminAccountCreateDialog } from "@/features/adminAccounts/AdminAccountCreateDialog";
import { AdminAccountRow } from "@/features/adminAccounts/AdminAccountRow";
import { useAdminAccountsPageController } from "@/features/adminAccounts/useAdminAccountsPageController";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { dataTableHeaderCellClassName } from "@/shared/ui/data/DataTable";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

export function AdminAccountsPage() {
  const {
    accounts,
    accountsError,
    accountsLoadFailed,
    accountsLoading,
    accountsRefreshing,
    accountsStale,
    createAction,
    createPending,
    createState,
    retryAccounts,
    updateMutation,
  } = useAdminAccountsPageController();
  const [createOpen, setCreateOpen] = useState(false);
  const createTriggerRef = useRef<HTMLButtonElement>(null);
  const focusCreateTriggerAfterSuccessRef = useRef(false);
  const previousCreateVersion = useRef(createState.version);

  useEffect(() => {
    if (createState.version !== previousCreateVersion.current) {
      previousCreateVersion.current = createState.version;
      focusCreateTriggerAfterSuccessRef.current = true;
      setCreateOpen(false);
    }
  }, [createState.version]);

  const hasAccounts = accounts.length > 0;

  useEffect(() => {
    if (!createOpen && hasAccounts && focusCreateTriggerAfterSuccessRef.current) {
      focusCreateTriggerAfterSuccessRef.current = false;
      createTriggerRef.current?.focus();
    }
  }, [createOpen, hasAccounts]);

  return (
    <PageFrame>
      <PageHeader
        eyebrow="管理"
        title="ログインアカウント"
        description="Discordでログインできるアカウントと管理者権限を管理します。試合参加者とは別に扱います。"
        actions={
          hasAccounts ? (
            <Button
              ref={createTriggerRef}
              icon={<UserPlus aria-hidden="true" className="size-4" />}
              variant="secondary"
              onClick={() => setCreateOpen(true)}
            >
              アカウントを追加
            </Button>
          ) : null
        }
      />

      <PageContentSurface aria-label="ログインアカウント一覧" className="grid gap-4" role="region">
        {accountsLoading ? (
          <div className="grid gap-3" aria-label="ログインアカウントを読み込み中">
            <Skeleton className="min-h-10" />
            <Skeleton className="min-h-16" />
            <Skeleton className="min-h-16" />
          </div>
        ) : accountsLoadFailed ? (
          <Notice tone="danger" title={accountsError?.title ?? "アカウントを読み込めません"}>
            <p>{accountsError?.detail ?? "通信状態を確認して、もう一度お試しください。"}</p>
            <div className="mt-3">
              <Button
                pending={accountsRefreshing}
                pendingLabel="再読み込み中"
                size="sm"
                onClick={retryAccounts}
              >
                アカウントを再読み込み
              </Button>
            </div>
          </Notice>
        ) : (
          <div className="grid gap-4">
            {accountsStale ? (
              <Notice tone="warning" title="最新のアカウント情報を取得できません">
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
            {accounts.length === 0 ? (
              <EmptyState
                action={
                  <Button
                    icon={<UserPlus aria-hidden="true" className="size-4" />}
                    onClick={() => setCreateOpen(true)}
                  >
                    {accountsStale ? "アカウントを追加" : "最初のアカウントを追加"}
                  </Button>
                }
                description="利用を許可するDiscordアカウントを登録します。"
                icon={<ShieldCheck className="size-5" />}
                placement="embedded"
                title={
                  accountsStale
                    ? "前回取得時点ではログイン可能なアカウントがありません"
                    : "ログイン可能なアカウントはまだありません"
                }
              />
            ) : (
              <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]">
                <p className="border-b border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-secondary)] md:hidden">
                  権限と操作は横にスクロールして確認できます。
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[44rem] text-left text-sm">
                    <caption className="sr-only">ログイン可能なアカウントと権限</caption>
                    <thead>
                      <tr>
                        <th
                          className={cn(
                            dataTableHeaderCellClassName,
                            "sticky left-0 z-[var(--z-base)]",
                          )}
                        >
                          表示名
                        </th>
                        <th className={dataTableHeaderCellClassName}>DiscordユーザーID</th>
                        <th className={dataTableHeaderCellClassName}>プレーヤー</th>
                        <th className={dataTableHeaderCellClassName}>権限</th>
                        <th className={dataTableHeaderCellClassName}>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accounts.map((account) => {
                        const rowPending =
                          updateMutation.isPending &&
                          updateMutation.variables?.accountId === account.accountId;
                        return (
                          <AdminAccountRow
                            account={account}
                            isPending={updateMutation.isPending}
                            key={account.accountId}
                            pendingRequest={
                              rowPending ? updateMutation.variables?.request : undefined
                            }
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
          </div>
        )}
      </PageContentSurface>

      <AdminAccountCreateDialog
        action={createAction}
        error={createState.error}
        formKey={createState.version}
        open={createOpen}
        pending={createPending}
        onOpenChange={setCreateOpen}
      />
    </PageFrame>
  );
}

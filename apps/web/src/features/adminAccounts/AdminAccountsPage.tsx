import { ShieldCheck, UserPlus } from "lucide-react";

import { AdminAccountCreateDialog } from "@/features/adminAccounts/AdminAccountCreateDialog";
import { AdminAccountRow } from "@/features/adminAccounts/AdminAccountRow";
import { useAdminAccountsPageModel } from "@/features/adminAccounts/useAdminAccountsPageModel";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import {
  dataTableHeaderCellClassName,
  dataTableScrollAreaClassName,
} from "@/shared/ui/data/DataTable";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

export function AdminAccountsPage() {
  const page = useAdminAccountsPageModel();
  const hasAccounts = page.list.kind === "ready" && page.list.items.length > 0;

  return (
    <PageFrame>
      <PageHeader
        eyebrow="管理"
        title="ログインアカウント"
        description="Discordでログインできるアカウントと管理者権限を管理します。試合参加者とは別に扱います。"
        actions={
          hasAccounts ? (
            <Button
              ref={page.create.triggerRef}
              icon={<UserPlus aria-hidden="true" className="size-4" />}
              variant="secondary"
              onClick={page.create.open}
            >
              アカウントを追加
            </Button>
          ) : null
        }
      />

      <PageContentSurface aria-label="ログインアカウント一覧" className="grid gap-4" role="region">
        {page.list.kind === "loading" ? (
          <div className="grid gap-3" aria-label="ログインアカウントを読み込み中">
            <Skeleton className="min-h-10" />
            <Skeleton className="min-h-16" />
            <Skeleton className="min-h-16" />
          </div>
        ) : page.list.kind === "loadFailed" ? (
          <Notice tone="danger" title={page.list.error?.title ?? "アカウントを読み込めません"}>
            <p>{page.list.error?.detail ?? "通信状態を確認して、もう一度お試しください。"}</p>
            <div className="mt-3">
              <Button
                pending={page.list.refresh.pending}
                pendingLabel="再読み込み中"
                size="sm"
                onClick={page.list.refresh.run}
              >
                アカウントを再読み込み
              </Button>
            </div>
          </Notice>
        ) : (
          <div className="grid gap-4">
            {page.list.stale ? (
              <Notice tone="warning" title="最新のアカウント情報を取得できません">
                <p>直前に取得した内容を表示しています。</p>
                <div className="mt-3">
                  <Button
                    pending={page.list.refresh.pending}
                    pendingLabel="再読み込み中"
                    size="sm"
                    variant="secondary"
                    onClick={page.list.refresh.run}
                  >
                    最新情報を再読み込み
                  </Button>
                </div>
              </Notice>
            ) : null}
            {page.list.items.length === 0 ? (
              <EmptyState
                action={
                  <Button
                    icon={<UserPlus aria-hidden="true" className="size-4" />}
                    onClick={page.create.open}
                  >
                    {page.list.stale ? "アカウントを追加" : "最初のアカウントを追加"}
                  </Button>
                }
                description="利用を許可するDiscordアカウントを登録します。"
                icon={<ShieldCheck className="size-5" />}
                placement="embedded"
                title={
                  page.list.stale
                    ? "前回取得時点ではログイン可能なアカウントがありません"
                    : "ログイン可能なアカウントはまだありません"
                }
              />
            ) : (
              <div className="min-w-0">
                <p className="border-y border-[var(--color-border-strong)] px-3 py-2 text-xs text-[var(--color-text-secondary)] md:hidden">
                  権限と操作は横にスクロールして確認できます。
                </p>
                <div className={dataTableScrollAreaClassName}>
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
                      {page.list.items.map((account) => {
                        const pendingRequest = page.update.pendingRequestFor(account.accountId);
                        return (
                          <AdminAccountRow
                            account={account}
                            isPending={page.update.pending}
                            key={account.accountId}
                            pendingRequest={pendingRequest}
                            onPatch={(request) => page.update.run(account.accountId, request)}
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

      <AdminAccountCreateDialog model={page.create.dialog} />
    </PageFrame>
  );
}

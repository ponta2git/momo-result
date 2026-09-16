import { useRef } from "react";

import { AdminAccountCreateDialog } from "@/features/masters/accounts/AdminAccountCreateDialog";
import { AdminAccountRow } from "@/features/masters/accounts/AdminAccountRow";
import type { AccountSettingsModel } from "@/features/masters/accounts/useAccountSettingsModel";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import {
  dataTableHeaderCellClassName,
  dataTableScrollAreaClassName,
} from "@/shared/ui/data/DataTable";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { ContentWithActions } from "@/shared/ui/layout/ContentWithActions";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText } from "@/shared/ui/typography";

export function AccountSettingsPanel({ model: page }: { model: AccountSettingsModel }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const refresh = page.list.kind === "loading" ? undefined : page.list.refresh;
  const retryButton = (
    <Button
      pending={refresh?.pending ?? false}
      pendingLabel="再読み込み中"
      size="sm"
      variant="secondary"
      onClick={async () => {
        if (await refresh?.run()) headingRef.current?.focus();
      }}
    >
      再読み込み
    </Button>
  );

  return (
    <section aria-label="アカウント設定" className="grid min-w-0 gap-4">
      <ContentWithActions
        actions={
          <AdminAccountCreateDialog
            disabled={page.list.kind !== "ready" || page.pending}
            model={page.create}
          />
        }
      >
        <header className="grid gap-1">
          <h2 className={contentText.heading} ref={headingRef} tabIndex={-1}>
            ログインと権限
          </h2>
          <p className={cn(contentText.body, readableTextWidthClass)}>
            Discordアカウントのログイン許可と管理者権限を設定します。
          </p>
        </header>
      </ContentWithActions>
      {page.list.kind === "loading" ? (
        <div className="grid gap-4" aria-label="アカウントを読み込み中" role="status">
          <Skeleton className="min-h-10" />
          <Skeleton className="min-h-16" />
          <Skeleton className="min-h-16" />
        </div>
      ) : page.list.kind === "loadFailed" ? (
        <Notice
          action={retryButton}
          tone="danger"
          title={page.list.error?.title ?? "アカウントを読み込めません"}
        >
          <p>{page.list.error?.detail ?? "通信状態を確認して、もう一度お試しください。"}</p>
        </Notice>
      ) : (
        <div className="grid gap-4">
          {page.list.stale ? (
            <Notice
              action={retryButton}
              tone="warning"
              title="最新のアカウント情報を取得できません"
            >
              <p>直前に取得した内容を表示しています。</p>
            </Notice>
          ) : null}
          {page.list.items.length === 0 ? (
            <EmptyState
              description="利用を許可するDiscordアカウントを登録します。"
              placement="embedded"
              title={
                page.list.stale
                  ? "前回取得時点では登録されたアカウントがありません"
                  : "登録されたアカウントはありません"
              }
            />
          ) : (
            <div className="min-w-0">
              <p className={cn(contentText.supporting, "px-3 py-2 md:hidden")}>
                権限と操作は横にスクロールして確認できます。
              </p>
              <div className={dataTableScrollAreaClassName}>
                <table className={cn(contentText.body, "w-full min-w-[44rem] text-left")}>
                  <caption className="sr-only">登録アカウントとログイン・管理者権限</caption>
                  <colgroup>
                    <col />
                    <col className="w-56" />
                    <col />
                    <col />
                    <col />
                  </colgroup>
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
                          isPending={page.pending}
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
    </section>
  );
}

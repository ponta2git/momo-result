import { useRef } from "react";

import { AdminAccountActions } from "@/features/masters/accounts/AdminAccountActions";
import { AdminAccountCreateDialog } from "@/features/masters/accounts/AdminAccountCreateDialog";
import type { AccountSettingsModel } from "@/features/masters/accounts/useAccountSettingsModel";
import { memberDisplayName } from "@/shared/domain/members";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { DataTable } from "@/shared/ui/data/DataTable";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { ContentWithActions } from "@/shared/ui/layout/ContentWithActions";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { StatusBadge } from "@/shared/ui/status/StatusBadge";
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
            <DataTable
              caption={{ content: "登録アカウントとログイン・管理者権限" }}
              columns={[
                {
                  key: "name",
                  header: "表示名",
                  rowHeader: true,
                  renderCell: (account) => account.displayName,
                },
                {
                  key: "discord",
                  header: "DiscordユーザーID",
                  width: "14rem",
                  renderCell: (account) => (
                    <span className={cn(contentText.supporting, "momo-data")}>
                      {account.discordUserId}
                    </span>
                  ),
                },
                {
                  key: "player",
                  header: "プレーヤー",
                  renderCell: (account) => memberDisplayName(account.playerMemberId),
                },
                {
                  key: "permissions",
                  header: "権限",
                  renderCell: (account) => (
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge label={account.isAdmin ? "管理者" : "一般"} tone="neutral" />
                      <StatusBadge
                        label={account.loginEnabled ? "ログイン許可" : "ログイン停止"}
                        tone={account.loginEnabled ? "success" : "warning"}
                      />
                    </div>
                  ),
                },
                {
                  key: "actions",
                  header: "操作",
                  renderCell: (account) => (
                    <AdminAccountActions
                      account={account}
                      isPending={page.pending}
                      pendingRequest={page.update.pendingRequestFor(account.accountId)}
                      onPatch={(request) => page.update.run(account.accountId, request)}
                    />
                  ),
                },
              ]}
              density="compact"
              getRowKey={(account) => account.accountId}
              isRowBusy={(account) => Boolean(page.update.pendingRequestFor(account.accountId))}
              minWidth="44rem"
              rows={page.list.items}
              stickyRowHeader
            />
          )}
        </div>
      )}
    </section>
  );
}

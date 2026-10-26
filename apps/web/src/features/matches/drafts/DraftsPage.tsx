import { PenSquare, RefreshCw, ScanLine } from "lucide-react";

import type { DraftItemView } from "@/features/matches/drafts/draftsTypes";
import type { DraftsListView } from "@/features/matches/drafts/useDraftsList";
import { useDraftsList } from "@/features/matches/drafts/useDraftsList";
import { formatDateTimeCompact } from "@/shared/lib/dateTime";
import { useMediaQuery } from "@/shared/lib/useMediaQuery";
import { DraftStatusBadge } from "@/shared/matches/DraftStatusBadge";
import { inlineActionGroupClass } from "@/shared/ui/actions/actionGroup";
import { Button } from "@/shared/ui/actions/Button";
import { IconButton } from "@/shared/ui/actions/IconButton";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { DataTable } from "@/shared/ui/data/DataTable";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { contentText } from "@/shared/ui/typography";

type RowActionsProps = {
  item: DraftItemView;
  navigation: DraftsListView["navigation"];
  remove: DraftsListView["remove"];
};

function DraftRowActions({ item, navigation, remove }: RowActionsProps) {
  const action = item.primaryAction;
  const checking = navigation.checkingIds.has(item.matchDraftId);
  const error = navigation.errors[item.matchDraftId];
  return (
    <div className="grid justify-items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {action ? (
          <Button
            pending={checking}
            pendingLabel="確認中…"
            size="sm"
            variant={action.variant ?? "primary"}
            onClick={() => navigation.run(action)}
          >
            {action.label}
          </Button>
        ) : null}
        {item.removal ? (
          <AlertDialog
            confirmLabel={item.removal.confirmLabel}
            description={`${item.title}（${item.heldAtLabel}）の下書きを取り消します。元に戻せません。`}
            pendingLabel="処理中…"
            title={item.removal.title}
            trigger={
              <Button disabled={checking} size="sm" variant="dangerQuiet">
                {item.removal.label}
              </Button>
            }
            onConfirm={() => remove(item.matchDraftId)}
          />
        ) : null}
      </div>
      {error ? (
        <p className="text-xs text-[var(--color-danger)]" role="alert">
          {error} 同じボタンから再試行できます。
        </p>
      ) : null}
    </div>
  );
}

function DraftIdentity({ item }: { item: DraftItemView }) {
  return (
    <div className="grid gap-1">
      <span className={contentText.body}>{item.title}</span>
      <span className={cn(contentText.supporting, "tabular-nums")}>{item.heldAtLabel}</span>
    </div>
  );
}

function DraftGroupRows({
  items,
  navigation,
  remove,
  showTable,
  title,
}: {
  items: DraftItemView[];
  showTable: boolean;
  title: string;
} & Omit<RowActionsProps, "item">) {
  if (showTable) {
    return (
      <DataTable
        caption={{ content: title }}
        columns={[
          {
            header: "下書き",
            key: "draft",
            renderCell: (item) => <DraftIdentity item={item} />,
            rowHeader: true,
          },
          {
            header: "状態",
            key: "status",
            renderCell: (item) => <DraftStatusBadge status={item.status} />,
            width: "9rem",
          },
          {
            header: "更新",
            key: "updated",
            renderCell: (item) => (
              <span className={cn(contentText.supporting, "tabular-nums")}>
                {formatDateTimeCompact(item.updatedAt)}
              </span>
            ),
            width: "8rem",
          },
          {
            align: "right",
            header: "操作",
            key: "actions",
            renderCell: (item) => (
              <DraftRowActions item={item} navigation={navigation} remove={remove} />
            ),
            width: "17rem",
          },
        ]}
        getRowKey={(item) => item.id}
        layout="fixed"
        minWidth="48rem"
        rows={items}
        verticalAlign="middle"
      />
    );
  }
  return (
    <ul
      aria-label={title}
      className="border-t border-[var(--color-border)]"
      // oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Safari needs an explicit list role when Preflight removes markers.
      role="list"
    >
      {items.map((item) => (
        <li key={item.id} className="grid gap-2 border-b border-[var(--color-border)] py-3">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <DraftIdentity item={item} />
            <DraftStatusBadge status={item.status} />
          </div>
          <DraftRowActions item={item} navigation={navigation} remove={remove} />
        </li>
      ))}
    </ul>
  );
}

export function DraftsPage() {
  const showTable = useMediaQuery("(min-width: 1024px)");
  const { groups, loadFailed, loading, navigation, refresh, remove, totalItems, truncated } =
    useDraftsList();

  return (
    <PageFrame>
      <PageContentSurface aria-label="確定前の下書き" className="grid gap-6" role="region">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <p className={cn(contentText.compactPrimary, "tabular-nums")}>
            {totalItems === undefined
              ? "確定前の下書き"
              : `確定前の下書き ${totalItems.toLocaleString()}件`}
          </p>
          <div className={cn(inlineActionGroupClass, "items-center justify-end")}>
            <IconButton
              aria-label="最新情報に更新"
              disabled={loading || refresh.pending}
              icon={<RefreshCw />}
              pending={refresh.pending}
              pendingLabel="一覧を更新中"
              tooltip={refresh.pending ? "更新中…" : "最新情報に更新"}
              variant="quiet"
              onClick={refresh.run}
            />
            <div aria-label="試合を登録" className={inlineActionGroupClass} role="group">
              <LinkButton
                icon={<ScanLine aria-hidden="true" />}
                size="sm"
                to="/ocr/new"
                variant="secondary"
              >
                OCR取り込み
              </LinkButton>
              <LinkButton
                icon={<PenSquare aria-hidden="true" />}
                size="sm"
                to="/matches/new"
                variant="secondary"
              >
                手入力で作成
              </LinkButton>
            </div>
          </div>
        </div>

        {refresh.refreshFailed ? (
          <Notice title="下書きを更新できませんでした" tone="warning">
            <p>取得済みの下書きは表示したままです。通信状態を確認して更新してください。</p>
          </Notice>
        ) : null}

        {loading ? (
          <div aria-label="下書きを読み込み中" className="grid gap-3" role="status">
            <span className="sr-only">下書きを読み込み中</span>
            {["d1", "d2", "d3"].map((id) => (
              <Skeleton key={id} className="min-h-14" />
            ))}
          </div>
        ) : loadFailed ? (
          <Notice
            action={
              <Button size="sm" onClick={refresh.run}>
                下書きを再読み込み
              </Button>
            }
            tone="danger"
            title="下書きを読み込めません"
          >
            <p>通信状態を確認して、もう一度お試しください。</p>
          </Notice>
        ) : groups.length === 0 ? (
          <EmptyState
            action={
              <LinkButton to="/matches" variant="secondary">
                試合一覧へ
              </LinkButton>
            }
            description="確定前の下書きはありません。登録した試合は試合一覧で確認できます。"
            placement="embedded"
            title="下書きはありません"
          />
        ) : (
          <>
            {groups.map((group) => (
              <section
                key={group.key}
                aria-labelledby={`drafts-${group.key}`}
                className="grid gap-3"
              >
                <div className="grid gap-1">
                  <h2
                    className={cn(contentText.heading, "tabular-nums")}
                    id={`drafts-${group.key}`}
                  >
                    {group.title} {group.items.length.toLocaleString()}件
                  </h2>
                  <p className={contentText.supporting}>{group.note}</p>
                </div>
                <DraftGroupRows
                  items={group.items}
                  navigation={navigation}
                  remove={remove}
                  showTable={showTable}
                  title={group.title}
                />
              </section>
            ))}
            {truncated ? (
              <p className={contentText.supporting}>
                更新が新しい200件を表示しています。古い下書きは、新しい下書きを片付けると表示されます。
              </p>
            ) : null}
          </>
        )}
      </PageContentSurface>
    </PageFrame>
  );
}

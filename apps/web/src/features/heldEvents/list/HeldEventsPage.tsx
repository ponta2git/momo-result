import { CalendarDays, CalendarPlus, Filter, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";

import { CreateHeldEventDialog } from "@/features/heldEvents/list/CreateHeldEventDialog";
import { DeleteHeldEventDialog } from "@/features/heldEvents/list/DeleteHeldEventDialog";
import { describeHeldEventListConditions } from "@/features/heldEvents/list/heldEventListConditions";
import {
  HeldEventListCompactRows,
  HeldEventsTable,
} from "@/features/heldEvents/list/HeldEventListRows";
import { heldEventListPageSizeOptions } from "@/features/heldEvents/list/heldEventListSearchParams";
import { HeldEventListSearchSheet } from "@/features/heldEvents/list/HeldEventListSearchSheet";
import { HeldEventsFilterBar } from "@/features/heldEvents/list/HeldEventsFilterBar";
import { useHeldEvents } from "@/features/heldEvents/list/useHeldEvents";
import { useMediaQuery } from "@/shared/lib/useMediaQuery";
import { UnsavedChangesGuard } from "@/shared/navigation/UnsavedChangesGuard";
import { Button } from "@/shared/ui/actions/Button";
import { IconButton } from "@/shared/ui/actions/IconButton";
import { cn } from "@/shared/ui/cn";
import { PaginationControls } from "@/shared/ui/data/PaginationControls";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PendingStatus } from "@/shared/ui/feedback/PendingStatus";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { AppliedConditionChips } from "@/shared/ui/forms/AppliedConditionChips";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { StaleShield } from "@/shared/ui/motion/StaleShield";
import { contentText } from "@/shared/ui/typography";

/** Below the smallest page size every event fits on one page, so the count moves to the toolbar. */
const paginationThreshold = heldEventListPageSizeOptions[0];

function ListSkeleton({ showDesktopTable }: { showDesktopTable: boolean }) {
  return (
    <div aria-label="開催履歴を読み込み中" role="status">
      <span className="sr-only">開催履歴を読み込み中</span>
      <div className="grid gap-3 border-y border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3">
        {showDesktopTable ? <Skeleton className="min-h-10" /> : null}
        {["s1", "s2", "s3", "s4"].map((id) => (
          <Skeleton key={id} className={showDesktopTable ? "min-h-16" : "min-h-24"} />
        ))}
      </div>
    </div>
  );
}

export function HeldEventsPage() {
  const showDesktopTable = useMediaQuery("(min-width: 1024px)");
  const heldEvents = useHeldEvents();
  const { actionView, filters, list, refresh } = heldEvents;
  const [sheetOpen, setSheetOpen] = useState(false);
  const retryOwnsFeedback = list.loadFailed || list.stale;
  const listPending = refresh.pending || list.scopeChanging || list.sameScopeRefreshing;
  const toolbarPending = listPending && !list.loading && !retryOwnsFeedback;
  const allConditions = describeHeldEventListConditions(filters.candidates, filters.search, "all");
  const chipConditions = showDesktopTable
    ? describeHeldEventListConditions(filters.candidates, filters.search, "details")
    : allConditions;
  const totalItems = list.pagination?.value.totalItems;
  const showPagination = totalItems !== undefined && totalItems > paginationThreshold;
  const ready = !list.loading && !list.loadFailed;
  // An empty history offers creation in its empty state instead of the toolbar.
  const showCreate = ready && (list.rows.length > 0 || filters.hasConditions);
  const showNoteMatch = list.memoQuery !== "" || list.rows.some((row) => row.noteMatch);
  const removeCondition = (condition: (typeof allConditions)[number]["key"]) =>
    filters.actions.onChange({ kind: "removeCondition", condition });

  return (
    <PageFrame>
      <UnsavedChangesGuard
        model={heldEvents.navigationGuard}
        pending={actionView.dialogPending}
        showPendingDialog={false}
      />
      <PageContentSurface aria-label="開催履歴" className="grid gap-6" role="region">
        <div
          className={cn(
            "flex min-w-0 flex-wrap items-center gap-2",
            showDesktopTable ? "justify-end" : "justify-between",
          )}
        >
          <Button
            hidden={showDesktopTable}
            icon={<Filter aria-hidden="true" />}
            size="sm"
            variant="secondary"
            onClick={() => setSheetOpen(true)}
          >
            {allConditions.length > 0 ? `検索条件（${allConditions.length}）` : "検索条件"}
          </Button>
          {showCreate ? (
            <Button
              icon={<CalendarPlus aria-hidden="true" />}
              size="sm"
              variant="secondary"
              onClick={heldEvents.openCreate}
            >
              開催を作成
            </Button>
          ) : null}
        </div>

        {actionView.errorMessage ? (
          <Notice tone="danger" title="操作に失敗しました">
            {actionView.errorMessage}
          </Notice>
        ) : null}

        {filters.loadFailed ? (
          <Notice
            action={
              <Button
                pending={filters.refresh.pending}
                pendingLabel="再読み込み中"
                size="sm"
                variant="secondary"
                onClick={filters.refresh.run}
              >
                候補を再読み込み
              </Button>
            }
            tone="warning"
            title="検索条件の候補を一部読み込めません"
          >
            <p>開催一覧は表示できます。作品、シーズン、マップの候補を再取得できます。</p>
          </Notice>
        ) : null}

        {showDesktopTable ? (
          <HeldEventsFilterBar
            actions={filters.actions}
            candidates={filters.candidates}
            hasConditions={filters.hasConditions}
            pending={filters.pending}
            search={filters.search}
          />
        ) : null}
        <HeldEventListSearchSheet
          candidates={filters.candidates}
          open={sheetOpen}
          search={filters.search}
          onApply={(search) => {
            setSheetOpen(false);
            filters.actions.onChange({ kind: "conditions", search });
          }}
          onOpenChange={setSheetOpen}
        />

        <section aria-label="開催の一覧" className="relative grid min-h-[24rem] gap-4">
          <div className="grid gap-3">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              {totalItems !== undefined && !showPagination && ready ? (
                <p className={cn(contentText.compactPrimary, "tabular-nums")}>
                  {totalItems.toLocaleString()}開催
                </p>
              ) : (
                <span />
              )}
              <div
                aria-label="開催一覧の操作"
                className="flex flex-wrap items-center justify-end gap-1"
                role="group"
              >
                <PendingStatus pending={toolbarPending} spinner={false}>
                  一覧を更新中
                </PendingStatus>
                <IconButton
                  aria-label="最新情報に更新"
                  disabled={refresh.disabled || listPending || list.loading}
                  icon={<RefreshCw />}
                  pending={toolbarPending}
                  pendingLabel="一覧を更新中"
                  tooltip={refresh.pending ? "更新中…" : "最新情報に更新"}
                  variant="quiet"
                  onClick={refresh.run}
                />
              </div>
            </div>
            <AppliedConditionChips
              conditions={chipConditions}
              disabled={list.scopeChanging}
              onRemove={removeCondition}
            />
          </div>

          {list.stale && ready ? (
            <Notice
              action={
                <Button
                  pending={refresh.pending}
                  pendingLabel="再取得中"
                  size="sm"
                  variant="secondary"
                  onClick={refresh.run}
                >
                  開催履歴を再取得
                </Button>
              }
              tone="warning"
              title="開催履歴を更新できませんでした"
            >
              前回取得した開催履歴を表示しています。開催詳細への移動や出力は利用できますが、削除は最新状態を確認できるまで行えません。
            </Notice>
          ) : null}

          {list.loading ? (
            <ListSkeleton showDesktopTable={showDesktopTable} />
          ) : (
            <StaleShield
              active={list.updating}
              busyLabel="開催履歴を更新中"
              statusPlacement="external"
              fallback={<ListSkeleton showDesktopTable={showDesktopTable} />}
              strategy={list.scopeChanging ? "preserve-inert" : "preserve-interactive"}
            >
              <div className="grid gap-4">
                {list.loadFailed ? (
                  <Notice
                    action={
                      <Button
                        pending={refresh.pending}
                        pendingLabel="再読み込み中"
                        size="sm"
                        onClick={refresh.run}
                      >
                        開催履歴を再読み込み
                      </Button>
                    }
                    tone="danger"
                    title="開催履歴を読み込めません"
                  >
                    <p>通信状態を確認して、もう一度お試しください。</p>
                  </Notice>
                ) : list.rows.length === 0 ? (
                  <div className="grid min-h-[18rem]">
                    {filters.hasConditions ? (
                      <EmptyState
                        action={
                          <Button variant="secondary" onClick={filters.actions.onClear}>
                            条件をすべて解除
                          </Button>
                        }
                        description="条件を減らすと、ほかの開催を確認できます。"
                        icon={<Filter />}
                        placement="embedded"
                        title="条件に合う開催はありません"
                      />
                    ) : (
                      <EmptyState
                        action={
                          <Button
                            icon={<Plus aria-hidden="true" />}
                            onClick={heldEvents.openCreate}
                          >
                            最初の開催を作成
                          </Button>
                        }
                        description="開催を作ると、同じ日に行った試合を番号順にまとめられます。"
                        icon={<CalendarDays />}
                        placement="embedded"
                        title="開催履歴はまだありません"
                      />
                    )}
                  </div>
                ) : (
                  <>
                    {showDesktopTable ? (
                      <HeldEventsTable
                        actionsDisabled={list.scopeChanging}
                        deleteDisabled={list.deleteDisabled}
                        emphasizedMemberId={list.emphasizedMemberId}
                        memoQuery={list.memoQuery}
                        rows={list.rows}
                        showNoteMatch={showNoteMatch}
                        onDelete={list.onRequestDelete}
                      />
                    ) : (
                      <HeldEventListCompactRows
                        actionsDisabled={list.scopeChanging}
                        deleteDisabled={list.deleteDisabled}
                        emphasizedMemberId={list.emphasizedMemberId}
                        memoQuery={list.memoQuery}
                        rows={list.rows}
                        showNoteMatch={showNoteMatch}
                        onDelete={list.onRequestDelete}
                      />
                    )}
                    {list.pagination && showPagination ? (
                      showDesktopTable ? (
                        <PaginationControls
                          disabled={list.scopeChanging}
                          pageSizeOptions={[...heldEventListPageSizeOptions]}
                          pagination={list.pagination.value}
                          placement="embedded"
                          onPageChange={list.pagination.changePage}
                          onPageSizeChange={list.pagination.changePageSize}
                        />
                      ) : (
                        <PaginationControls
                          disabled={list.scopeChanging}
                          pagination={list.pagination.value}
                          placement="embedded"
                          variant="compact"
                          onPageChange={list.pagination.changePage}
                        />
                      )
                    ) : null}
                  </>
                )}
              </div>
            </StaleShield>
          )}
        </section>
      </PageContentSurface>

      <CreateHeldEventDialog form={heldEvents.create} />
      <DeleteHeldEventDialog confirmation={heldEvents.deleteDialog} />
    </PageFrame>
  );
}

import { Download, Filter, PencilLine, PenSquare, RefreshCw, ScanLine, Trophy } from "lucide-react";
import { useState } from "react";

import { MatchesFilterBar } from "@/features/matches/list/MatchesFilterBar";
import { describeMatchListConditions } from "@/features/matches/list/matchListConditions";
import { matchListExportLink } from "@/features/matches/list/matchListPresentation";
import { MatchesTable, MatchListCompactRows } from "@/features/matches/list/MatchListRows";
import { matchListPageSizeOptions } from "@/features/matches/list/matchListSearchParams";
import { MatchListSearchSheet } from "@/features/matches/list/MatchListSearchSheet";
import type { MatchesListView } from "@/features/matches/list/useMatchesList";
import { useMatchesList } from "@/features/matches/list/useMatchesList";
import { useMediaQuery } from "@/shared/lib/useMediaQuery";
import { inlineActionGroupClass } from "@/shared/ui/actions/actionGroup";
import { Button } from "@/shared/ui/actions/Button";
import { IconButton } from "@/shared/ui/actions/IconButton";
import { IconLink } from "@/shared/ui/actions/IconLink";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
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

/** Below the smallest page size every match fits on one page, so the count moves to the toolbar. */
const paginationThreshold = matchListPageSizeOptions[0];

function ListSkeleton({ showDesktopTable }: { showDesktopTable: boolean }) {
  return (
    <div aria-label="試合一覧を読み込み中" role="status">
      <span className="sr-only">試合一覧を読み込み中</span>
      <div className="grid gap-3 border-y border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3">
        {showDesktopTable ? <Skeleton className="min-h-10" /> : null}
        {["s1", "s2", "s3", "s4"].map((id) => (
          <Skeleton key={id} className={showDesktopTable ? "min-h-16" : "min-h-14"} />
        ))}
      </div>
    </div>
  );
}

function DraftNotice({ count, href }: { count: number | undefined; href: string }) {
  if (!count) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-sm bg-[var(--color-surface-subtle)] px-3 py-1.5 sm:px-4">
      <p className={cn(contentText.body, "inline-flex items-center gap-2 tabular-nums")}>
        <PencilLine aria-hidden="true" className="size-4 shrink-0" />
        確定前の下書き {count.toLocaleString()}件
      </p>
      <LinkButton size="sm" to={href} variant="quiet">
        下書きを確認
      </LinkButton>
    </div>
  );
}

function RegisterActions({ navigation }: { navigation: MatchesListView["navigation"] }) {
  return (
    <div aria-label="試合を登録" className={cn(inlineActionGroupClass, "justify-end")} role="group">
      <LinkButton
        icon={<ScanLine aria-hidden="true" />}
        size="sm"
        to={navigation.ocrHref}
        variant="secondary"
      >
        OCR取り込み
      </LinkButton>
      <LinkButton
        icon={<PenSquare aria-hidden="true" />}
        size="sm"
        to={navigation.manualCreateHref}
        variant="secondary"
      >
        手入力で作成
      </LinkButton>
    </div>
  );
}

export function MatchesListPage() {
  const showDesktopTable = useMediaQuery("(min-width: 1024px)");
  const { draftCount, filters, list, navigation } = useMatchesList();
  const [sheetOpen, setSheetOpen] = useState(false);
  const retryOwnsFeedback = list.loadFailed || list.refreshFailed;
  const listPending = list.refresh.pending || list.scopeChanging || list.sameScopeRefreshing;
  const toolbarPending = listPending && !list.loading && !retryOwnsFeedback;
  const allConditions = describeMatchListConditions(filters.candidates, filters.search, "all");
  const chipConditions = showDesktopTable
    ? describeMatchListConditions(filters.candidates, filters.search, "details")
    : allConditions;
  const exportLink = matchListExportLink(filters.search);
  const totalItems = list.pagination?.value.totalItems;
  const showPagination = totalItems !== undefined && totalItems > paginationThreshold;
  const removeCondition = (condition: (typeof allConditions)[number]["key"]) =>
    filters.actions.onChange({ kind: "removeCondition", condition });

  return (
    <PageFrame>
      <div className="grid gap-4">
        <DraftNotice count={draftCount} href={navigation.draftsHref} />
        <PageContentSurface aria-label="試合一覧" className="grid gap-6" role="region">
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
            <RegisterActions navigation={navigation} />
          </div>

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
              <p>試合一覧は表示できます。開催、作品、シーズン、マップの候補を再取得できます。</p>
            </Notice>
          ) : null}

          {showDesktopTable ? (
            <MatchesFilterBar
              actions={filters.actions}
              candidates={filters.candidates}
              hasConditions={filters.hasConditions}
              pending={filters.pending}
              search={filters.search}
            />
          ) : null}
          <MatchListSearchSheet
            candidates={filters.candidates}
            open={sheetOpen}
            search={filters.search}
            onApply={(search) => {
              setSheetOpen(false);
              filters.actions.onChange({ kind: "conditions", search });
            }}
            onOpenChange={setSheetOpen}
          />

          <section aria-label="確定済みの試合" className="relative grid min-h-[24rem] gap-4">
            <div className="grid gap-3">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                {totalItems !== undefined && !showPagination ? (
                  <p className={cn(contentText.compactPrimary, "tabular-nums")}>
                    {totalItems.toLocaleString()}試合
                  </p>
                ) : (
                  <span />
                )}
                <div
                  aria-label="試合一覧の操作"
                  className="flex flex-wrap items-center justify-end gap-1"
                  role="group"
                >
                  <PendingStatus pending={toolbarPending} spinner={false}>
                    一覧を更新中
                  </PendingStatus>
                  <IconButton
                    aria-label="最新情報に更新"
                    disabled={listPending || list.loading}
                    icon={<RefreshCw />}
                    pending={toolbarPending}
                    pendingLabel="一覧を更新中"
                    tooltip={list.refresh.pending ? "更新中…" : "最新情報に更新"}
                    variant="quiet"
                    onClick={() => void list.refresh.run()}
                  />
                  {showDesktopTable ? (
                    <LinkButton icon={<Download />} size="sm" to={exportLink.href} variant="quiet">
                      {exportLink.label}
                    </LinkButton>
                  ) : (
                    <IconLink
                      aria-label={exportLink.label}
                      icon={<Download />}
                      to={exportLink.href}
                      tooltip={exportLink.label}
                      variant="quiet"
                    />
                  )}
                </div>
              </div>
              <AppliedConditionChips
                conditions={chipConditions}
                disabled={list.scopeChanging}
                onRemove={removeCondition}
              />
            </div>

            {list.refreshFailed ? (
              <Notice
                action={
                  <Button
                    pending={listPending}
                    pendingLabel="一覧を再読み込み中"
                    size="sm"
                    variant="secondary"
                    onClick={() => void list.refresh.run()}
                  >
                    一覧を再読み込み
                  </Button>
                }
                title="一覧を更新できませんでした"
                tone="warning"
              >
                <p>取得済みの試合は表示したままです。通信状態を確認して再読み込みしてください。</p>
              </Notice>
            ) : null}

            {list.loading ? (
              <ListSkeleton showDesktopTable={showDesktopTable} />
            ) : (
              <StaleShield
                active={list.updating}
                busyLabel="一覧を更新中"
                statusPlacement="external"
                fallback={<ListSkeleton showDesktopTable={showDesktopTable} />}
                strategy={list.scopeChanging ? "preserve-inert" : "preserve-interactive"}
              >
                <div className="grid gap-4">
                  {list.loadFailed ? (
                    <Notice
                      action={
                        <Button
                          pending={listPending}
                          pendingLabel="再読み込み中"
                          size="sm"
                          onClick={() => void list.refresh.run()}
                        >
                          一覧を再読み込み
                        </Button>
                      }
                      tone="danger"
                      title="試合一覧を読み込めません"
                    >
                      <p>通信状態を確認して、もう一度お試しください。</p>
                    </Notice>
                  ) : list.items.length === 0 ? (
                    <div className="grid min-h-[18rem]">
                      {filters.hasConditions ? (
                        <EmptyState
                          action={
                            <Button variant="secondary" onClick={filters.actions.onClear}>
                              条件をすべて解除
                            </Button>
                          }
                          description="条件を減らすと、ほかの試合を確認できます。"
                          icon={<Filter />}
                          placement="embedded"
                          title="条件に合う試合はありません"
                        />
                      ) : (
                        <EmptyState
                          action={
                            <div className="flex flex-wrap gap-2">
                              <LinkButton to={navigation.ocrHref}>OCR取り込み</LinkButton>
                              <LinkButton to={navigation.manualCreateHref} variant="secondary">
                                手入力で作成
                              </LinkButton>
                            </div>
                          }
                          description="OCR取り込みか手入力で、最初の試合を登録します。"
                          icon={<Trophy />}
                          placement="embedded"
                          title="試合はまだありません"
                        />
                      )}
                    </div>
                  ) : (
                    <>
                      {showDesktopTable ? (
                        <MatchesTable
                          disabled={list.scopeChanging}
                          items={list.items}
                          memoQuery={list.memoQuery}
                        />
                      ) : (
                        <MatchListCompactRows
                          disabled={list.scopeChanging}
                          items={list.items}
                          memoQuery={list.memoQuery}
                        />
                      )}
                      {list.pagination && showPagination ? (
                        showDesktopTable ? (
                          <PaginationControls
                            disabled={list.scopeChanging}
                            pageSizeOptions={[...matchListPageSizeOptions]}
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
      </div>
    </PageFrame>
  );
}

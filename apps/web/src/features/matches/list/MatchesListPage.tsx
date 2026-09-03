import { AlertTriangle, ArrowLeft, Download, PenSquare, RefreshCw, ScanLine } from "lucide-react";

import { MatchesFilterBar } from "@/features/matches/list/MatchesFilterBar";
import { MatchesTable } from "@/features/matches/list/MatchesTable";
import { matchListPageSizeOptions } from "@/features/matches/list/matchListSearchParams";
import { MatchMobileCard } from "@/features/matches/list/MatchMobileCard";
import { useMatchesListPageModel } from "@/features/matches/list/useMatchesListPageModel";
import { useMediaQuery } from "@/shared/lib/useMediaQuery";
import { Button } from "@/shared/ui/actions/Button";
import { IconButton } from "@/shared/ui/actions/IconButton";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { PaginationControls } from "@/shared/ui/data/PaginationControls";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";
import { StaleShield } from "@/shared/ui/motion/StaleShield";

function ListSkeleton({ showDesktopTable }: { showDesktopTable: boolean }) {
  return (
    <div>
      {showDesktopTable ? (
        <div className="grid gap-3 border-y border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3">
          <Skeleton className="min-h-10" />
          {["s1", "s2", "s3", "s4"].map((id) => (
            <Skeleton key={id} className="min-h-24" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3">
          {["m1", "m2", "m3"].map((id) => (
            <Skeleton key={id} className="min-h-56 rounded-md" />
          ))}
        </div>
      )}
    </div>
  );
}

export function MatchesListPage() {
  const showDesktopTable = useMediaQuery("(min-width: 1024px)");
  const { drafts, filters, list, navigation, summary } = useMatchesListPageModel();

  return (
    <PageFrame>
      {navigation.backHref ? (
        <div>
          <LinkButton
            icon={<ArrowLeft aria-hidden="true" />}
            size="sm"
            to={navigation.backHref}
            variant="quiet"
          >
            前の画面へ戻る
          </LinkButton>
        </div>
      ) : null}
      <PageHeader
        actions={
          <div
            aria-label="試合を登録"
            className="grid w-full shrink-0 grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center"
            role="group"
          >
            <LinkButton icon={<ScanLine />} size="sm" to={navigation.ocrHref} variant="secondary">
              OCR取り込み
            </LinkButton>
            <LinkButton
              icon={<PenSquare />}
              size="sm"
              to={navigation.manualCreateHref}
              variant="secondary"
            >
              手入力で作成
            </LinkButton>
          </div>
        }
        title="試合一覧"
      />

      <PageContentSurface className="grid gap-6">
        {filters.loadFailed ? (
          <Notice tone="warning" title="絞り込み候補を一部読み込めません">
            <p>試合一覧は表示できます。開催、作品、シーズンの候補を再取得できます。</p>
            <div className="mt-3">
              <Button
                pending={filters.refresh.pending}
                pendingLabel="再読み込み中"
                size="sm"
                variant="secondary"
                onClick={filters.refresh.run}
              >
                候補を再読み込み
              </Button>
            </div>
          </Notice>
        ) : null}

        <MatchesFilterBar
          actions={filters.actions}
          candidates={filters.candidates}
          counts={summary.counts}
          onRetrySummary={summary.retry}
          pending={filters.pending}
          search={filters.search}
          summaryError={summary.loadFailed}
          summaryLoading={summary.loading}
          summaryMasked={summary.masked}
        />

        <section
          aria-busy={list.scopeChanging || list.sameScopeRefreshing || undefined}
          aria-label="登録済みの試合"
          className="relative grid min-h-[24rem] gap-4"
        >
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <div
              aria-label="試合一覧の操作"
              className="flex flex-wrap items-center justify-end gap-1"
              role="group"
            >
              <LinkButton icon={<Download />} size="sm" to={navigation.exportHref} variant="quiet">
                CSV/TSVをまとめて出力
              </LinkButton>
              <IconButton
                aria-label="最新情報に更新"
                disabled={list.scopeChanging && !list.refresh.pending}
                icon={<RefreshCw />}
                pending={list.refresh.pending}
                pendingLabel="一覧を更新中"
                tooltip={list.refresh.pending ? "更新中…" : "最新情報に更新"}
                variant="quiet"
                onClick={() => void list.refresh.run()}
              />
            </div>
          </div>

          {list.refreshFailed ? (
            <Notice
              action={
                <Button
                  pending={list.refresh.pending}
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
              fallback={<ListSkeleton showDesktopTable={showDesktopTable} />}
              strategy={list.scopeChanging ? "preserve-inert" : "preserve-interactive"}
            >
              <div className="grid gap-4">
                {list.loadFailed ? (
                  <Notice tone="danger" title="試合一覧を読み込めません">
                    <p>通信状態を確認して、もう一度お試しください。</p>
                    <div className="mt-3">
                      <Button
                        pending={list.refresh.pending}
                        pendingLabel="再読み込み中"
                        size="sm"
                        onClick={() => void list.refresh.run()}
                      >
                        一覧を再読み込み
                      </Button>
                    </div>
                  </Notice>
                ) : list.items.length === 0 ? (
                  <div className="grid min-h-[18rem]">
                    <EmptyState
                      action={
                        filters.hasActive ? undefined : (
                          <div className="flex flex-wrap gap-2">
                            <LinkButton to={navigation.ocrHref}>OCR取り込み</LinkButton>
                            <LinkButton to={navigation.manualCreateHref} variant="secondary">
                              手入力で作成
                            </LinkButton>
                          </div>
                        )
                      }
                      description={
                        filters.hasActive
                          ? "状態や開催条件を広げると、他の試合記録を確認できます。"
                          : "OCR取り込みか手入力で、最初の試合を登録します。"
                      }
                      icon={<AlertTriangle />}
                      placement="embedded"
                      title={
                        filters.hasActive ? "該当する試合はありません" : "試合はまだありません"
                      }
                    />
                  </div>
                ) : (
                  <>
                    {showDesktopTable ? (
                      <MatchesTable items={list.items} rowActions={drafts.rowActions} />
                    ) : (
                      <div className="grid gap-3">
                        {list.items.map((item) => (
                          <div className="grid min-h-48" key={item.id}>
                            <MatchMobileCard item={item} rowActions={drafts.rowActions} />
                          </div>
                        ))}
                      </div>
                    )}
                    {list.pagination ? (
                      <PaginationControls
                        disabled={list.scopeChanging}
                        pageSizeOptions={[...matchListPageSizeOptions]}
                        pagination={list.pagination.value}
                        placement="embedded"
                        onPageChange={list.pagination.changePage}
                        onPageSizeChange={list.pagination.changePageSize}
                      />
                    ) : null}
                  </>
                )}
              </div>
            </StaleShield>
          )}
        </section>
      </PageContentSurface>
    </PageFrame>
  );
}

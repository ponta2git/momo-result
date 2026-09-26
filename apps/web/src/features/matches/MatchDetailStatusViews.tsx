import type { ReactNode, Ref } from "react";

import {
  matchResultLedgerGridClass,
  matchResultLedgerRowClass,
} from "@/shared/matches/MatchResultLedger";
import { inlineActionGroupClass } from "@/shared/ui/actions/actionGroup";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { FactList } from "@/shared/ui/data/FactList";
import { ResourcePageState } from "@/shared/ui/feedback/ResourcePageState";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

export function MatchDetailLoading() {
  return (
    <PageFrame aria-busy="true" aria-label="試合詳細を読み込み中" width="wide">
      <div>
        <Skeleton className="h-11 w-40 max-w-full rounded-sm pointer-fine:h-9" />
      </div>
      <PageHeader
        actions={
          <div aria-hidden="true" className={inlineActionGroupClass}>
            <Skeleton className="h-11 w-36 rounded-sm pointer-fine:h-9" />
            <Skeleton className="h-11 w-36 rounded-sm pointer-fine:h-9" />
          </div>
        }
        description={<Skeleton as="span" className="block h-5 w-full max-w-56" />}
        title="試合結果を読み込み中"
      />
      <PageContentSurface className="grid gap-6">
        <div aria-hidden="true">
          <FactList
            ariaLabel="試合の開催条件"
            columns={4}
            items={["held", "game", "season", "map"].map((id) => ({
              id,
              label: <Skeleton as="span" className="block h-4 w-16 max-w-full" />,
              value: <Skeleton as="span" className="block h-5 w-32 max-w-full" />,
            }))}
          />
        </div>
        <div className="grid gap-4">
          <div className="grid gap-1">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-4 w-full max-w-96" />
          </div>
          <div
            aria-hidden="true"
            className={matchResultLedgerGridClass}
            data-match-result-loading-list=""
          >
            {[1, 2, 3, 4].map((id) => (
              <div
                key={id}
                className={`${matchResultLedgerRowClass} rounded-md border border-[var(--color-border)]`}
                data-match-result-loading-row=""
              >
                <div className="flex items-center gap-2">
                  <Skeleton className="h-10 w-14" />
                  <Skeleton className="h-7 w-32" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Skeleton className="h-20" />
                  <Skeleton className="h-20" />
                </div>
                <Skeleton className="h-10 w-48 max-w-full" />
                <div className="grid grid-cols-3 gap-2">
                  {[1, 2, 3, 4, 5, 6].map((key) => (
                    <Skeleton key={key} className="h-10" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </PageContentSurface>
      <div aria-hidden="true" className="grid min-w-0 grid-cols-2 gap-3">
        <Skeleton className="h-20 w-full rounded-sm" />
        <Skeleton className="h-20 w-full rounded-sm" />
      </div>
    </PageFrame>
  );
}

export function MatchDetailLoadFailed({
  backHref = "/matches",
  backLabel = "前の画面へ戻る",
  backNotice,
  notFound = false,
  onRetry,
  retrying = false,
  titleRef,
  recovery,
}: {
  backHref?: string;
  backLabel?: string;
  backNotice?: string | undefined;
  titleRef?: Ref<HTMLHeadingElement>;
  recovery?: ReactNode;
  notFound?: boolean;
  onRetry?: (() => void) | undefined;
  retrying?: boolean;
}) {
  return notFound ? (
    <ResourcePageState
      backHref={backHref}
      backLabel={backLabel}
      titleRef={titleRef}
      headerDescription={backNotice}
      headerActions={
        backHref !== "/matches" || onRetry ? (
          <div aria-label="試合詳細の回復操作" className={inlineActionGroupClass} role="group">
            {backHref === "/matches" ? null : (
              <LinkButton size="sm" to="/matches" variant="quiet">
                試合一覧へ
              </LinkButton>
            )}
            {onRetry ? (
              <Button onClick={onRetry} pending={retrying} size="sm" variant="quiet">
                再取得
              </Button>
            ) : null}
          </div>
        ) : undefined
      }
      description="指定された試合は削除されたか、存在しません。前の画面から別の試合を選んでください。"
      kind="not-found"
      title="試合が見つかりません"
    >
      {recovery}
    </ResourcePageState>
  ) : onRetry ? (
    <ResourcePageState
      backHref={backHref}
      backLabel={backLabel}
      titleRef={titleRef}
      headerDescription={backNotice}
      headerActions={
        backHref === "/matches" ? undefined : (
          <div aria-label="試合詳細の回復操作" className={inlineActionGroupClass} role="group">
            <LinkButton size="sm" to="/matches" variant="quiet">
              試合一覧へ
            </LinkButton>
          </div>
        )
      }
      description="通信状態を確認して、もう一度お試しください。"
      kind="error"
      retryLabel="試合詳細を再読み込み"
      retrying={retrying}
      title="試合詳細を読み込めませんでした"
      onRetry={onRetry}
    >
      {recovery}
    </ResourcePageState>
  ) : null;
}

import type { ReactNode, Ref } from "react";

import {
  matchResultLedgerGridClass,
  matchResultLedgerRowClass,
} from "@/shared/matches/MatchResultLedger";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
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
          <>
            <Skeleton className="h-11 w-32 rounded-sm pointer-fine:h-10" />
            <Skeleton className="h-11 w-16 rounded-sm pointer-fine:h-10" />
          </>
        }
        title="試合結果を読み込み中"
      />
      <PageContentSurface className="grid gap-6">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {["held", "game", "season", "map"].map((id) => (
            <div key={id} className="grid gap-1">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-5 w-32" />
            </div>
          ))}
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
        <>
          {backHref === "/matches" ? null : (
            <LinkButton to="/matches" variant="secondary">
              試合一覧へ
            </LinkButton>
          )}
          {onRetry ? (
            <Button onClick={onRetry} pending={retrying} variant="quiet">
              再取得
            </Button>
          ) : null}
        </>
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
          <LinkButton to="/matches" variant="secondary">
            試合一覧へ
          </LinkButton>
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

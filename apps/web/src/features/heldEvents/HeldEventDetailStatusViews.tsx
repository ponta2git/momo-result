import { ArrowLeft } from "lucide-react";

import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { Card } from "@/shared/ui/layout/Card";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

export function HeldEventDetailLoading() {
  return (
    <PageFrame aria-busy="true" aria-label="開催詳細を読み込み中" className="gap-4" width="wide">
      <PageHeader eyebrow="開催記録" title="開催の記録を読み込み中" />
      <Card className="grid grid-cols-3 gap-3 bg-[var(--color-surface-subtle)]">
        {["matches", "drafts", "next"].map((id) => (
          <div key={id} className="grid gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-7 w-20" />
          </div>
        ))}
      </Card>
      <Card className="overflow-hidden p-0">
        <div className="border-b border-[var(--color-border)] p-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="mt-2 h-4 w-64 max-w-full" />
        </div>
        {["match-1", "match-2"].map((id) => (
          <div
            key={id}
            className="grid gap-3 border-b border-[var(--color-border)] p-4 last:border-b-0"
          >
            <div className="flex justify-between gap-4">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-9 w-24" />
            </div>
            <Skeleton className="h-4 w-72 max-w-full" />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {["a", "b", "c", "d"].map((player) => (
                <Skeleton key={player} className="h-16" />
              ))}
            </div>
          </div>
        ))}
      </Card>
    </PageFrame>
  );
}

export function HeldEventDetailUnavailable({
  backHref = "/held-events",
  notFound = false,
  onRetry,
  retrying = false,
}: {
  backHref?: string;
  notFound?: boolean;
  onRetry?: (() => void) | undefined;
  retrying?: boolean;
}) {
  return (
    <PageFrame className="gap-4" width="wide">
      <Notice
        tone={notFound ? "warning" : "danger"}
        title={notFound ? "開催履歴が見つかりません" : "開催詳細を読み込めませんでした"}
      >
        <p>
          {notFound
            ? "削除されたか、URLが正しくない可能性があります。"
            : "通信状態を確認して、もう一度お試しください。"}
        </p>
        {!notFound && onRetry ? (
          <div className="mt-3">
            <Button
              pending={retrying}
              pendingLabel="再読み込み中"
              size="sm"
              variant="secondary"
              onClick={onRetry}
            >
              開催詳細を再読み込み
            </Button>
          </div>
        ) : null}
      </Notice>
      <LinkButton
        icon={<ArrowLeft aria-hidden="true" className="size-4" />}
        to={backHref}
        variant="secondary"
      >
        開催履歴へ戻る
      </LinkButton>
    </PageFrame>
  );
}

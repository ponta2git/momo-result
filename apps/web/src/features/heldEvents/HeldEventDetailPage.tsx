import { ArrowLeft, Camera, Download, Keyboard, ListFilter, RefreshCw } from "lucide-react";

import {
  HeldEventDetailLoading,
  HeldEventDetailUnavailable,
} from "@/features/heldEvents/HeldEventDetailStatusViews";
import { formatHeldEventDateTime } from "@/features/heldEvents/heldEventDetailViewModel";
import { HeldEventDraftsSection } from "@/features/heldEvents/HeldEventDraftsSection";
import { HeldEventMatchTimeline } from "@/features/heldEvents/HeldEventMatchTimeline";
import { heldEventOcrCaptureHref } from "@/features/heldEvents/heldEventNavigation";
import { HeldEventPlayerRecap } from "@/features/heldEvents/HeldEventPlayerRecap";
import { useHeldEventDetailPageController } from "@/features/heldEvents/useHeldEventDetailPageController";
import { formatMatchNoInEvent } from "@/shared/domain/matchLabels";
import { withReturnTo } from "@/shared/navigation/returnTo";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

type HeldEventDetailReadyController = Extract<
  ReturnType<typeof useHeldEventDetailPageController>,
  { status: "ready" }
>;

export function HeldEventDetailPage() {
  const controller = useHeldEventDetailPageController();

  if (controller.status === "loading") {
    return <HeldEventDetailLoading />;
  }
  if (controller.status === "notFound") {
    return <HeldEventDetailUnavailable backHref={controller.backHref} notFound />;
  }
  if (controller.status === "loadFailed") {
    return (
      <HeldEventDetailUnavailable
        backHref={controller.backHref}
        retrying={controller.refreshing}
        onRetry={controller.refresh}
      />
    );
  }

  return <HeldEventDetailReadyContent controller={controller} />;
}

function HeldEventDetailReadyContent({
  controller,
}: {
  controller: HeldEventDetailReadyController;
}) {
  const {
    backHref,
    detail,
    detailRefreshFailed,
    detailRefreshing,
    drafts,
    masterNames,
    masterNameLoadError,
    masterNamesRefreshing,
    matches,
    playerRecaps,
    refresh,
    retryDetail,
    retryMasterNames,
    refreshing,
    returnTo,
  } = controller;
  const encodedHeldEventId = encodeURIComponent(detail.id);
  const emphasizeNewMatch = drafts.length === 0 && matches.length === 0;

  return (
    <PageFrame className="min-w-0" width="wide">
      <div>
        <LinkButton
          icon={<ArrowLeft aria-hidden="true" className="size-4" />}
          size="sm"
          to={backHref}
          variant="quiet"
        >
          開催履歴へ戻る
        </LinkButton>
      </div>

      <PageHeader
        actions={
          <nav aria-label="この開催の関連操作" className="flex flex-wrap items-center gap-2">
            <LinkButton
              icon={<ListFilter aria-hidden="true" className="size-4" />}
              size="sm"
              to={withReturnTo(
                `/matches?heldEventId=${encodedHeldEventId}&sort=match_no_asc`,
                returnTo,
              )}
              variant="quiet"
            >
              試合検索で見る
            </LinkButton>
            <LinkButton
              icon={<Download aria-hidden="true" className="size-4" />}
              size="sm"
              to={withReturnTo(`/exports?heldEventId=${encodedHeldEventId}&format=csv`, returnTo)}
              variant="quiet"
            >
              CSV出力
            </LinkButton>
            <Button
              aria-label="開催詳細を更新"
              icon={<RefreshCw aria-hidden="true" className="size-4" />}
              pending={refreshing}
              pendingLabel="更新中"
              size="sm"
              variant="quiet"
              onClick={refresh}
            >
              更新
            </Button>
          </nav>
        }
        description={`確定済み ${detail.matchCount}試合 ・ 未完了 ${detail.draftCount}件`}
        eyebrow="開催記録"
        title={formatHeldEventDateTime(detail.heldAt)}
      />

      <PageContentSurface aria-label="開催内容" className="grid gap-6" role="region">
        {detailRefreshFailed ? (
          <Notice
            tone="warning"
            title="開催詳細を更新できませんでした"
            action={
              <Button
                pending={detailRefreshing}
                pendingLabel="再取得中"
                size="sm"
                variant="secondary"
                onClick={retryDetail}
              >
                開催詳細を再取得
              </Button>
            }
          >
            前回取得した開催内容を表示しています。表示中の詳細と関連操作はそのまま利用できます。
          </Notice>
        ) : null}

        {masterNameLoadError ? (
          <Notice
            tone="warning"
            title="表示名を取得できませんでした"
            action={
              <Button
                pending={masterNamesRefreshing}
                pendingLabel="再取得中"
                size="sm"
                variant="secondary"
                onClick={retryMasterNames}
              >
                表示名を再取得
              </Button>
            }
          >
            {masterNameLoadError}
            を更新できませんでした。取得済みの表示名はそのまま使い、取得できない箇所だけ「未取得」と表示しています。
          </Notice>
        ) : null}

        <section aria-labelledby="held-event-next-match-heading" className="grid gap-3">
          <h2
            className="momo-heading text-lg font-semibold text-[var(--color-text-primary)]"
            id="held-event-next-match-heading"
          >
            {formatMatchNoInEvent(detail.nextMatchNo)}を記録
          </h2>
          <div className="flex flex-wrap gap-2">
            <LinkButton
              icon={<Camera aria-hidden="true" className="size-4" />}
              to={heldEventOcrCaptureHref(detail.id, returnTo)}
              variant={emphasizeNewMatch ? "primary" : "secondary"}
            >
              OCR取り込み
            </LinkButton>
            <LinkButton
              icon={<Keyboard aria-hidden="true" className="size-4" />}
              to={withReturnTo(`/matches/new?heldEventId=${encodedHeldEventId}`, returnTo)}
              variant="secondary"
            >
              手入力
            </LinkButton>
          </div>
        </section>

        <HeldEventDraftsSection drafts={drafts} masterNames={masterNames} returnTo={returnTo} />
        <HeldEventPlayerRecap recaps={playerRecaps} />
        <HeldEventMatchTimeline masterNames={masterNames} matches={matches} returnTo={returnTo} />
      </PageContentSurface>
    </PageFrame>
  );
}

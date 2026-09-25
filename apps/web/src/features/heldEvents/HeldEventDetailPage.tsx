import { ArrowLeft, Camera, Keyboard } from "lucide-react";
import type { Ref } from "react";

import { HeldEventDetailHeaderActions } from "@/features/heldEvents/HeldEventDetailHeaderActions";
import {
  HeldEventDetailLoading,
  HeldEventDetailUnavailable,
} from "@/features/heldEvents/HeldEventDetailStatusViews";
import { HeldEventDraftsSection } from "@/features/heldEvents/HeldEventDraftsSection";
import { HeldEventMatchTimeline } from "@/features/heldEvents/HeldEventMatchTimeline";
import { HeldEventPlayerRecap } from "@/features/heldEvents/HeldEventPlayerRecap";
import { useHeldEventDetailPageModel } from "@/features/heldEvents/useHeldEventDetailPageModel";
import type { HeldEventDetailReadyPageModel } from "@/features/heldEvents/useHeldEventDetailPageModel";
import { formatMatchNoInEvent } from "@/shared/domain/matchLabels";
import { useAdjacentNavigationFocus } from "@/shared/navigation/useAdjacentNavigationFocus";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";
import { AdjacentNavigation } from "@/shared/ui/navigation/AdjacentNavigation";
import { contentText } from "@/shared/ui/typography";

export function HeldEventDetailPage() {
  const page = useHeldEventDetailPageModel();
  const titleRef = useAdjacentNavigationFocus(page.kind !== "loading");

  if (page.kind === "loading") {
    return <HeldEventDetailLoading />;
  }
  if (page.kind === "notFound") {
    return <HeldEventDetailUnavailable {...page.navigation} notFound titleRef={titleRef} />;
  }
  if (page.kind === "loadFailed") {
    return (
      <HeldEventDetailUnavailable
        {...page.navigation}
        titleRef={titleRef}
        retrying={page.refresh.pending}
        onRetry={page.refresh.run}
      />
    );
  }

  return <HeldEventDetailReadyContent page={page} titleRef={titleRef} />;
}

function HeldEventDetailReadyContent({
  page,
  titleRef,
}: {
  page: HeldEventDetailReadyPageModel;
  titleRef: Ref<HTMLHeadingElement>;
}) {
  const { event, freshness, navigation, refresh } = page;
  const { detail, drafts, emphasizeNewMatch, matches, playerRecaps } = event;

  return (
    <PageFrame className="min-w-0" width="wide">
      <div>
        <LinkButton
          icon={<ArrowLeft aria-hidden="true" />}
          size="sm"
          to={navigation.backHref}
          variant="quiet"
        >
          {navigation.backLabel}
        </LinkButton>
        {navigation.backNotice ? (
          <p className={contentText.supporting}>{navigation.backNotice}</p>
        ) : null}
      </div>

      <PageHeader
        actions={
          <HeldEventDetailHeaderActions exportHref={navigation.exportHref} refresh={refresh} />
        }
        description={`確定済み${detail.matchCount}試合・未確定下書き${detail.draftCount}件`}
        eyebrow="開催記録"
        title={navigation.currentDateTime}
        titleRef={titleRef}
      />

      <PageContentSurface aria-label="開催内容" className="grid gap-8" role="region">
        {freshness.kind === "stale" ? (
          <Notice
            tone="warning"
            title="開催詳細を更新できませんでした"
            action={
              <Button
                pending={freshness.refresh.pending}
                disabled={freshness.refresh.disabled}
                pendingLabel="再取得中"
                size="sm"
                variant="secondary"
                onClick={freshness.refresh.run}
              >
                開催詳細を再取得
              </Button>
            }
          >
            前回取得した開催内容を表示しています。前後の開催への移動は、再取得が完了するまで利用できません。
          </Notice>
        ) : null}

        <section aria-labelledby="held-event-next-match-heading" className="grid gap-4">
          <h2 className={contentText.heading} id="held-event-next-match-heading">
            {formatMatchNoInEvent(detail.nextMatchNo)}を記録
          </h2>
          <div className="flex flex-wrap gap-2">
            <LinkButton
              icon={<Camera aria-hidden="true" />}
              to={navigation.ocrCaptureHref}
              variant={emphasizeNewMatch ? "primary" : "secondary"}
            >
              OCR取り込み
            </LinkButton>
            <LinkButton
              icon={<Keyboard aria-hidden="true" />}
              to={navigation.manualEntryHref}
              variant="secondary"
            >
              手入力
            </LinkButton>
          </div>
        </section>

        <HeldEventDraftsSection drafts={drafts} returnTo={navigation.returnTo} />
        <HeldEventPlayerRecap recaps={playerRecaps} />
        <HeldEventMatchTimeline matches={matches} returnTo={navigation.returnTo} />
      </PageContentSurface>

      <AdjacentNavigation
        label="開催の前後移動"
        alignment="outward"
        previous={navigation.adjacent.previous}
        next={navigation.adjacent.next}
        disabled={navigation.adjacent.disabled}
        status={
          navigation.adjacent.status === "refreshing" ? (
            <p role="status">前後の開催を確認しています。</p>
          ) : navigation.adjacent.status === "failed" ? (
            <p>前後の開催を再確認できません。開催詳細を再取得してください。</p>
          ) : navigation.adjacent.status === "unavailable" ? (
            <div className="flex flex-wrap items-center gap-2">
              <p>
                前後の開催を利用できません。再取得しても改善しない場合は画面を再読み込みしてください。
              </p>
              <Button size="sm" variant="quiet" onClick={refresh.run}>
                前後の開催を再取得
              </Button>
            </div>
          ) : undefined
        }
      />
    </PageFrame>
  );
}

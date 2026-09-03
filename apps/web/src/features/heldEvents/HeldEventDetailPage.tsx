import { ArrowLeft, Camera, Download, Keyboard, ListFilter, RefreshCw } from "lucide-react";

import {
  HeldEventDetailLoading,
  HeldEventDetailUnavailable,
} from "@/features/heldEvents/HeldEventDetailStatusViews";
import { formatHeldEventDateTime } from "@/features/heldEvents/heldEventDetailViewModel";
import { HeldEventDraftsSection } from "@/features/heldEvents/HeldEventDraftsSection";
import { HeldEventMatchTimeline } from "@/features/heldEvents/HeldEventMatchTimeline";
import { HeldEventPlayerRecap } from "@/features/heldEvents/HeldEventPlayerRecap";
import { useHeldEventDetailPageModel } from "@/features/heldEvents/useHeldEventDetailPageModel";
import type { HeldEventDetailReadyPageModel } from "@/features/heldEvents/useHeldEventDetailPageModel";
import { formatMatchNoInEvent } from "@/shared/domain/matchLabels";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader, responsivePageHeaderActionGroupClass } from "@/shared/ui/layout/PageHeader";

export function HeldEventDetailPage() {
  const page = useHeldEventDetailPageModel();

  if (page.kind === "loading") {
    return <HeldEventDetailLoading />;
  }
  if (page.kind === "notFound") {
    return <HeldEventDetailUnavailable backHref={page.navigation.backHref} notFound />;
  }
  if (page.kind === "loadFailed") {
    return (
      <HeldEventDetailUnavailable
        backHref={page.navigation.backHref}
        retrying={page.refresh.pending}
        onRetry={page.refresh.run}
      />
    );
  }

  return <HeldEventDetailReadyContent page={page} />;
}

function HeldEventDetailReadyContent({ page }: { page: HeldEventDetailReadyPageModel }) {
  const { enrichment, event, freshness, navigation, refresh } = page;
  const { detail, drafts, emphasizeNewMatch, masterNames, matches, playerRecaps } = event;

  return (
    <PageFrame className="min-w-0" width="wide">
      <div>
        <LinkButton
          icon={<ArrowLeft aria-hidden="true" />}
          size="sm"
          to={navigation.backHref}
          variant="quiet"
        >
          開催履歴へ戻る
        </LinkButton>
      </div>

      <PageHeader
        actions={
          <nav aria-label="この開催の関連操作" className={responsivePageHeaderActionGroupClass}>
            <LinkButton
              icon={<ListFilter aria-hidden="true" />}
              size="sm"
              to={navigation.matchesHref}
              variant="quiet"
            >
              試合検索で見る
            </LinkButton>
            <LinkButton
              icon={<Download aria-hidden="true" />}
              size="sm"
              to={navigation.exportHref}
              variant="quiet"
            >
              CSV出力
            </LinkButton>
            <Button
              aria-label="開催詳細を更新"
              icon={<RefreshCw aria-hidden="true" />}
              pending={refresh.pending}
              pendingLabel="更新中"
              size="sm"
              variant="quiet"
              onClick={refresh.run}
            >
              更新
            </Button>
          </nav>
        }
        description={`確定済み${detail.matchCount}試合・未確定下書き${detail.draftCount}件`}
        eyebrow="開催記録"
        title={formatHeldEventDateTime(detail.heldAt)}
      />

      <PageContentSurface aria-label="開催内容" className="grid gap-8" role="region">
        {freshness.kind === "stale" ? (
          <Notice
            tone="warning"
            title="開催詳細を更新できませんでした"
            action={
              <Button
                pending={freshness.refresh.pending}
                pendingLabel="再取得中"
                size="sm"
                variant="secondary"
                onClick={freshness.refresh.run}
              >
                開催詳細を再取得
              </Button>
            }
          >
            前回取得した開催内容を表示しています。表示中の詳細と関連操作はそのまま利用できます。
          </Notice>
        ) : null}

        {enrichment.kind === "warning" ? (
          <Notice
            tone="warning"
            title="表示名を取得できませんでした"
            action={
              <Button
                pending={enrichment.refresh.pending}
                pendingLabel="再取得中"
                size="sm"
                variant="secondary"
                onClick={enrichment.refresh.run}
              >
                表示名を再取得
              </Button>
            }
          >
            {enrichment.fields.join("・")}
            を更新できませんでした。取得済みの表示名はそのまま使い、取得できない箇所だけ「未取得」と表示しています。
          </Notice>
        ) : null}

        <section aria-labelledby="held-event-next-match-heading" className="grid gap-4">
          <h2
            className="momo-heading text-lg font-semibold text-[var(--color-text-primary)]"
            id="held-event-next-match-heading"
          >
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

        <HeldEventDraftsSection
          drafts={drafts}
          masterNames={masterNames}
          returnTo={navigation.returnTo}
        />
        <HeldEventPlayerRecap recaps={playerRecaps} />
        <HeldEventMatchTimeline
          masterNames={masterNames}
          matches={matches}
          returnTo={navigation.returnTo}
        />
      </PageContentSurface>
    </PageFrame>
  );
}

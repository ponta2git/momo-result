import { ArrowLeft, Camera, Download, Keyboard, ListFilter, RefreshCw } from "lucide-react";

import {
  HeldEventDetailLoading,
  HeldEventDetailUnavailable,
} from "@/features/heldEvents/HeldEventDetailStatusViews";
import { formatHeldEventDateTime } from "@/features/heldEvents/heldEventDetailViewModel";
import { HeldEventDraftsSection } from "@/features/heldEvents/HeldEventDraftsSection";
import { HeldEventMatchTimeline } from "@/features/heldEvents/HeldEventMatchTimeline";
import { HeldEventPlayerRecap } from "@/features/heldEvents/HeldEventPlayerRecap";
import { useHeldEventDetailPageController } from "@/features/heldEvents/useHeldEventDetailPageController";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { Card } from "@/shared/ui/layout/Card";
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
    return <HeldEventDetailUnavailable notFound />;
  }
  if (controller.status === "loadFailed") {
    return <HeldEventDetailUnavailable />;
  }

  return <HeldEventDetailReadyContent controller={controller} />;
}

function HeldEventDetailReadyContent({
  controller,
}: {
  controller: HeldEventDetailReadyController;
}) {
  const { detail, drafts, masterNames, matches, playerRecaps, refresh, refreshing } = controller;
  const encodedHeldEventId = encodeURIComponent(detail.id);

  return (
    <PageFrame className="min-w-0 gap-5" width="wide">
      <div>
        <LinkButton
          icon={<ArrowLeft aria-hidden="true" className="size-4" />}
          size="sm"
          to="/held-events"
          variant="quiet"
        >
          開催履歴へ戻る
        </LinkButton>
      </div>

      <PageHeader
        eyebrow="開催記録"
        title={formatHeldEventDateTime(detail.heldAt)}
        description={`確定 ${detail.matchCount}試合・未完了 ${detail.draftCount}件。次は第${detail.nextMatchNo}試合です。`}
        actions={
          <>
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
            <LinkButton
              icon={<Keyboard aria-hidden="true" className="size-4" />}
              to={`/matches/new?heldEventId=${encodedHeldEventId}`}
              variant="secondary"
            >
              手入力
            </LinkButton>
            <LinkButton
              icon={<Camera aria-hidden="true" className="size-4" />}
              to={`/ocr/new?heldEventId=${encodedHeldEventId}`}
            >
              OCR取り込み
            </LinkButton>
          </>
        }
      />

      <Card className="flex flex-col gap-4 bg-[var(--color-surface-subtle)] p-4 md:flex-row md:items-center md:justify-between">
        <dl className="grid min-w-0 grid-cols-3 gap-5">
          <div>
            <dt className="momo-label text-[var(--color-text-secondary)]">確定済み</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{detail.matchCount}試合</dd>
          </div>
          <div>
            <dt className="momo-label text-[var(--color-text-secondary)]">未完了</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{detail.draftCount}件</dd>
          </div>
          <div>
            <dt className="momo-label text-[var(--color-text-secondary)]">次の番号</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">第{detail.nextMatchNo}試合</dd>
          </div>
        </dl>
        <nav aria-label="この開催の関連操作" className="flex shrink-0 flex-wrap gap-2">
          <LinkButton
            icon={<ListFilter aria-hidden="true" className="size-4" />}
            size="sm"
            to={`/matches?heldEventId=${encodedHeldEventId}&sort=match_no_asc`}
            variant="quiet"
          >
            試合検索で見る
          </LinkButton>
          <LinkButton
            icon={<Download aria-hidden="true" className="size-4" />}
            size="sm"
            to={`/exports?heldEventId=${encodedHeldEventId}&format=csv`}
            variant="quiet"
          >
            CSV出力
          </LinkButton>
        </nav>
      </Card>

      <HeldEventDraftsSection drafts={drafts} masterNames={masterNames} />
      <HeldEventPlayerRecap recaps={playerRecaps} />
      <HeldEventMatchTimeline
        heldEventId={detail.id}
        masterNames={masterNames}
        matches={matches}
        nextMatchNo={detail.nextMatchNo}
      />
    </PageFrame>
  );
}

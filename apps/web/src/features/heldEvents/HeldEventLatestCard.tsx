import { ListFilter, PenSquare, ScanLine } from "lucide-react";

import { formatDateTime } from "@/features/heldEvents/heldEventViewModel";
import type { HeldEventsPageController } from "@/features/heldEvents/useHeldEventsPageController";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { Card } from "@/shared/ui/layout/Card";

type HeldEventLatestCardProps = {
  latestEvent: HeldEventsPageController["latestEvent"];
};

export function HeldEventLatestCard({ latestEvent }: HeldEventLatestCardProps) {
  if (!latestEvent) {
    return null;
  }

  return (
    <Card className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div>
        <p className="text-xs font-semibold text-[var(--color-text-secondary)]">最新開催</p>
        <h2 className="mt-1 text-2xl font-semibold text-balance text-[var(--color-text-primary)]">
          {formatDateTime(latestEvent.heldAt)}
        </h2>
        <p className="momo-copy mt-2 text-sm text-[var(--color-text-secondary)]">
          現在 {latestEvent.matchCount.toLocaleString()}試合。次は第
          {(latestEvent.matchCount + 1).toLocaleString()}試合として記録します。
        </p>
      </div>
      <div className="flex flex-wrap gap-2 md:justify-end">
        <LinkButton icon={<ScanLine className="size-4" />} to="/ocr/new">
          OCR取り込み
        </LinkButton>
        <LinkButton icon={<PenSquare className="size-4" />} to="/matches/new" variant="secondary">
          手入力で作成
        </LinkButton>
        <LinkButton
          icon={<ListFilter className="size-4" />}
          to={`/matches?heldEventId=${encodeURIComponent(latestEvent.id)}`}
          variant="secondary"
        >
          この開催の試合
        </LinkButton>
      </div>
    </Card>
  );
}

import type { MatchDetailReadyView } from "@/features/matches/detail/matchDetailView";
import type { MatchNeighbor } from "@/shared/api/detailReadResult";
import { formatMatchNoInEvent } from "@/shared/domain/matchLabels";
import { formatNavigationDateTime } from "@/shared/lib/dateTime";
import { matchDetailHref } from "@/shared/navigation/publicIdentifiers";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";
import { AdjacentNavigation } from "@/shared/ui/navigation/AdjacentNavigation";

export function MatchDetailAdjacentNavigation({ view }: { view: MatchDetailReadyView }) {
  const { adjacent, adjacentState } = view.navigation;
  const previous = adjacent.kind === "available" ? adjacent.previous : undefined;
  const next = adjacent.kind === "available" ? adjacent.next : undefined;
  const peers = [view.match.playedAt, previous?.playedAt, next?.playedAt].filter(
    (value): value is string => value !== undefined,
  );
  const destination = (neighbor: MatchNeighbor | undefined, label: string) => ({
    label,
    description: neighbor
      ? `${formatNavigationDateTime(neighbor.playedAt, peers)}・${formatMatchNoInEvent(neighbor.matchNoInEvent)}${neighbor.heldAt === neighbor.playedAt ? "" : `（開催 ${formatNavigationDateTime(neighbor.heldAt)}）`}`
      : adjacent.kind === "available"
        ? `${label}はありません`
        : "前後情報を確認できません",
    href: neighbor ? matchDetailHref(neighbor.matchId, neighbor.publicId) : undefined,
  });
  return (
    <AdjacentNavigation
      label="前後の試合"
      previous={destination(previous, "前の試合")}
      next={destination(next, "後の試合")}
      disabled={adjacentState !== "current"}
      status={
        adjacentState === "pending" ? (
          <p role="status">前後の試合を確認しています。</p>
        ) : adjacentState === "current" ? undefined : (
          <Notice
            tone="warning"
            action={
              <Button size="sm" pending={view.refresh.pending} onClick={view.refresh.run}>
                前後の試合を再取得
              </Button>
            }
          >
            <p>
              {adjacentState === "unavailable"
                ? "前後移動を利用できません。再取得しても続く場合は画面を再読み込みしてください。"
                : "前後の試合を再確認できませんでした。表示中の結果は前回取得した内容です。"}
            </p>
          </Notice>
        )
      }
    />
  );
}

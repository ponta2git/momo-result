import { Award, ChevronRight, CircleHelp } from "lucide-react";

import { achievementStatusLabel } from "@/shared/achievements/achievementPresentation";
import type { PublishedAchievementPlayer } from "@/shared/achievements/achievementPresentation";
import { Button } from "@/shared/ui/actions/Button";
import { contentText } from "@/shared/ui/typography";

/** A collectible achievement and the action that opens its story share one touch target. */
export function AchievementStatusButton({
  name,
  displayName,
  player,
  onClick,
}: {
  name: string;
  displayName: string;
  player: PublishedAchievementPlayer | undefined;
  onClick: () => void;
}) {
  const achieved = player?.status === "achieved";
  const status = player ? achievementStatusLabel(player.status) : "達成状況は未取得";
  const action = player?.status === "not_recorded" ? "条件を見る" : "記録を見る";
  return (
    <Button
      variant="secondary"
      size="sm"
      aria-label={`${name}・${displayName}の${action}（${status}）`}
      onClick={onClick}
    >
      <span className="grid gap-2 text-left">
        <span className="flex items-center gap-2 whitespace-nowrap">
          {achieved ? (
            <Award aria-hidden="true" className="size-5 text-[var(--color-success)]" />
          ) : player?.status === "unconfirmed" ? (
            <CircleHelp aria-hidden="true" className="size-5" />
          ) : null}
          <span className={achieved ? contentText.compactPrimary : contentText.body}>{status}</span>
        </span>
        <span className="flex items-center justify-between gap-2 text-sm">
          {action}
          <ChevronRight aria-hidden="true" className="size-4" />
        </span>
      </span>
    </Button>
  );
}

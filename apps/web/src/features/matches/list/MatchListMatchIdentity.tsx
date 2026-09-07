import {
  formatCompactDateTime,
  formatGameSeason,
  formatMatchNo,
} from "@/features/matches/list/matchListFormat";
import type { MatchListItemView } from "@/features/matches/list/matchListTypes";
import { cn } from "@/shared/ui/cn";
import { contentText } from "@/shared/ui/typography";

type MatchListMatchIdentityProps = {
  item: MatchListItemView;
};

export function MatchListMatchIdentity({ item }: MatchListMatchIdentityProps) {
  return (
    <div className="grid gap-1">
      <div
        className={cn(
          contentText.supporting,
          "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5",
        )}
      >
        <span className="tabular-nums">{formatCompactDateTime(item.heldAt)}</span>
        <span className="min-w-0 truncate">
          {formatGameSeason(item.gameTitleName, item.seasonName)}
        </span>
      </div>
      <p className={cn(contentText.body, "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1")}>
        <span className="shrink-0">{formatMatchNo(item.matchNoInEvent)}</span>
        <span className="min-w-0 truncate">{item.mapName ?? "マップ未設定"}</span>
      </p>
      {item.hasNote ? <p className={contentText.supporting}>メモあり</p> : null}
    </div>
  );
}

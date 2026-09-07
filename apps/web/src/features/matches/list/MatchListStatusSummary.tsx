import type { MatchListItemView } from "@/features/matches/list/matchListTypes";
import { DraftStatusBadge } from "@/shared/matches/DraftStatusBadge";
import { contentText } from "@/shared/ui/typography";

type MatchListStatusSummaryProps = {
  item: MatchListItemView;
};

export function MatchListStatusSummary({ item }: MatchListStatusSummaryProps) {
  return (
    <div className="grid justify-items-start gap-2">
      <DraftStatusBadge announceChanges label={item.statusLabel} status={item.status} />
      {item.statusDescription ? <p className={contentText.body}>{item.statusDescription}</p> : null}
    </div>
  );
}

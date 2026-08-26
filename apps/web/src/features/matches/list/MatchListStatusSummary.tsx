import type { MatchListItemView } from "@/features/matches/list/matchListTypes";
import { DraftStatusBadge } from "@/shared/matches/DraftStatusBadge";

type MatchListStatusSummaryProps = {
  item: MatchListItemView;
};

export function MatchListStatusSummary({ item }: MatchListStatusSummaryProps) {
  return (
    <div className="grid justify-items-start gap-2">
      <DraftStatusBadge announceChanges label={item.statusLabel} status={item.status} />
      {item.statusDescription ? (
        <p className="text-xs leading-5 text-[var(--color-text-secondary)]">
          {item.statusDescription}
        </p>
      ) : null}
    </div>
  );
}

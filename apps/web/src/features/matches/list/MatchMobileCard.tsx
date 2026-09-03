import { MatchListExportLink } from "@/features/matches/list/MatchListExportLink";
import { MatchListMatchIdentity } from "@/features/matches/list/MatchListMatchIdentity";
import { MatchListRankSummary } from "@/features/matches/list/MatchListRankSummary";
import { MatchListResultLink } from "@/features/matches/list/MatchListResultLink";
import { MatchListStatusAction } from "@/features/matches/list/MatchListStatusAction";
import { MatchListStatusSummary } from "@/features/matches/list/MatchListStatusSummary";
import type {
  MatchListItemView,
  MatchListRowActions,
} from "@/features/matches/list/matchListTypes";

type MatchMobileCardProps = {
  item: MatchListItemView;
  rowActions: MatchListRowActions;
};

export function MatchMobileCard({ item, rowActions }: MatchMobileCardProps) {
  const actionsDisabled = rowActions.disabled ?? false;

  return (
    <article className="flex flex-col gap-4 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <MatchListMatchIdentity item={item} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <MatchListResultLink disabled={actionsDisabled} item={item} />
          <MatchListExportLink disabled={actionsDisabled} item={item} />
        </div>
      </div>

      <div>
        <MatchListStatusSummary item={item} />
      </div>

      <div>
        <MatchListRankSummary item={item} />
      </div>

      <div className="mt-auto">
        <MatchListStatusAction item={item} layout="stacked" rowActions={rowActions} />
      </div>
    </article>
  );
}

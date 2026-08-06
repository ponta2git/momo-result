import type { MatchListAction, MatchListItemView } from "@/features/matches/list/matchListTypes";
import { withReturnTo } from "@/shared/navigation/returnTo";

export function addMatchListReturnTo(item: MatchListItemView, returnTo: string): MatchListItemView {
  const next = {
    ...item,
    primaryAction: addActionReturnTo(item.primaryAction, returnTo),
    secondaryActions: item.secondaryActions.map((action) => addActionReturnTo(action, returnTo)),
  };
  if (next.detailHref) {
    next.detailHref = withReturnTo(next.detailHref, returnTo);
  }
  if (next.exportHref) {
    next.exportHref = withReturnTo(next.exportHref, returnTo);
  }
  if (next.reviewHref) {
    next.reviewHref = withReturnTo(next.reviewHref, returnTo);
  }
  return next;
}

function addActionReturnTo(action: MatchListAction, returnTo: string): MatchListAction {
  return action.href ? { ...action, href: withReturnTo(action.href, returnTo) } : action;
}

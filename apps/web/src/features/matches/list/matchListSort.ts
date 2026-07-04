import type { MatchListItemView, MatchListSort } from "@/features/matches/list/matchListTypes";
import { matchListStatusPriority } from "@/features/matches/list/matchListStatusPolicy";

function dateValue(value: string | undefined): number {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function matchNoValue(item: MatchListItemView): number {
  return item.matchNoInEvent ?? Number.MAX_SAFE_INTEGER;
}

function compareByPrimarySort(
  left: MatchListItemView,
  right: MatchListItemView,
  sort: MatchListSort,
): number {
  switch (sort) {
    case "match_no_asc":
      return matchNoValue(left) - matchNoValue(right);
    case "held_desc":
      return dateValue(right.heldAt) - dateValue(left.heldAt);
    case "held_asc":
      return dateValue(left.heldAt) - dateValue(right.heldAt);
    case "status_priority":
      return matchListStatusPriority[left.status] - matchListStatusPriority[right.status];
    case "updated_desc":
      return 0;
  }
}

export function sortMatchListItems(
  items: MatchListItemView[],
  sort: MatchListSort,
): MatchListItemView[] {
  return items.toSorted((left, right) => {
    const primaryDiff = compareByPrimarySort(left, right, sort);
    return primaryDiff === 0 ? dateValue(right.updatedAt) - dateValue(left.updatedAt) : primaryDiff;
  });
}

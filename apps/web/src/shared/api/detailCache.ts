import type { QueryFilters } from "@tanstack/react-query";

import { heldEventKeys, matchKeys } from "@/shared/api/queryKeys";

/** Both route namespaces can cache one record; mutations always identify its legacy ID. */
export function matchDetailCacheFilter(matchId: string) {
  return detailCacheFilter(matchKeys.detailRoot(), matchId, "matchId");
}

export function heldEventDetailCacheFilter(heldEventId: string) {
  return detailCacheFilter(heldEventKeys.detailRoot(), heldEventId, "id");
}

function detailCacheFilter(
  rootKey: readonly string[],
  legacyId: string,
  identityField: "matchId" | "id",
) {
  return {
    queryKey: rootKey,
    predicate: ({ queryKey, state }) => {
      if (queryKey[2] === legacyId) return true;
      const data = state.data;
      if (typeof data !== "object" || data === null || !("detail" in data)) return false;
      const detail = data.detail;
      return (
        typeof detail === "object" &&
        detail !== null &&
        identityField in detail &&
        Reflect.get(detail, identityField) === legacyId
      );
    },
  } satisfies QueryFilters;
}

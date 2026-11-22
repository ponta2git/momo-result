import type { QueryFilters } from "@tanstack/react-query";

import { heldEventKeys, matchKeys } from "@/shared/api/queryKeys";

/** Both route namespaces can cache one record; mutations always identify its legacy ID. */
export function matchDetailCacheFilter(matchId: string) {
  return detailCacheFilter(matchKeys.detailRoot(), matchId, "matchId");
}

export function heldEventDetailCacheFilter(heldEventId: string) {
  return detailCacheFilter(heldEventKeys.detailRoot(), heldEventId, "id");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
      if (!isRecord(data)) return false;
      const value = data["value"];
      const detail = data["detail"] ?? (isRecord(value) ? (value["event"] ?? value) : undefined);
      return isRecord(detail) && detail[identityField] === legacyId;
    },
  } satisfies QueryFilters;
}

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { orderAchievementItems } from "@/shared/achievements/achievementPresentation";
import { useAchievementPublication } from "@/shared/achievements/useAchievementPublication";
import { achievementCatalogQueryOptions } from "@/shared/api/achievementQueryOptions";
import { gameTitlesQueryOptions } from "@/shared/api/queryOptions";
import { usePermissionFacts } from "@/shared/auth/useAuthorization";

export function useAchievementsPage() {
  const [search, setSearch] = useSearchParams();
  const [showRetired, setShowRetired] = useState(false);
  const [editingClaimId, setEditingClaimId] = useState<string>();
  const operations = usePermissionFacts("operations");
  const titles = useQuery(gameTitlesQueryOptions());
  const gameTitleId = search.get("gameTitleId") ?? titles.data?.items?.[0]?.id;
  const mapMasterId = search.get("mapMasterId") ?? "";
  const publication = useAchievementPublication(gameTitleId);
  const catalog = useQuery(achievementCatalogQueryOptions(gameTitleId));
  const data = publication.data;
  const titleChanged = Boolean(data && data.gameTitleId !== gameTitleId);
  const invalidMap = Boolean(
    data && mapMasterId && !data.maps.some((map) => map.mapMasterId === mapMasterId),
  );
  const summary = data?.summaries.find((entry) => (entry.mapMasterId ?? "") === mapMasterId);
  const items = data
    ? orderAchievementItems(
        data.items.filter(
          (item) =>
            item.retired === showRetired &&
            (!mapMasterId || item.common || item.mapMasterIds.includes(mapMasterId)),
        ),
        data.maps,
      )
    : [];
  const selectedItem = data?.items.find(
    (item) => item.achievementId === search.get("achievementId"),
  );
  const selectedPlayer = selectedItem?.players.find(
    (player) => player.memberId === search.get("memberId"),
  );
  const editingClaim = catalog.data?.claims.find((claim) => claim.claimId === editingClaimId);
  const editingItem = catalog.data?.items.find(
    (item) => item.achievementId === editingClaim?.achievementId,
  );
  const refreshing =
    publication.status.isFetching || publication.resource.isFetching || titles.isFetching;

  const changeSelection = (key: "gameTitleId" | "mapMasterId", value: string) => {
    setSearch((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key === "gameTitleId") next.delete("mapMasterId");
      next.delete("achievementId");
      next.delete("memberId");
      return next;
    });
  };
  const closeDetails = () =>
    setSearch((previous) => {
      const next = new URLSearchParams(previous);
      next.delete("achievementId");
      next.delete("memberId");
      return next;
    });
  const editClaim = (claimId: string) => {
    closeDetails();
    setEditingClaimId(claimId);
  };
  const refresh = () => {
    void Promise.all([titles.refetch(), catalog.refetch(), publication.refresh()]).catch(
      () => undefined,
    );
  };

  return {
    setSearch,
    showRetired,
    setShowRetired,
    editingClaimId,
    setEditingClaimId,
    operations,
    titles,
    gameTitleId,
    mapMasterId,
    publication,
    catalog,
    data,
    titleChanged,
    invalidMap,
    summary,
    items,
    selectedItem,
    selectedPlayer,
    editingClaim,
    editingItem,
    refreshing,
    changeSelection,
    closeDetails,
    editClaim,
    refresh,
  };
}

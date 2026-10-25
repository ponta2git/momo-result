import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useAchievementPublication } from "@/shared/achievements/useAchievementPublication";
import { achievementCatalogQueryOptions } from "@/shared/api/achievementQueryOptions";
import { gameTitlesQueryOptions } from "@/shared/api/queryOptions";
import { usePermissionFacts } from "@/shared/auth/useAuthorization";
import { canonicalResultMembers } from "@/shared/domain/members";

export function useAchievementsPage() {
  const [search, setSearch] = useSearchParams();
  const [editingClaimId, setEditingClaimId] = useState<string>();
  const operations = usePermissionFacts("operations");
  const titles = useQuery(gameTitlesQueryOptions());
  const gameTitleId = search.get("gameTitleId") ?? titles.data?.items?.[0]?.id;
  const publication = useAchievementPublication(gameTitleId);
  const catalog = useQuery(achievementCatalogQueryOptions(gameTitleId));
  const data = publication.data;
  const titleChanged = Boolean(data && data.gameTitleId !== gameTitleId);
  const summary = data?.summaries.find((entry) => entry.mapMasterId === null);
  // Published definitions keep their points and stars in sync. Catalog-only items
  // remain reachable for corrections without inventing an unpublished result.
  const allItems = [
    ...(data?.items ?? []),
    ...(catalog.data?.items ?? [])
      .filter(
        (item) => !data?.items.some((published) => published.achievementId === item.achievementId),
      )
      .map((item) => ({ ...item, retired: Boolean(item.retiredAt), players: [] })),
  ];
  const items = allItems.filter((item) => !item.retired);
  const maps = data?.maps ?? catalog.data?.maps ?? [];
  const selectedItem = allItems.find((item) => item.achievementId === search.get("achievementId"));
  const selectedMember =
    canonicalResultMembers.find((member) => member.memberId === search.get("memberId")) ??
    canonicalResultMembers[0];
  const editingClaim = catalog.data?.claims.find((claim) => claim.claimId === editingClaimId);
  const editingItem = catalog.data?.items.find(
    (item) => item.achievementId === editingClaim?.achievementId,
  );
  const refreshing =
    publication.status.isFetching ||
    publication.resource.isFetching ||
    catalog.isFetching ||
    titles.isFetching;

  const changeTitle = (value: string) => {
    setSearch((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set("gameTitleId", value);
      else next.delete("gameTitleId");
      next.delete("mapMasterId");
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
  const changeMember = (memberId: string) =>
    setSearch(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set("memberId", memberId);
        return next;
      },
      { replace: true },
    );
  const editClaim = (claimId: string) => {
    setEditingClaimId(claimId);
  };
  const refresh = () => {
    void Promise.all([titles.refetch(), catalog.refetch(), publication.refresh()]).catch(
      () => undefined,
    );
  };

  return {
    setSearch,
    editingClaimId,
    setEditingClaimId,
    operations,
    titles,
    gameTitleId,
    publication,
    catalog,
    data,
    titleChanged,
    summary,
    items,
    maps,
    selectedItem,
    selectedMember,
    changeMember,
    editingClaim,
    editingItem,
    refreshing,
    changeTitle,
    closeDetails,
    editClaim,
    refresh,
  };
}

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useAchievementPublication } from "@/shared/achievements/useAchievementPublication";
import { achievementCatalogQueryOptions } from "@/shared/api/achievementQueryOptions";
import type { AchievementItem } from "@/shared/api/achievements";
import { gameTitlesQueryOptions } from "@/shared/api/queryOptions";
import { usePermissionFacts } from "@/shared/auth/useAuthorization";
import { canonicalResultMembers } from "@/shared/domain/members";

export function useAchievementsPage() {
  const [search, setSearch] = useSearchParams();
  const [editingClaimId, setEditingClaimId] = useState<string>();
  const [newRecord, setNewRecord] = useState<{ item: AchievementItem; memberId: string }>();
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
  const allItems = useMemo(() => {
    const publishedIds = new Set(data?.items.map((item) => item.achievementId));
    return [
      ...(data?.items ?? []),
      ...(catalog.data?.items ?? [])
        .filter((item) => !publishedIds.has(item.achievementId))
        .map((item) => ({ ...item, retired: Boolean(item.retiredAt), players: [] })),
    ];
  }, [data?.items, catalog.data?.items]);
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
  const refreshing = publication.refreshing || catalog.isFetching || titles.isFetching;

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
  const openDetails = (achievementId: string) =>
    setSearch((previous) => {
      const next = new URLSearchParams(previous);
      if (gameTitleId) next.set("gameTitleId", gameTitleId);
      next.set("achievementId", achievementId);
      next.delete("memberId");
      return next;
    });
  const editClaim = (claimId: string) => {
    setEditingClaimId(claimId);
  };
  const recordAchievement = () => {
    const item = catalog.data?.items.find(
      (value) => value.achievementId === selectedItem?.achievementId,
    );
    if (item && item.ruleKind === "manual" && !item.retiredAt && selectedMember)
      setNewRecord({ item, memberId: selectedMember.memberId });
  };
  const refresh = () => {
    void Promise.all([titles.refetch(), catalog.refetch(), publication.refresh()]).catch(
      () => undefined,
    );
  };

  return {
    editingClaimId,
    closeCorrection: () => setEditingClaimId(undefined),
    newRecord,
    closeNewRecord: () => setNewRecord(undefined),
    recordAchievement,
    operations,
    titles: titles.data?.items ?? [],
    titlesLoading: titles.isLoading,
    titlesFailed: titles.isError,
    gameTitleId,
    publication,
    catalog: catalog.data,
    catalogLoading: catalog.isLoading,
    catalogFailed: catalog.isError,
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
    openDetails,
    editClaim,
    refresh,
  };
}

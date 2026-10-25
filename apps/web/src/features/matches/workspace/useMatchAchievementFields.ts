import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import type { MatchAchievementSelection } from "@/features/matches/workspace/matchAchievementSelection";
import type { MatchSetupValues } from "@/features/matches/workspace/matchFormTypes";
import { achievementCatalogQueryOptions } from "@/shared/api/achievementQueryOptions";
import type { AchievementItem } from "@/shared/api/achievements";

export type MatchAchievementFieldsProps = {
  setup: Readonly<MatchSetupValues>;
  values: readonly MatchAchievementSelection[];
  disabled: boolean;
  onChange: (values: MatchAchievementSelection[]) => void;
};

const recordKey = (achievementId: string, memberId: string) =>
  JSON.stringify([achievementId, memberId]);

export function useMatchAchievementFields({
  setup,
  values,
  onChange,
}: MatchAchievementFieldsProps) {
  const [open, setOpen] = useState(values.length > 0);
  const catalog = useQuery(achievementCatalogQueryOptions(setup.gameTitleId || undefined));
  const catalogItems = useMemo(
    () => new Map(catalog.data?.items.map((item) => [item.achievementId, item])),
    [catalog.data?.items],
  );
  const directClaims = useMemo(
    () =>
      new Map(
        catalog.data?.claims
          .filter((claim) => claim.sourceKind === "direct")
          .map((claim) => [recordKey(claim.achievementId, claim.memberId), claim]),
      ),
    [catalog.data?.claims],
  );
  const selectedKeys = useMemo(
    () => new Set(values.map((entry) => recordKey(entry.achievementId, entry.memberId))),
    [values],
  );
  const applicable = (item: AchievementItem) =>
    !item.retiredAt &&
    item.ruleKind === "manual" &&
    (item.common || item.mapMasterIds.includes(setup.mapMasterId));
  const items = catalog.data?.items.filter(applicable) ?? [];
  const directClaim = (achievementId: string, memberId: string) =>
    directClaims.get(recordKey(achievementId, memberId));
  const isSelected = (achievementId: string, memberId: string) =>
    selectedKeys.has(recordKey(achievementId, memberId));
  const outdated = values.flatMap((selection) => {
    if (!catalog.data) return [];
    const item = catalogItems.get(selection.achievementId);
    const claim = directClaim(selection.achievementId, selection.memberId);
    if (
      item &&
      applicable(item) &&
      item.version === selection.expectedItemVersion &&
      (claim?.version ?? null) === selection.expectedClaimVersion
    )
      return [];
    return [
      {
        selection,
        currentItem: item && applicable(item) && claim?.state !== "achieved" ? item : undefined,
      },
    ];
  });
  const remove = (achievementId: string, memberId: string) =>
    onChange(
      values.filter(
        (entry) => entry.achievementId !== achievementId || entry.memberId !== memberId,
      ),
    );
  const add = (item: AchievementItem, memberId: string) =>
    onChange([
      ...values.filter(
        (entry) => entry.achievementId !== item.achievementId || entry.memberId !== memberId,
      ),
      {
        achievementId: item.achievementId,
        achievementName: item.name,
        memberId: memberId as MatchAchievementSelection["memberId"],
        expectedItemVersion: item.version,
        expectedClaimVersion: directClaim(item.achievementId, memberId)?.version ?? null,
      },
    ]);
  return {
    open,
    setOpen,
    loading: catalog.isLoading,
    refreshing: catalog.isFetching,
    failed: catalog.isError,
    hasCatalog: Boolean(catalog.data),
    refresh: () => void catalog.refetch(),
    items,
    directClaim,
    isSelected,
    outdated,
    remove,
    add,
  };
}

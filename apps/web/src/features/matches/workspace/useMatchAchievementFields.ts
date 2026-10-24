import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { MatchAchievementSelection } from "@/features/matches/workspace/matchAchievementSelection";
import type { MatchSetupValues } from "@/features/matches/workspace/matchFormTypes";
import { achievementJapanDate } from "@/shared/achievements/achievementDates";
import { orderAchievementItems } from "@/shared/achievements/achievementPresentation";
import { achievementCatalogQueryOptions } from "@/shared/api/achievementQueryOptions";
import type { AchievementItem } from "@/shared/api/achievements";

export type MatchAchievementFieldsProps = {
  setup: Readonly<MatchSetupValues>;
  values: readonly MatchAchievementSelection[];
  disabled: boolean;
  onChange: (values: MatchAchievementSelection[]) => void;
};

export function useMatchAchievementFields({
  setup,
  values,
  onChange,
}: MatchAchievementFieldsProps) {
  const [open, setOpen] = useState(values.length > 0);
  const catalog = useQuery(achievementCatalogQueryOptions(setup.gameTitleId || undefined));
  const playedDate = achievementJapanDate(setup.playedAt);
  const applicable = (item: AchievementItem) =>
    !item.retiredAt &&
    item.ruleKind === "manual" &&
    (item.common || item.mapMasterIds.includes(setup.mapMasterId)) &&
    Boolean(playedDate && (!item.appliesFrom || playedDate >= item.appliesFrom));
  const items = catalog.data
    ? orderAchievementItems(catalog.data.items.filter(applicable), catalog.data.maps)
    : [];
  const directClaim = (achievementId: string, memberId: string) =>
    catalog.data?.claims.find(
      (claim) =>
        claim.achievementId === achievementId &&
        claim.memberId === memberId &&
        claim.sourceKind === "direct",
    );
  const outdated = values.filter((selection) => {
    const item = catalog.data?.items.find(
      (value) => value.achievementId === selection.achievementId,
    );
    const claim = directClaim(selection.achievementId, selection.memberId);
    return Boolean(
      catalog.data &&
      (!item ||
        !applicable(item) ||
        item.version !== selection.expectedItemVersion ||
        (claim?.version ?? null) !== selection.expectedClaimVersion),
    );
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
  return { open, setOpen, catalog, applicable, items, directClaim, outdated, remove, add };
}

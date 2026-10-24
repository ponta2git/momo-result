import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { AchievementItem } from "@/shared/api/achievements";
import { matchListQueryOptions } from "@/shared/api/queryOptions";

export function useAchievementMatchPicker(item: AchievementItem) {
  const [cursor, setCursor] = useState<string>();
  const matches = useQuery(
    matchListQueryOptions({
      gameTitleId: item.gameTitleId,
      status: "confirmed",
      kind: "match",
      sort: "held_asc",
      pageSize: 20,
      ...(cursor ? { cursor } : {}),
    }),
  );
  const pagination = matches.data?.pagination;
  return { setCursor, matches, pagination };
}

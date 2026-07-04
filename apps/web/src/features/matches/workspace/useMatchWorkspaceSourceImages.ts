import { useMemo } from "react";

import { toSourceImageDescriptor } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import type { SourceImageItem } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import type { MatchDraftSourceImageResponse } from "@/shared/api/matchDrafts";

export function useMatchWorkspaceSourceImages({
  items,
  matchDraftId,
}: {
  items: MatchDraftSourceImageResponse[] | undefined;
  matchDraftId: string | undefined;
}): SourceImageItem[] {
  return useMemo(() => {
    if (matchDraftId === undefined) {
      return [];
    }
    return (items ?? []).flatMap((item) => {
      const descriptor = toSourceImageDescriptor(matchDraftId, item);
      return descriptor ? [descriptor] : [];
    });
  }, [items, matchDraftId]);
}

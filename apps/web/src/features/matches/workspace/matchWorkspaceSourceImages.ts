import { toSourceImageDescriptor } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import type { SourceImageItem } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import type { MatchDraftSourceImageResponse } from "@/shared/api/matchDrafts";

export function buildMatchWorkspaceSourceImages(
  items: MatchDraftSourceImageResponse[] | undefined,
  matchDraftId: string | undefined,
): SourceImageItem[] {
  if (matchDraftId === undefined) return [];
  return (items ?? []).flatMap((item) => {
    const descriptor = toSourceImageDescriptor(matchDraftId, item);
    return descriptor ? [descriptor] : [];
  });
}

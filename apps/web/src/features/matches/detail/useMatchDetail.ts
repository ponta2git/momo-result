import { useParams } from "react-router-dom";

import { buildMatchDetailView } from "@/features/matches/detail/matchDetailView";
import type { MatchDetailView } from "@/features/matches/detail/matchDetailView";
import { useMatchAnalysis } from "@/features/matches/detail/useMatchAnalysis";
import { useMatchDeletion } from "@/features/matches/detail/useMatchDeletion";
import { useMatchDetailResource } from "@/features/matches/detail/useMatchDetailResource";

/** Composes route data and feature controls into the detail view. */
export function useMatchDetail(): MatchDetailView {
  const { matchId = "", publicId } = useParams<{ matchId: string; publicId: string }>();
  const resource = useMatchDetailResource(matchId, publicId);
  const analysis = useMatchAnalysis(resource.detail);
  const deletion = useMatchDeletion({
    heldEventId: resource.detail?.heldEventId,
    heldEventPublicId: resource.detail?.heldEventPublicId,
    matchId: resource.detail?.matchId ?? matchId,
  });
  return buildMatchDetailView({
    matchId: publicId ?? matchId,
    ...resource,
    analysis,
    deletion,
  });
}

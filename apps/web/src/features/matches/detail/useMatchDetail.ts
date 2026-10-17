import { useParams } from "react-router-dom";

import { buildMatchDetailView } from "@/features/matches/detail/matchDetailView";
import type { MatchDetailView } from "@/features/matches/detail/matchDetailView";
import { useMatchAnalysis } from "@/features/matches/detail/useMatchAnalysis";
import { useMatchDeletion } from "@/features/matches/detail/useMatchDeletion";
import { useMatchDetailResource } from "@/features/matches/detail/useMatchDetailResource";

/** Composes route data and feature controls into the detail view. */
export function useMatchDetail(): MatchDetailView {
  const { matchId = "" } = useParams<{ matchId: string }>();
  const resource = useMatchDetailResource(matchId);
  const analysis = useMatchAnalysis(resource.detail);
  const deletion = useMatchDeletion({ heldEventId: resource.detail?.heldEventId, matchId });
  return buildMatchDetailView({
    matchId,
    ...resource,
    analysis,
    deletion,
  });
}

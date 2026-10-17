import { useParams } from "react-router-dom";

import { buildMatchDetailPageModel } from "@/features/matches/detail/matchDetailPageModel";
import type { MatchDetailPageModel } from "@/features/matches/detail/matchDetailPageModel";
import { useMatchAnalysis } from "@/features/matches/detail/useMatchAnalysis";
import { useMatchDeletionCommand } from "@/features/matches/detail/useMatchDeletionCommand";
import { useMatchDetailResource } from "@/features/matches/detail/useMatchDetailResource";

/** Composes the route's read, analysis, deletion, and note owners into a pure screen result. */
export function useMatchDetailPageModel(): MatchDetailPageModel {
  const { matchId = "" } = useParams<{ matchId: string }>();
  const read = useMatchDetailResource(matchId);
  const analysis = useMatchAnalysis(read.detail);
  const deletion = useMatchDeletionCommand({ heldEventId: read.detail?.heldEventId, matchId });
  return buildMatchDetailPageModel({
    matchId,
    ...read,
    analysis,
    deletion,
  });
}

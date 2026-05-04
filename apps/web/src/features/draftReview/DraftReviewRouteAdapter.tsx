import { useParams } from "react-router-dom";

import { MatchWorkspacePage } from "@/features/matches/workspace/MatchWorkspacePage";

export function DraftReviewRouteAdapter() {
  const { matchSessionId = "" } = useParams<{ matchSessionId: string }>();

  return (
    <MatchWorkspacePage
      matchDraftId={matchSessionId}
      matchSessionId={matchSessionId}
      mode="review"
    />
  );
}

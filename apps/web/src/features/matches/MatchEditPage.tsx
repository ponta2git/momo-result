import { useParams } from "react-router-dom";

import { MatchWorkspacePage } from "@/features/matches/workspace/MatchWorkspacePage";
import { useMatchEditPrefetch } from "@/features/matches/workspace/useMatchEditPrefetch";

export function MatchEditPage() {
  const { matchId = "" } = useParams<{ matchId: string }>();
  useMatchEditPrefetch(matchId);

  return <MatchWorkspacePage matchId={matchId} mode="edit" />;
}

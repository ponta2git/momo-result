import { useParams } from "react-router-dom";

import { MatchWorkspacePage } from "@/features/matches/workspace/MatchWorkspacePage";

export function MatchEditPage() {
  const { matchId = "" } = useParams<{ matchId: string }>();

  return <MatchWorkspacePage matchId={matchId} mode="edit" />;
}

import { useSearchParams } from "react-router-dom";

import { MatchWorkspacePage } from "@/features/matches/workspace/MatchWorkspacePage";

export function MatchCreatePage() {
  const [searchParams] = useSearchParams();
  const matchDraftId = searchParams.get("matchDraftId") ?? undefined;

  return <MatchWorkspacePage mode="create" {...(matchDraftId ? { matchDraftId } : {})} />;
}

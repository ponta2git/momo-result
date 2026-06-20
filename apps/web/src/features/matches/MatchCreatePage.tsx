import { useSearchParams } from "react-router-dom";

import { MatchWorkspacePage } from "@/features/matches/workspace/MatchWorkspacePage";
import { trimSearchParam } from "@/shared/lib/searchParams";

export function MatchCreatePage() {
  const [searchParams] = useSearchParams();
  const matchDraftId = trimSearchParam(searchParams.get("matchDraftId"));

  return <MatchWorkspacePage mode="create" {...(matchDraftId ? { matchDraftId } : {})} />;
}

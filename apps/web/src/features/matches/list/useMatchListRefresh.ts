import { useEffect, useRef, useState } from "react";

import type {
  MatchListRefreshFailure,
  MatchListRefreshResult,
} from "@/features/matches/list/matchListRefresh";
import { buildMatchListSearchParams } from "@/features/matches/list/matchListSearchParams";
import type { MatchListSearch } from "@/features/matches/list/matchListTypes";

/** Owns one manual refresh, including its lifetime and selection-scoped failure feedback. */
export function useMatchListRefresh(
  search: MatchListSearch,
  applyResult: (result: MatchListRefreshResult) => MatchListRefreshFailure | null,
) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<MatchListRefreshFailure | null>(null);
  const refreshInFlightRef = useRef(false);
  const refreshGenerationRef = useRef(0);
  const selectionKey = buildMatchListSearchParams(search).toString();

  if (failure && failure.scope !== selectionKey) setFailure(null);

  useEffect(() => {
    const currentGeneration = refreshGenerationRef.current;
    return () => {
      if (refreshGenerationRef.current === currentGeneration) refreshGenerationRef.current += 1;
    };
  }, []);

  const run = async (read: () => Promise<MatchListRefreshResult>) => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setPending(true);
    const refreshGeneration = refreshGenerationRef.current;
    try {
      const result = await read();
      if (refreshGenerationRef.current === refreshGeneration) setFailure(applyResult(result));
    } catch {
      if (refreshGenerationRef.current === refreshGeneration) {
        setFailure({ scope: selectionKey });
      }
    } finally {
      refreshInFlightRef.current = false;
      if (refreshGenerationRef.current === refreshGeneration) setPending(false);
    }
  };

  return { pending, failed: failure?.scope === selectionKey, run };
}

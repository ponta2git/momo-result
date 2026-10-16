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
  const running = useRef(false);
  const generation = useRef(0);
  const scope = buildMatchListSearchParams(search).toString();

  if (failure && failure.originScope !== scope && failure.targetScope !== scope) setFailure(null);

  useEffect(() => {
    const currentGeneration = generation.current;
    return () => {
      if (generation.current === currentGeneration) generation.current += 1;
    };
  }, []);

  const run = async (read: () => Promise<MatchListRefreshResult>) => {
    if (running.current) return;
    running.current = true;
    setPending(true);
    const refreshGeneration = generation.current;
    try {
      const result = await read();
      if (generation.current === refreshGeneration) setFailure(applyResult(result));
    } catch {
      if (generation.current === refreshGeneration) {
        setFailure({ originScope: scope, targetScope: scope });
      }
    } finally {
      running.current = false;
      if (generation.current === refreshGeneration) setPending(false);
    }
  };

  return { pending, failed: failure?.targetScope === scope, run };
}

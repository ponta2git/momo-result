import { useLocation, useNavigationType } from "react-router-dom";

import type { MatchRecordMethod } from "@/shared/navigation/matchLinks";

/**
 * The confirm flow hands the detail page one fact: this visit is the moment the match was
 * confirmed, recorded with the given method. Router state carries it on the pushed history entry.
 */
export type ConfirmedArrival = {
  readonly matchId: string;
  readonly recordedWith: MatchRecordMethod;
};

export function confirmedArrivalState(arrival: ConfirmedArrival) {
  return { confirmedArrival: arrival } as const;
}

export function readConfirmedArrival(
  state: unknown,
  matchId: string | undefined,
): ConfirmedArrival | undefined {
  if (state === null || typeof state !== "object" || !("confirmedArrival" in state)) return;
  const arrival: unknown = state.confirmedArrival;
  if (
    matchId !== undefined &&
    arrival !== null &&
    typeof arrival === "object" &&
    "matchId" in arrival &&
    arrival.matchId === matchId &&
    "recordedWith" in arrival &&
    (arrival.recordedWith === "ocr" || arrival.recordedWith === "manual")
  ) {
    return { matchId, recordedWith: arrival.recordedWith };
  }
  return undefined;
}

/**
 * Only the push from the confirm flow is the moment. Reloads, back and forward restore the same
 * entry as a POP, so the moment is not replayed when someone revisits the result.
 */
export function useConfirmedArrival(matchId: string | undefined): ConfirmedArrival | undefined {
  const location = useLocation();
  const navigationType = useNavigationType();
  return navigationType === "PUSH" ? readConfirmedArrival(location.state, matchId) : undefined;
}

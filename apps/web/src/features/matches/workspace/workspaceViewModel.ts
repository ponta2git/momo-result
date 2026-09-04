import type { HeldEventResponse } from "@/shared/api/heldEvents";

export function latestHeldEventPatch(
  heldEvents: readonly HeldEventResponse[],
): { heldEventId: string; matchNoInEvent: number; playedAt: string } | undefined {
  const latest = heldEvents.toSorted(
    (left, right) => new Date(right.heldAt).getTime() - new Date(left.heldAt).getTime(),
  )[0];
  if (!latest) {
    return undefined;
  }
  return heldEventPatch(latest);
}

export function heldEventPatchById(
  heldEvents: readonly HeldEventResponse[],
  heldEventId: string | undefined,
): { heldEventId: string; matchNoInEvent: number; playedAt: string } | undefined {
  if (!heldEventId) {
    return undefined;
  }
  const heldEvent = heldEvents.find((event) => event.id === heldEventId);
  return heldEvent ? heldEventPatch(heldEvent) : undefined;
}

function heldEventPatch(heldEvent: HeldEventResponse): {
  heldEventId: string;
  matchNoInEvent: number;
  playedAt: string;
} {
  return {
    heldEventId: heldEvent.id,
    matchNoInEvent: heldEvent.nextMatchNo,
    playedAt: heldEvent.heldAt,
  };
}

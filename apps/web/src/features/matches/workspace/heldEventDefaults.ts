import type { HeldEventResponse } from "@/shared/api/heldEvents";

export function latestHeldEventDefaults(
  heldEvents: readonly HeldEventResponse[],
): { heldEventId: string; matchNoInEvent: number; playedAt: string } | undefined {
  const latest = heldEvents.toSorted(
    (left, right) => new Date(right.heldAt).getTime() - new Date(left.heldAt).getTime(),
  )[0];
  if (!latest) {
    return undefined;
  }
  return heldEventDefaults(latest);
}

export function heldEventDefaultsById(
  heldEvents: readonly HeldEventResponse[],
  heldEventId: string | undefined,
): { heldEventId: string; matchNoInEvent: number; playedAt: string } | undefined {
  if (!heldEventId) {
    return undefined;
  }
  const heldEvent = heldEvents.find((event) => event.id === heldEventId);
  return heldEvent ? heldEventDefaults(heldEvent) : undefined;
}

function heldEventDefaults(heldEvent: HeldEventResponse): {
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

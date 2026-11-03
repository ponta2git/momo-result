import type { HeldEventResponse } from "@/shared/api/heldEvents";

/** Without a held event to start from, a record starts in the newest one. */
export function latestHeldEvent(
  heldEvents: readonly HeldEventResponse[],
): HeldEventResponse | undefined {
  return heldEvents.toSorted(
    (left, right) => new Date(right.heldAt).getTime() - new Date(left.heldAt).getTime(),
  )[0];
}

export function latestHeldEventDefaults(
  heldEvents: readonly HeldEventResponse[],
): { heldEventId: string; matchNoInEvent: number; playedAt: string } | undefined {
  const latest = latestHeldEvent(heldEvents);
  return latest ? heldEventDefaults(latest) : undefined;
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

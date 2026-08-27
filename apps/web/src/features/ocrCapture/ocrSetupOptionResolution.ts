import type { SetupFormValues } from "@/features/ocrCapture/schema";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import type {
  GameTitleResponse,
  MapMasterResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";

export type HeldEventContextState = "idle" | "pending" | "resolved" | "notFound" | "failed";

export function resolveHeldEventContext(input: {
  detailErrorStatus?: number | undefined;
  detailFailed: boolean;
  directoryFailed: boolean;
  enabled: boolean;
  fetching: boolean;
  selected: boolean;
  selectedId?: string | undefined;
}): HeldEventContextState {
  if (!input.enabled || !input.selectedId) return "idle";
  if (input.selected) return "resolved";
  if (input.fetching) return "pending";
  if (input.detailErrorStatus === 404) return "notFound";
  if (input.detailFailed || input.directoryFailed) return "failed";
  // A completed lookup without a resource or authoritative 404 is still a failed resolution.
  return "failed";
}

export function sameSetupValue(left: SetupFormValues, right: SetupFormValues): boolean {
  return (
    left.gameTitleId === right.gameTitleId &&
    left.heldEventId === right.heldEventId &&
    left.mapMasterId === right.mapMasterId &&
    left.matchNoInEvent === right.matchNoInEvent &&
    left.ownerMemberId === right.ownerMemberId &&
    left.seasonMasterId === right.seasonMasterId
  );
}

export function deriveValidSetupValue(args: {
  gameTitles: GameTitleResponse[];
  heldEventNotFound: boolean;
  heldEvents: HeldEventResponse[];
  mapMasters: MapMasterResponse[];
  seasonMasters: SeasonMasterResponse[];
  value: SetupFormValues;
}): SetupFormValues {
  const { gameTitles, heldEventNotFound, heldEvents, mapMasters, seasonMasters, value } = args;
  let next = value;
  const patch = (partial: Partial<SetupFormValues>) => {
    next = { ...next, ...partial };
  };

  if (next.heldEventId) {
    const selectedHeldEvent = heldEvents.find((event) => event.id === next.heldEventId);
    if (heldEventNotFound) {
      patch({ heldEventId: "", matchNoInEvent: undefined });
    } else if (selectedHeldEvent && (!next.matchNoInEvent || next.matchNoInEvent < 1)) {
      patch({ matchNoInEvent: selectedHeldEvent.nextMatchNo });
    }
  }

  if (next.gameTitleId) {
    const stillValid = gameTitles.some((gameTitle) => gameTitle.id === next.gameTitleId);
    const first = gameTitles[0];
    if (!stillValid && first) {
      patch({ gameTitleId: first.id, mapMasterId: "", seasonMasterId: "" });
    }
  } else {
    const fallback = gameTitles[0];
    if (fallback) patch({ gameTitleId: fallback.id });
  }

  if (next.gameTitleId) {
    const firstMap = mapMasters.find((item) => item.gameTitleId === next.gameTitleId);
    const mapStillValid = mapMasters.some(
      (item) => item.id === next.mapMasterId && item.gameTitleId === next.gameTitleId,
    );
    if (!mapStillValid && firstMap) patch({ mapMasterId: firstMap.id });

    const firstSeason = seasonMasters.find((item) => item.gameTitleId === next.gameTitleId);
    const seasonStillValid = seasonMasters.some(
      (item) => item.id === next.seasonMasterId && item.gameTitleId === next.gameTitleId,
    );
    if (!seasonStillValid && firstSeason) patch({ seasonMasterId: firstSeason.id });
  }

  return next;
}

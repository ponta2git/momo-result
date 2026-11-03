import { ocrSetupSchema } from "@/features/ocrCapture/setup/ocrSetupSchema";
import type { OcrSetupValues } from "@/features/ocrCapture/setup/ocrSetupSchema";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import type {
  GameTitleResponse,
  MapMasterResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";
import { fillRecordSetup } from "@/shared/heldEvents/recordContext";
import type { RecordSetupChoice } from "@/shared/heldEvents/recordContext";

export type HeldEventContextState = "idle" | "pending" | "resolved" | "notFound" | "failed";

export type OcrSetupResolution = { kind: "ready"; value: OcrSetupValues } | { kind: "blocked" };

export type OcrSetupChange =
  | { kind: "gameTitle"; id: string }
  | { kind: "heldEvent"; id: string; nextMatchNo: number | undefined }
  | { kind: "map"; id: string }
  | { kind: "season"; id: string }
  | { kind: "owner"; id: string }
  | { kind: "matchNo"; value: string };

/** Applies one user choice together with the dependent fields it invalidates. */
export function changeOcrSetupValue(value: OcrSetupValues, change: OcrSetupChange): OcrSetupValues {
  switch (change.kind) {
    case "gameTitle":
      return { ...value, gameTitleId: change.id, mapMasterId: "", seasonMasterId: "" };
    case "heldEvent":
      return { ...value, heldEventId: change.id, matchNoInEvent: change.nextMatchNo };
    case "map":
      return { ...value, mapMasterId: change.id };
    case "season":
      return { ...value, seasonMasterId: change.id };
    case "owner":
      return { ...value, ownerMemberId: change.id };
    case "matchNo":
      return {
        ...value,
        matchNoInEvent: change.value ? Math.trunc(Number(change.value)) : undefined,
      };
  }
}

export function resolveOcrSetupValidation(
  value: OcrSetupValues,
  enabled: boolean,
  choices: { ready: boolean; loading: boolean; refreshing: boolean },
): { resolution: OcrSetupResolution; blockedReason: string | undefined } {
  const validation = ocrSetupSchema.safeParse(value);
  return {
    resolution:
      choices.ready && validation.success ? { kind: "ready", value } : { kind: "blocked" },
    blockedReason: enabled
      ? choices.loading || choices.refreshing
        ? "試合設定の選択肢を確認しています。"
        : validation.success
          ? undefined
          : (validation.error.issues[0]?.message ?? "試合設定を確認してください。")
      : "ログイン状態を確認中です。",
  };
}

/** Candidate reads can enable submission only when the selected masters belong to the title. */
export function areOcrSetupChoicesReady({
  enabled,
  loading,
  failed,
  heldEventContext,
  selectedGameTitle,
  mapMasters,
  seasonMasters,
  value,
}: {
  enabled: boolean;
  loading: boolean;
  failed: boolean;
  heldEventContext: HeldEventContextState;
  selectedGameTitle: GameTitleResponse | undefined;
  mapMasters: readonly MapMasterResponse[];
  seasonMasters: readonly SeasonMasterResponse[];
  value: OcrSetupValues;
}): boolean {
  return (
    enabled &&
    !loading &&
    !failed &&
    heldEventContext !== "notFound" &&
    heldEventContext !== "failed" &&
    Boolean(selectedGameTitle && value.ownerMemberId) &&
    mapMasters.some(
      (item) => item.id === value.mapMasterId && item.gameTitleId === value.gameTitleId,
    ) &&
    seasonMasters.some(
      (item) => item.id === value.seasonMasterId && item.gameTitleId === value.gameTitleId,
    )
  );
}

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

export function sameSetupValue(left: OcrSetupValues, right: OcrSetupValues): boolean {
  return (
    left.gameTitleId === right.gameTitleId &&
    left.heldEventId === right.heldEventId &&
    left.mapMasterId === right.mapMasterId &&
    left.matchNoInEvent === right.matchNoInEvent &&
    left.ownerMemberId === right.ownerMemberId &&
    left.seasonMasterId === right.seasonMasterId
  );
}

/**
 * Drops choices that no longer exist and fills the empty ones by the rule every way of recording
 * shares (UI rule: 対象と導線): the held event's next number and previous match, otherwise a lone
 * candidate. Nothing is decided from the held event while its own read is still pending, since a
 * cached entry can predate a match confirmed or deleted since.
 */
export function deriveValidSetupValue(args: {
  gameTitles: GameTitleResponse[];
  heldEventNotFound: boolean;
  heldEvents: HeldEventResponse[];
  mapMasters: MapMasterResponse[];
  previousMatchSetup: RecordSetupChoice | undefined;
  recordContextPending: boolean;
  seasonMasters: SeasonMasterResponse[];
  value: OcrSetupValues;
}): OcrSetupValues {
  const { gameTitles, heldEventNotFound, heldEvents, mapMasters, seasonMasters, value } = args;
  let next = value;
  const patch = (partial: Partial<OcrSetupValues>) => {
    next = { ...next, ...partial };
  };

  if (next.heldEventId) {
    const selectedHeldEvent = heldEvents.find((event) => event.id === next.heldEventId);
    if (heldEventNotFound) {
      patch({ heldEventId: "", matchNoInEvent: undefined });
    } else if (
      selectedHeldEvent &&
      !args.recordContextPending &&
      (!next.matchNoInEvent || next.matchNoInEvent < 1)
    ) {
      patch({ matchNoInEvent: selectedHeldEvent.nextMatchNo });
    }
  }

  if (
    next.gameTitleId &&
    gameTitles.length > 0 &&
    !gameTitles.some((gameTitle) => gameTitle.id === next.gameTitleId)
  ) {
    patch({ gameTitleId: "", mapMasterId: "", seasonMasterId: "" });
  }
  if (next.gameTitleId) {
    const scopedMaps = mapMasters.filter((item) => item.gameTitleId === next.gameTitleId);
    if (
      next.mapMasterId &&
      scopedMaps.length > 0 &&
      !scopedMaps.some((item) => item.id === next.mapMasterId)
    ) {
      patch({ mapMasterId: "" });
    }
    const scopedSeasons = seasonMasters.filter((item) => item.gameTitleId === next.gameTitleId);
    if (
      next.seasonMasterId &&
      scopedSeasons.length > 0 &&
      !scopedSeasons.some((item) => item.id === next.seasonMasterId)
    ) {
      patch({ seasonMasterId: "" });
    }
  }

  if (!args.recordContextPending) {
    patch(
      fillRecordSetup({
        value: next,
        previous: next.heldEventId ? args.previousMatchSetup : undefined,
        gameTitles,
        seasons: seasonMasters,
        maps: mapMasters,
      }),
    );
  }

  return next;
}

import { confirmedDraftDestination } from "@/features/matches/confirmedDraftNavigation";
import type { MatchFormValues, WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import type {
  GameTitleResponse,
  MapMasterResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";
import type { MatchDraftDetailResponse } from "@/shared/api/matchDrafts";
import { isCancelableDraftStatus } from "@/shared/domain/draftStatus";

const noGameTitles: GameTitleResponse[] = [];
const noHeldEvents: HeldEventResponse[] = [];
const noMaps: MapMasterResponse[] = [];
const noSeasons: SeasonMasterResponse[] = [];

export function buildMatchWorkspaceView({
  draftDetail,
  gameTitleItems,
  heldEventItems,
  mapItems,
  mode,
  reviewStatus,
  seasonItems,
  useSampleDrafts,
  values,
}: {
  draftDetail: MatchDraftDetailResponse | undefined;
  gameTitleItems: GameTitleResponse[] | undefined;
  heldEventItems: HeldEventResponse[] | undefined;
  mapItems: MapMasterResponse[] | undefined;
  mode: WorkspaceMode;
  reviewStatus: string | undefined;
  seasonItems: SeasonMasterResponse[] | undefined;
  useSampleDrafts: boolean;
  values: MatchFormValues;
}) {
  const heldEvents = heldEventItems ?? noHeldEvents;
  const gameTitles = gameTitleItems ?? noGameTitles;
  const maps = mapItems ?? noMaps;
  const seasons = seasonItems ?? noSeasons;
  const matchDraftIdForImages = values.matchDraftId;
  const confirmedDraftLoaded =
    mode !== "edit" && !useSampleDrafts && Boolean(confirmedDraftDestination(draftDetail));

  return {
    canCancelDraft:
      mode !== "edit" &&
      !useSampleDrafts &&
      Boolean(draftDetail) &&
      Boolean(values.matchDraftId) &&
      isCancelableDraftStatus(reviewStatus),
    confirmedDraftLoaded,
    gameTitleItems: gameTitles,
    hasSourceImagePanel: mode !== "edit" && Boolean(matchDraftIdForImages),
    heldEvents,
    mapItems: maps,
    matchDraftIdForImages,
    seasonItems: seasons,
    selectedGameTitle: gameTitles.find((item) => item.id === values.gameTitleId),
    selectedHeldEvent: heldEvents.find((event) => event.id === values.heldEventId),
    selectedMap: maps.find((item) => item.id === values.mapMasterId),
    selectedSeason: seasons.find((item) => item.id === values.seasonMasterId),
  };
}

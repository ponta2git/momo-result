import { useMemo } from "react";

import { confirmedDraftDestination } from "@/features/matches/confirmedDraftNavigation";
import type { MatchFormValues, WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import { buildWorkspacePageCopy } from "@/features/matches/workspace/workspaceViewModel";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import type { MatchDraftDetailResponse } from "@/shared/api/matchDrafts";
import type {
  GameTitleResponse,
  MapMasterResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";
import { isCancelableDraftStatus } from "@/shared/domain/draftStatus";

export function useMatchWorkspaceViewModel({
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
  const heldEvents = useMemo(() => heldEventItems ?? [], [heldEventItems]);
  const pageCopy = buildWorkspacePageCopy({ mode, reviewStatus });
  const gameTitles = gameTitleItems ?? [];
  const maps = mapItems ?? [];
  const seasons = seasonItems ?? [];
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
    pageDescription: pageCopy.description,
    pageTitle: pageCopy.title,
    seasonItems: seasons,
    selectedGameTitle: gameTitles.find((item) => item.id === values.gameTitleId),
    selectedHeldEvent: heldEvents.find((event) => event.id === values.heldEventId),
    selectedMap: maps.find((item) => item.id === values.mapMasterId),
    selectedSeason: seasons.find((item) => item.id === values.seasonMasterId),
  };
}

import { confirmedDraftDestination } from "@/features/matches/confirmedDraftNavigation";
import type { MatchFormValues, WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import { toMatchWorkspaceOperationErrorView } from "@/features/matches/workspace/matchWorkspaceOperationError";
import type { MatchWorkspaceOperationError } from "@/features/matches/workspace/matchWorkspaceOperationError";
import type { MatchWorkspaceSubmitView } from "@/features/matches/workspace/matchWorkspacePanelViews";
import { toSourceImageDescriptor } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import type {
  GameTitleResponse,
  MapMasterResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";
import type {
  MatchDraftDetailResponse,
  MatchDraftSourceImageResponse,
} from "@/shared/api/matchDrafts";
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
  matchId,
  mode,
  reviewStatus,
  seasonItems,
  sourceImages,
  useSampleDrafts,
  values,
}: {
  draftDetail: MatchDraftDetailResponse | undefined;
  gameTitleItems: GameTitleResponse[] | undefined;
  heldEventItems: HeldEventResponse[] | undefined;
  mapItems: MapMasterResponse[] | undefined;
  matchId: string | undefined;
  mode: WorkspaceMode;
  reviewStatus: string | undefined;
  seasonItems: SeasonMasterResponse[] | undefined;
  sourceImages: MatchDraftSourceImageResponse[] | undefined;
  useSampleDrafts: boolean;
  values: Pick<
    MatchFormValues,
    "gameTitleId" | "heldEventId" | "mapMasterId" | "seasonMasterId" | "matchDraftId"
  >;
}) {
  const heldEvents = heldEventItems ?? noHeldEvents;
  const gameTitles = gameTitleItems ?? noGameTitles;
  const maps = mapItems ?? noMaps;
  const seasons = seasonItems ?? noSeasons;
  const matchDraftIdForImages = values.matchDraftId;
  const confirmedDraftLoaded =
    mode !== "edit" && !useSampleDrafts && Boolean(confirmedDraftDestination(draftDetail));

  return {
    exitHref:
      mode === "edit" && matchId
        ? `/matches/${encodeURIComponent(matchId)}`
        : values.heldEventId
          ? `/held-events/${encodeURIComponent(values.heldEventId)}`
          : "/matches",
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
    sourceImages: matchDraftIdForImages
      ? (sourceImages ?? []).flatMap((item) => {
          const descriptor = toSourceImageDescriptor(matchDraftIdForImages, item);
          return descriptor ? [descriptor] : [];
        })
      : [],
    selectedGameTitle: gameTitles.find((item) => item.id === values.gameTitleId),
    selectedHeldEvent: heldEvents.find((event) => event.id === values.heldEventId),
    selectedMap: maps.find((item) => item.id === values.mapMasterId),
    selectedSeason: seasons.find((item) => item.id === values.seasonMasterId),
  };
}

export function isMatchWorkspaceLoading(input: {
  confirmedDraftLoaded: boolean;
  waitingForData: boolean;
  reviewBlocked: boolean;
  initializationFailed: boolean;
}) {
  return (
    input.confirmedDraftLoaded ||
    (input.waitingForData && !input.reviewBlocked && !input.initializationFailed)
  );
}

export function buildMatchWorkspaceSubmitView(input: {
  mode: WorkspaceMode;
  busy: boolean;
  createEventPending: boolean;
  workspaceLoading: boolean;
  confirmOpen: boolean;
  cancelDraftConfirmOpen: boolean;
  operationError: MatchWorkspaceOperationError | null;
  validationMessage: string;
  valid: boolean;
  firstValidationMessage: string | undefined;
}): Omit<MatchWorkspaceSubmitView, "action"> & {
  label: MatchWorkspaceSubmitView["action"]["label"];
} {
  const validationError = input.validationMessage
    ? {
        detail: input.validationMessage,
        nextStep:
          "入力内容は保存・確定されていません。表示された項目を修正して、もう一度実行してください。",
        title: "入力内容を確認してください",
      }
    : null;
  const operationError = input.operationError
    ? toMatchWorkspaceOperationErrorView(input.operationError)
    : null;
  return {
    label: input.mode === "edit" ? "保存" : "確定前の確認へ進む",
    availability: {
      disabled: input.workspaceLoading || input.busy || input.createEventPending,
      pending: input.busy && !input.confirmOpen && !input.cancelDraftConfirmOpen,
    },
    feedback: {
      error:
        input.operationError?.kind === "cancelDraft"
          ? validationError
          : (operationError ?? validationError),
      message: input.createEventPending
        ? "開催の作成が完了すると、入力内容を保存・確定できます。"
        : input.valid
          ? "確定前の確認へ進めます"
          : (input.firstValidationMessage ?? "入力内容に不足があります"),
    },
  };
}

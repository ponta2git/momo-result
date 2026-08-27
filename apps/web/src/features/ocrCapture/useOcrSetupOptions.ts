import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import {
  deriveValidSetupValue,
  resolveHeldEventContext,
  sameSetupValue,
} from "@/features/ocrCapture/ocrSetupOptionResolution";
import type { SetupFormValues } from "@/features/ocrCapture/schema";
import { mergeHeldEventItems } from "@/shared/api/heldEventCache";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import type {
  GameTitleResponse,
  MapMasterResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { shouldShowQueryError } from "@/shared/api/queryErrorState";
import {
  gameTitlesQueryOptions,
  heldEventDetailQueryOptions,
  heldEventDirectoryQueryOptions,
  mapMastersQueryOptions,
  seasonMastersQueryOptions,
} from "@/shared/api/queryOptions";
import { useHeldEventPickerDirectory } from "@/shared/api/useHeldEventPickerDirectory";

type OcrSetupOptionsParams = {
  enabled: boolean;
  onChange: (value: SetupFormValues) => void;
  value: SetupFormValues;
};

const emptyGameTitles: GameTitleResponse[] = [];
const emptyHeldEvents: HeldEventResponse[] = [];
const emptyMapMasters: MapMasterResponse[] = [];
const emptySeasonMasters: SeasonMasterResponse[] = [];

function queryErrorMessage(error: unknown): string | undefined {
  if (!error) {
    return undefined;
  }
  const normalized = normalizeUnknownApiError(error);
  return normalized.status === 401
    ? "ログイン後に選択肢を読み込めます。"
    : normalized.detail || normalized.title;
}

function gameTitlesPlaceholder(args: {
  enabled: boolean;
  failed: boolean;
  loading: boolean;
}): string {
  if (!args.enabled) {
    return "ログイン後に読み込みます";
  }
  return args.failed ? "読み込みに失敗" : args.loading ? "読み込み中…" : "未登録";
}

function scopedMastersPlaceholder(args: {
  enabled: boolean;
  failed: boolean;
  gameTitleId: string;
  loading: boolean;
}): string {
  if (!args.enabled) {
    return "ログイン後に読み込みます";
  }
  if (!args.gameTitleId) {
    return "作品を選択してください";
  }
  return args.failed ? "読み込みに失敗" : args.loading ? "読み込み中…" : "未登録";
}

export function useOcrSetupOptions({ enabled, onChange, value }: OcrSetupOptionsParams) {
  const gameTitlesQuery = useQuery({ ...gameTitlesQueryOptions(), enabled });
  const heldEventsQuery = useQuery({
    ...heldEventDirectoryQueryOptions(),
    enabled,
  });
  const preferredHeldEventQuery = useQuery({
    ...heldEventDetailQueryOptions(value.heldEventId, Boolean(value.heldEventId)),
    enabled: enabled && Boolean(value.heldEventId),
  });
  const mapMastersQuery = useQuery({
    ...mapMastersQueryOptions(value.gameTitleId, Boolean(value.gameTitleId)),
    enabled: enabled && Boolean(value.gameTitleId),
  });
  const seasonMastersQuery = useQuery({
    ...seasonMastersQueryOptions(value.gameTitleId, Boolean(value.gameTitleId)),
    enabled: enabled && Boolean(value.gameTitleId),
  });

  const gameTitles = gameTitlesQuery.data?.items ?? emptyGameTitles;
  const heldEvents = mergeHeldEventItems(
    heldEventsQuery.data?.items ?? emptyHeldEvents,
    preferredHeldEventQuery.data,
  );
  const mapMasters = mapMastersQuery.data?.items ?? emptyMapMasters;
  const seasonMasters = seasonMastersQuery.data?.items ?? emptySeasonMasters;
  const selectedGameTitle = gameTitles.find((gameTitle) => gameTitle.id === value.gameTitleId);
  const selectedHeldEvent = heldEvents.find((event) => event.id === value.heldEventId);
  const heldEventPicker = useHeldEventPickerDirectory({
    enabled,
    selectedEvent: selectedHeldEvent,
    selectedId: value.heldEventId ?? "",
  });
  const gameTitlesLoadFailed = shouldShowQueryError(gameTitlesQuery);
  const heldEventsLoadFailed = shouldShowQueryError(heldEventsQuery);
  const preferredHeldEventLoadFailed = shouldShowQueryError(preferredHeldEventQuery);
  const mapMastersLoadFailed = shouldShowQueryError(mapMastersQuery);
  const seasonMastersLoadFailed = shouldShowQueryError(seasonMastersQuery);
  const preferredHeldEventStatus = preferredHeldEventLoadFailed
    ? normalizeUnknownApiError(preferredHeldEventQuery.error).status
    : undefined;
  const heldEventContext = resolveHeldEventContext({
    detailErrorStatus: preferredHeldEventStatus,
    detailFailed: preferredHeldEventLoadFailed,
    directoryFailed: heldEventsLoadFailed,
    enabled,
    fetching: heldEventsQuery.isFetching || preferredHeldEventQuery.isFetching,
    selected: Boolean(selectedHeldEvent),
    selectedId: value.heldEventId,
  });
  const heldEventContextLoading = heldEventContext === "pending";
  const heldEventContextNotFound = heldEventContext === "notFound";
  const heldEventContextFailed = heldEventContext === "failed";
  const loading =
    gameTitlesQuery.isLoading ||
    heldEventContextLoading ||
    (Boolean(value.gameTitleId) && (mapMastersQuery.isLoading || seasonMastersQuery.isLoading));
  const refreshing =
    gameTitlesQuery.isFetching ||
    heldEventContextLoading ||
    mapMastersQuery.isFetching ||
    seasonMastersQuery.isFetching;
  const ready =
    enabled &&
    !loading &&
    !gameTitlesLoadFailed &&
    !heldEventContextNotFound &&
    !heldEventContextFailed &&
    !mapMastersLoadFailed &&
    !seasonMastersLoadFailed &&
    Boolean(selectedGameTitle && value.mapMasterId && value.seasonMasterId && value.ownerMemberId);
  const hasError =
    gameTitlesLoadFailed ||
    heldEventsLoadFailed ||
    heldEventContextNotFound ||
    heldEventContextFailed ||
    mapMastersLoadFailed ||
    seasonMastersLoadFailed;
  const retry = () => {
    void Promise.all([
      gameTitlesQuery.refetch(),
      heldEventsQuery.refetch(),
      heldEventPicker.refetch(),
      preferredHeldEventQuery.refetch(),
      mapMastersQuery.refetch(),
      seasonMastersQuery.refetch(),
    ]);
  };

  useEffect(() => {
    const next = deriveValidSetupValue({
      gameTitles,
      heldEventNotFound: heldEventContextNotFound,
      heldEvents,
      mapMasters,
      seasonMasters,
      value,
    });
    if (!sameSetupValue(next, value)) {
      onChange(next);
    }
  }, [
    gameTitles,
    heldEvents,
    heldEventContextNotFound,
    mapMasters,
    onChange,
    seasonMasters,
    value,
  ]);

  return {
    gameTitles,
    gameTitlesError: gameTitlesLoadFailed ? queryErrorMessage(gameTitlesQuery.error) : undefined,
    gameTitlesPlaceholder: gameTitlesPlaceholder({
      enabled,
      failed: gameTitlesLoadFailed,
      loading: gameTitlesQuery.isLoading,
    }),
    heldEvents,
    heldEventPicker,
    hasError,
    heldEventsError: heldEventContextNotFound
      ? "選択した開催は見つかりませんでした。"
      : heldEventContextFailed
        ? (queryErrorMessage(preferredHeldEventQuery.error ?? heldEventsQuery.error) ??
          "選択した開催を読み込めません。")
        : heldEventsLoadFailed
          ? queryErrorMessage(heldEventsQuery.error)
          : undefined,
    heldEventsPlaceholder: gameTitlesPlaceholder({
      enabled,
      failed: heldEventsLoadFailed,
      loading: heldEventsQuery.isLoading,
    }),
    mapMasters,
    mapMastersError: mapMastersLoadFailed ? queryErrorMessage(mapMastersQuery.error) : undefined,
    mapMastersPlaceholder: scopedMastersPlaceholder({
      enabled,
      failed: mapMastersLoadFailed,
      gameTitleId: value.gameTitleId,
      loading: mapMastersQuery.isLoading,
    }),
    seasonMasters,
    seasonMastersError: seasonMastersLoadFailed
      ? queryErrorMessage(seasonMastersQuery.error)
      : undefined,
    seasonMastersPlaceholder: scopedMastersPlaceholder({
      enabled,
      failed: seasonMastersLoadFailed,
      gameTitleId: value.gameTitleId,
      loading: seasonMastersQuery.isLoading,
    }),
    selectedGameTitle,
    selectedHeldEvent,
    retry,
    ready,
    refreshing,
    loading,
  };
}

export type OcrSetupOptions = ReturnType<typeof useOcrSetupOptions>;

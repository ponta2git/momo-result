import { useQuery } from "@tanstack/react-query";

import {
  areOcrSetupChoicesReady,
  resolveHeldEventContext,
} from "@/features/ocrCapture/setup/ocrSetupModel";
import type { OcrSetupValues } from "@/features/ocrCapture/setup/ocrSetupSchema";
import { preferHeldEventItem } from "@/shared/api/heldEventCache";
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
  heldEventsQueryOptions,
  mapMastersQueryOptions,
  seasonMastersQueryOptions,
} from "@/shared/api/queryOptions";
import {
  heldEventPickerPageSize,
  useHeldEventPickerDirectory,
} from "@/shared/heldEvents/useHeldEventPickerDirectory";
import { useRecordContext } from "@/shared/heldEvents/useRecordContext";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

type OcrSetupOptionsParams = {
  enabled: boolean;
  value: OcrSetupValues;
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

export function useOcrSetupOptions({ enabled, value }: OcrSetupOptionsParams) {
  const gameTitlesQuery = useQuery({ ...gameTitlesQueryOptions(), enabled });
  const heldEventsQuery = useQuery({
    ...heldEventsQueryOptions({ page: 1, pageSize: heldEventPickerPageSize }),
    enabled,
  });
  // The chosen held event is read with its matches: its next number and previous match decide
  // the defaults by the same rule as manual entry.
  const recordContext = useRecordContext(value.heldEventId, enabled);
  const mapMastersQuery = useQuery({
    ...mapMastersQueryOptions(value.gameTitleId, Boolean(value.gameTitleId)),
    enabled: enabled && Boolean(value.gameTitleId),
  });
  const seasonMastersQuery = useQuery({
    ...seasonMastersQueryOptions(value.gameTitleId, Boolean(value.gameTitleId)),
    enabled: enabled && Boolean(value.gameTitleId),
  });

  const gameTitles = gameTitlesQuery.data?.items ?? emptyGameTitles;
  const heldEvents = preferHeldEventItem(
    heldEventsQuery.data?.items ?? emptyHeldEvents,
    recordContext.event,
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
  const preferredHeldEventLoadFailed = recordContext.showError && !recordContext.notFound;
  const mapMastersLoadFailed = shouldShowQueryError(mapMastersQuery);
  const seasonMastersLoadFailed = shouldShowQueryError(seasonMastersQuery);
  const preferredHeldEventStatus = recordContext.notFound
    ? 404
    : preferredHeldEventLoadFailed
      ? normalizeUnknownApiError(recordContext.error).status
      : undefined;
  const heldEventContext = resolveHeldEventContext({
    detailErrorStatus: preferredHeldEventStatus,
    detailFailed: preferredHeldEventLoadFailed,
    directoryFailed: heldEventsLoadFailed,
    enabled,
    fetching: heldEventsQuery.isFetching || recordContext.fetching,
    selected: Boolean(selectedHeldEvent),
    selectedId: value.heldEventId,
  });
  const heldEventContextLoading = heldEventContext === "pending";
  const heldEventContextNotFound = heldEventContext === "notFound";
  const heldEventContextFailed = heldEventContext === "failed";
  const loading =
    gameTitlesQuery.isLoading ||
    heldEventContextLoading ||
    recordContext.pending ||
    (Boolean(value.gameTitleId) && (mapMastersQuery.isLoading || seasonMastersQuery.isLoading));
  const refreshing =
    gameTitlesQuery.isFetching ||
    heldEventContextLoading ||
    mapMastersQuery.isFetching ||
    seasonMastersQuery.isFetching;
  const ready = areOcrSetupChoicesReady({
    enabled,
    loading,
    failed: gameTitlesLoadFailed || mapMastersLoadFailed || seasonMastersLoadFailed,
    heldEventContext,
    selectedGameTitle,
    mapMasters,
    seasonMasters,
    value,
  });
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
      heldEventsQuery.refetch({ cancelRefetch: false }),
      heldEventPicker.refresh(),
      ...(value.heldEventId ? [recordContext.retry({ cancelRefetch: false })] : []),
      mapMastersQuery.refetch(),
      seasonMastersQuery.refetch(),
    ]);
  };

  return {
    gameTitles,
    gameTitlesError: useRetryNotice(
      gameTitlesLoadFailed ? queryErrorMessage(gameTitlesQuery.error) : undefined,
      gameTitlesQuery.isFetching,
      String(enabled),
    ),
    gameTitlesPlaceholder: gameTitlesPlaceholder({
      enabled,
      failed: gameTitlesLoadFailed,
      loading: gameTitlesQuery.isLoading,
    }),
    heldEvents,
    heldEventContext,
    heldEventPicker,
    previousMatchSetup: recordContext.previous,
    recordContextPending: recordContext.pending,
    hasError: useRetryNotice(
      hasError,
      refreshing,
      `${enabled}:${value.gameTitleId}:${value.heldEventId ?? ""}`,
    ),
    heldEventsError: useRetryNotice(
      heldEventContextNotFound
        ? "選択した開催は見つかりませんでした。"
        : heldEventContextFailed
          ? (queryErrorMessage(recordContext.error ?? heldEventsQuery.error) ??
            "選択した開催を読み込めません。")
          : heldEventsLoadFailed
            ? queryErrorMessage(heldEventsQuery.error)
            : undefined,
      heldEventsQuery.isFetching || recordContext.fetching,
      `${enabled}:${value.heldEventId ?? ""}`,
    ),
    heldEventsPlaceholder: gameTitlesPlaceholder({
      enabled,
      failed: heldEventsLoadFailed,
      loading: heldEventsQuery.isLoading,
    }),
    mapMasters,
    mapMastersError: useRetryNotice(
      mapMastersLoadFailed ? queryErrorMessage(mapMastersQuery.error) : undefined,
      mapMastersQuery.isFetching,
      value.gameTitleId,
    ),
    mapMastersPlaceholder: scopedMastersPlaceholder({
      enabled,
      failed: mapMastersLoadFailed,
      gameTitleId: value.gameTitleId,
      loading: mapMastersQuery.isLoading,
    }),
    seasonMasters,
    seasonMastersError: useRetryNotice(
      seasonMastersLoadFailed ? queryErrorMessage(seasonMastersQuery.error) : undefined,
      seasonMastersQuery.isFetching,
      value.gameTitleId,
    ),
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

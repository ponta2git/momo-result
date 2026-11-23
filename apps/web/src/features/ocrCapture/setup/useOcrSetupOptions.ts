import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { areOcrSetupChoicesReady } from "@/features/ocrCapture/setup/ocrSetupModel";
import type { OcrSetupValues } from "@/features/ocrCapture/setup/ocrSetupSchema";
import type {
  GameTitleResponse,
  MapMasterResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { shouldShowQueryError } from "@/shared/api/queryErrorState";
import {
  gameTitlesQueryOptions,
  mapMastersQueryOptions,
  seasonMastersQueryOptions,
} from "@/shared/api/queryOptions";
import { useHeldEventPickerDirectory } from "@/shared/heldEvents/useHeldEventPickerDirectory";
import { useRecordContext } from "@/shared/heldEvents/useRecordContext";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

type OcrSetupOptionsParams = {
  enabled: boolean;
  value: OcrSetupValues;
};

const emptyGameTitles: GameTitleResponse[] = [];
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
  const [pickerOpen, setPickerOpen] = useState(false);
  // The event summary and previous confirmed conditions arrive together, as in manual entry.
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
  const mapMasters = mapMastersQuery.data?.items ?? emptyMapMasters;
  const seasonMasters = seasonMastersQuery.data?.items ?? emptySeasonMasters;
  const selectedGameTitle = gameTitles.find((gameTitle) => gameTitle.id === value.gameTitleId);
  const selectedHeldEvent = recordContext.event;
  const recordContextReady =
    !value.heldEventId || (recordContext.confirmed && selectedHeldEvent?.id === value.heldEventId);
  const heldEventPicker = useHeldEventPickerDirectory({
    enabled,
    includeDirectory: pickerOpen,
    selectedEvent: selectedHeldEvent,
    selectedId: selectedHeldEvent?.id ?? "",
  });
  const gameTitlesLoadFailed = shouldShowQueryError(gameTitlesQuery);
  const mapMastersLoadFailed = shouldShowQueryError(mapMastersQuery);
  const seasonMastersLoadFailed = shouldShowQueryError(seasonMastersQuery);
  const loading =
    gameTitlesQuery.isLoading ||
    recordContext.pending ||
    (Boolean(value.gameTitleId) && (mapMastersQuery.isLoading || seasonMastersQuery.isLoading));
  const refreshing =
    gameTitlesQuery.isFetching ||
    recordContext.fetching ||
    mapMastersQuery.isFetching ||
    seasonMastersQuery.isFetching;
  const ready = areOcrSetupChoicesReady({
    enabled,
    loading,
    failed: gameTitlesLoadFailed || mapMastersLoadFailed || seasonMastersLoadFailed,
    recordContextReady,
    selectedGameTitle,
    mapMasters,
    seasonMasters,
    value,
  });
  const hasError =
    gameTitlesLoadFailed ||
    recordContext.showError ||
    mapMastersLoadFailed ||
    seasonMastersLoadFailed;
  const retry = () => {
    void Promise.all([
      gameTitlesQuery.refetch(),
      ...(value.heldEventId ? [recordContext.retry({ cancelRefetch: false })] : []),
      ...(value.gameTitleId ? [mapMastersQuery.refetch(), seasonMastersQuery.refetch()] : []),
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
    heldEventNotFound: recordContext.confirmed && recordContext.notFound,
    heldEventPicker,
    setPickerOpen,
    previousMatchSetup: recordContext.previous,
    canFillDefaults: recordContextReady,
    hasError: useRetryNotice(
      hasError,
      refreshing,
      `${enabled}:${value.gameTitleId}:${value.heldEventId ?? ""}`,
    ),
    heldEventsError: useRetryNotice(
      recordContext.showError ? queryErrorMessage(recordContext.error) : undefined,
      recordContext.fetching,
      `${enabled}:${value.heldEventId ?? ""}`,
    ),
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

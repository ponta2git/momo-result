import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

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
  heldEventsQueryOptions,
  mapMastersQueryOptions,
  seasonMastersQueryOptions,
} from "@/shared/api/queryOptions";

type OcrSetupOptionsParams = {
  authAccountId?: string | undefined;
  enabled: boolean;
  onChange: (value: SetupFormValues) => void;
  value: SetupFormValues;
};

const emptyGameTitles: GameTitleResponse[] = [];
const emptyHeldEvents: HeldEventResponse[] = [];
const emptyMapMasters: MapMasterResponse[] = [];
const emptySeasonMasters: SeasonMasterResponse[] = [];

function sameSetupValue(left: SetupFormValues, right: SetupFormValues): boolean {
  return (
    left.gameTitleId === right.gameTitleId &&
    left.heldEventId === right.heldEventId &&
    left.mapMasterId === right.mapMasterId &&
    left.matchNoInEvent === right.matchNoInEvent &&
    left.ownerMemberId === right.ownerMemberId &&
    left.seasonMasterId === right.seasonMasterId
  );
}

function deriveValidSetupValue(args: {
  gameTitles: GameTitleResponse[];
  heldEvents: HeldEventResponse[];
  heldEventsLoaded: boolean;
  mapMasters: MapMasterResponse[];
  seasonMasters: SeasonMasterResponse[];
  value: SetupFormValues;
}): SetupFormValues {
  const { gameTitles, heldEvents, heldEventsLoaded, mapMasters, seasonMasters, value } = args;
  let next = value;
  const patch = (partial: Partial<SetupFormValues>) => {
    next = { ...next, ...partial };
  };

  if (heldEventsLoaded && next.heldEventId) {
    const selectedHeldEvent = heldEvents.find((event) => event.id === next.heldEventId);
    if (!selectedHeldEvent) {
      patch({ heldEventId: "", matchNoInEvent: undefined });
    } else if (!next.matchNoInEvent || next.matchNoInEvent < 1) {
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
    if (fallback) {
      patch({ gameTitleId: fallback.id });
    }
  }

  if (next.gameTitleId) {
    const firstMap = mapMasters.find((item) => item.gameTitleId === next.gameTitleId);
    const mapStillValid = mapMasters.some(
      (item) => item.id === next.mapMasterId && item.gameTitleId === next.gameTitleId,
    );
    if (!mapStillValid && firstMap) {
      patch({ mapMasterId: firstMap.id });
    }

    const firstSeason = seasonMasters.find((item) => item.gameTitleId === next.gameTitleId);
    const seasonStillValid = seasonMasters.some(
      (item) => item.id === next.seasonMasterId && item.gameTitleId === next.gameTitleId,
    );
    if (!seasonStillValid && firstSeason) {
      patch({ seasonMasterId: firstSeason.id });
    }
  }

  return next;
}

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

export function useOcrSetupOptions({
  authAccountId,
  enabled,
  onChange,
  value,
}: OcrSetupOptionsParams) {
  const authScope = authAccountId ?? "anonymous";
  const gameTitlesQuery = useQuery({ ...gameTitlesQueryOptions(authScope), enabled });
  const heldEventsQuery = useQuery({
    ...heldEventsQueryOptions("", 100, "ocr-capture"),
    enabled,
  });
  const preferredHeldEventQuery = useQuery({
    ...heldEventDetailQueryOptions(value.heldEventId, Boolean(value.heldEventId)),
    enabled: enabled && Boolean(value.heldEventId),
  });
  const mapMastersQuery = useQuery({
    ...mapMastersQueryOptions(authScope, value.gameTitleId, Boolean(value.gameTitleId)),
    enabled: enabled && Boolean(value.gameTitleId),
  });
  const seasonMastersQuery = useQuery({
    ...seasonMastersQueryOptions(authScope, value.gameTitleId, Boolean(value.gameTitleId)),
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
  const gameTitlesLoadFailed = shouldShowQueryError(gameTitlesQuery);
  const heldEventsLoadFailed = shouldShowQueryError(heldEventsQuery);
  const mapMastersLoadFailed = shouldShowQueryError(mapMastersQuery);
  const seasonMastersLoadFailed = shouldShowQueryError(seasonMastersQuery);
  const heldEventContextLoading = Boolean(
    enabled &&
    value.heldEventId &&
    !selectedHeldEvent &&
    (heldEventsQuery.isFetching || preferredHeldEventQuery.isFetching),
  );
  const heldEventContextUnavailable = Boolean(
    enabled && value.heldEventId && !selectedHeldEvent && !heldEventContextLoading,
  );
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
    !heldEventContextUnavailable &&
    !mapMastersLoadFailed &&
    !seasonMastersLoadFailed &&
    Boolean(selectedGameTitle && value.mapMasterId && value.seasonMasterId && value.ownerMemberId);
  const hasError =
    gameTitlesLoadFailed ||
    heldEventsLoadFailed ||
    heldEventContextUnavailable ||
    mapMastersLoadFailed ||
    seasonMastersLoadFailed;
  const retry = () => {
    void Promise.all([
      gameTitlesQuery.refetch(),
      heldEventsQuery.refetch(),
      preferredHeldEventQuery.refetch(),
      mapMastersQuery.refetch(),
      seasonMastersQuery.refetch(),
    ]);
  };

  useEffect(() => {
    const next = deriveValidSetupValue({
      gameTitles,
      heldEvents,
      heldEventsLoaded: enabled && !heldEventContextLoading,
      mapMasters,
      seasonMasters,
      value,
    });
    if (!sameSetupValue(next, value)) {
      onChange(next);
    }
  }, [
    enabled,
    gameTitles,
    heldEvents,
    heldEventContextLoading,
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
    hasError,
    heldEventsError: heldEventContextUnavailable
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

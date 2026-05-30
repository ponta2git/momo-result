import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import type { SetupFormValues } from "@/features/ocrCapture/schema";
import { listGameTitles, listMapMasters, listSeasonMasters } from "@/shared/api/masters";
import type {
  GameTitleResponse,
  MapMasterResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { shouldShowQueryError } from "@/shared/api/queryErrorState";
import { masterKeys } from "@/shared/api/queryKeys";

type OcrSetupOptionsParams = {
  authAccountId?: string | undefined;
  enabled: boolean;
  onChange: (value: SetupFormValues) => void;
  value: SetupFormValues;
};

const emptyGameTitles: GameTitleResponse[] = [];
const emptyMapMasters: MapMasterResponse[] = [];
const emptySeasonMasters: SeasonMasterResponse[] = [];

function sameSetupValue(left: SetupFormValues, right: SetupFormValues): boolean {
  return (
    left.gameTitleId === right.gameTitleId &&
    left.mapMasterId === right.mapMasterId &&
    left.ownerMemberId === right.ownerMemberId &&
    left.seasonMasterId === right.seasonMasterId
  );
}

function deriveValidSetupValue(args: {
  gameTitles: GameTitleResponse[];
  mapMasters: MapMasterResponse[];
  seasonMasters: SeasonMasterResponse[];
  value: SetupFormValues;
}): SetupFormValues {
  const { gameTitles, mapMasters, seasonMasters, value } = args;
  let next = value;
  const patch = (partial: Partial<SetupFormValues>) => {
    next = { ...next, ...partial };
  };

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
  const gameTitlesQuery = useQuery({
    queryKey: masterKeys.gameTitles.list(authScope),
    queryFn: ({ signal }) => listGameTitles({ signal }),
    enabled,
  });
  const mapMastersQuery = useQuery({
    queryKey: masterKeys.mapMasters.list(authScope, value.gameTitleId),
    queryFn: ({ signal }) => listMapMasters(value.gameTitleId || undefined, { signal }),
    enabled: enabled && Boolean(value.gameTitleId),
  });
  const seasonMastersQuery = useQuery({
    queryKey: masterKeys.seasonMasters.list(authScope, value.gameTitleId),
    queryFn: ({ signal }) => listSeasonMasters(value.gameTitleId || undefined, { signal }),
    enabled: enabled && Boolean(value.gameTitleId),
  });

  const gameTitles = gameTitlesQuery.data?.items ?? emptyGameTitles;
  const mapMasters = mapMastersQuery.data?.items ?? emptyMapMasters;
  const seasonMasters = seasonMastersQuery.data?.items ?? emptySeasonMasters;
  const selectedGameTitle = gameTitles.find((gameTitle) => gameTitle.id === value.gameTitleId);
  const gameTitlesLoadFailed = shouldShowQueryError(gameTitlesQuery);
  const mapMastersLoadFailed = shouldShowQueryError(mapMastersQuery);
  const seasonMastersLoadFailed = shouldShowQueryError(seasonMastersQuery);
  const loading =
    gameTitlesQuery.isLoading ||
    (Boolean(value.gameTitleId) && (mapMastersQuery.isLoading || seasonMastersQuery.isLoading));
  const refreshing =
    gameTitlesQuery.isFetching || mapMastersQuery.isFetching || seasonMastersQuery.isFetching;
  const ready =
    enabled &&
    !loading &&
    !gameTitlesLoadFailed &&
    !mapMastersLoadFailed &&
    !seasonMastersLoadFailed &&
    Boolean(selectedGameTitle && value.mapMasterId && value.seasonMasterId && value.ownerMemberId);

  useEffect(() => {
    const next = deriveValidSetupValue({ gameTitles, mapMasters, seasonMasters, value });
    if (!sameSetupValue(next, value)) {
      onChange(next);
    }
  }, [gameTitles, mapMasters, onChange, seasonMasters, value]);

  return {
    gameTitles,
    gameTitlesError: gameTitlesLoadFailed ? queryErrorMessage(gameTitlesQuery.error) : undefined,
    gameTitlesPlaceholder: gameTitlesPlaceholder({
      enabled,
      failed: gameTitlesLoadFailed,
      loading: gameTitlesQuery.isLoading,
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
    ready,
    refreshing,
    loading,
  };
}

export type OcrSetupOptions = ReturnType<typeof useOcrSetupOptions>;

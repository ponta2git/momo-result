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
    queryFn: listGameTitles,
    enabled,
  });
  const mapMastersQuery = useQuery({
    queryKey: masterKeys.mapMasters.list(authScope, value.gameTitleId),
    queryFn: () => listMapMasters(value.gameTitleId || undefined),
    enabled: enabled && Boolean(value.gameTitleId),
  });
  const seasonMastersQuery = useQuery({
    queryKey: masterKeys.seasonMasters.list(authScope, value.gameTitleId),
    queryFn: () => listSeasonMasters(value.gameTitleId || undefined),
    enabled: enabled && Boolean(value.gameTitleId),
  });

  const gameTitles = gameTitlesQuery.data?.items ?? emptyGameTitles;
  const mapMasters = mapMastersQuery.data?.items ?? emptyMapMasters;
  const seasonMasters = seasonMastersQuery.data?.items ?? emptySeasonMasters;
  const selectedGameTitle = gameTitles.find((gameTitle) => gameTitle.id === value.gameTitleId);
  const gameTitlesLoadFailed = shouldShowQueryError(gameTitlesQuery);
  const mapMastersLoadFailed = shouldShowQueryError(mapMastersQuery);
  const seasonMastersLoadFailed = shouldShowQueryError(seasonMastersQuery);

  useEffect(() => {
    if (value.gameTitleId) {
      const stillValid = gameTitles.some((gameTitle) => gameTitle.id === value.gameTitleId);
      const first = gameTitles[0];
      if (!stillValid && first) {
        onChange({ ...value, gameTitleId: first.id, mapMasterId: "", seasonMasterId: "" });
      }
      return;
    }
    const fallback = gameTitles[0];
    if (fallback) {
      onChange({ ...value, gameTitleId: fallback.id });
    }
  }, [gameTitles, onChange, value]);

  useEffect(() => {
    if (!value.gameTitleId) return;
    const first = mapMasters[0];
    const stillValid = mapMasters.some((item) => item.id === value.mapMasterId);
    if (!stillValid && first && first.gameTitleId === value.gameTitleId) {
      onChange({ ...value, mapMasterId: first.id });
    }
  }, [mapMasters, onChange, value]);

  useEffect(() => {
    if (!value.gameTitleId) return;
    const first = seasonMasters[0];
    const stillValid = seasonMasters.some((item) => item.id === value.seasonMasterId);
    if (!stillValid && first && first.gameTitleId === value.gameTitleId) {
      onChange({ ...value, seasonMasterId: first.id });
    }
  }, [seasonMasters, onChange, value]);

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
  };
}

export type OcrSetupOptions = ReturnType<typeof useOcrSetupOptions>;

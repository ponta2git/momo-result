import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";

import { authQueryOptions } from "@/features/auth/authQueries";
import { buildOcrHints } from "@/features/ocrCapture/hints";
import type { getAuthMe } from "@/shared/api/client";
import { parseLayoutFamily } from "@/shared/api/enums";
import { listGameTitles } from "@/shared/api/masters";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import type { NormalizedApiError } from "@/shared/api/problemDetails";

type AuthMe = Awaited<ReturnType<typeof getAuthMe>>;

export type OcrCaptureAuthSlice = {
  data: AuthMe | undefined;
  error: NormalizedApiError | undefined;
  memberId: string | undefined;
  ready: boolean;
};

export type OcrCaptureQueries = {
  auth: OcrCaptureAuthSlice;
  gameTitlesQuery: UseQueryResult<Awaited<ReturnType<typeof listGameTitles>>>;
  hints: ReturnType<typeof buildOcrHints>;
};

/**
 * OCR 取り込み画面が必要とするマスタ系クエリと、選択中作品から導出する OCR ヒントをまとめる。
 * 認証関連は `auth` スライスに整形し、ページ側は `auth.error` 等のフラットな値だけ参照する。
 */
export function useOcrCaptureQueries(gameTitleId: string): OcrCaptureQueries {
  const authQuery = useQuery({ ...authQueryOptions(), retry: false });
  const ready = authQuery.isSuccess;
  const memberId = authQuery.data?.memberId;

  const gameTitlesQuery = useQuery({
    queryKey: ["masters", "game-titles", memberId ?? "anonymous"],
    queryFn: listGameTitles,
    enabled: ready,
  });

  const hints = useMemo(() => {
    const selected = gameTitlesQuery.data?.items?.find((item) => item.id === gameTitleId);
    const input: { gameTitleName?: string; layoutFamily?: "momotetsu_2" | "world" | "reiwa" } = {};
    if (selected?.name) input.gameTitleName = selected.name;
    const lf = parseLayoutFamily(selected?.layoutFamily);
    if (lf) input.layoutFamily = lf;
    return buildOcrHints(input);
  }, [gameTitlesQuery.data, gameTitleId]);

  return {
    auth: {
      data: authQuery.data,
      error: authQuery.error ? normalizeUnknownApiError(authQuery.error) : undefined,
      memberId,
      ready,
    },
    gameTitlesQuery,
    hints,
  };
}

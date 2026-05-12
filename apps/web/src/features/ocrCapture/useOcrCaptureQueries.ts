import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";

import { buildOcrHints } from "@/features/ocrCapture/hints";
import type { getAuthMe } from "@/shared/api/client";
import { parseLayoutFamily } from "@/shared/api/enums";
import { listGameTitles, listMemberAliases } from "@/shared/api/masters";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import type { NormalizedApiError } from "@/shared/api/problemDetails";
import { masterKeys } from "@/shared/api/queryKeys";
import { authQueryOptions } from "@/shared/auth/authQueries";
import { useDevUser } from "@/shared/auth/useDevUser";
import { buildMemberAliasDirectory } from "@/shared/domain/memberDirectory";

type AuthMe = Awaited<ReturnType<typeof getAuthMe>>;

export type OcrCaptureAuthSlice = {
  accountId: string | undefined;
  data: AuthMe | undefined;
  error: NormalizedApiError | undefined;
  ready: boolean;
};

export type OcrCaptureQueries = {
  auth: OcrCaptureAuthSlice;
  gameTitlesQuery: UseQueryResult<Awaited<ReturnType<typeof listGameTitles>>>;
  hints: ReturnType<typeof buildOcrHints>;
  memberAliasesQuery: UseQueryResult<Awaited<ReturnType<typeof listMemberAliases>>>;
};

/**
 * OCR 取り込み画面が必要とするマスタ系クエリと、選択中作品から導出する OCR ヒントをまとめる。
 * 認証関連は `auth` スライスに整形し、ページ側は `auth.error` 等のフラットな値だけ参照する。
 */
export function useOcrCaptureQueries(gameTitleId: string): OcrCaptureQueries {
  const { devUser } = useDevUser();
  const authQuery = useQuery({ ...authQueryOptions(devUser), retry: false });
  const ready = authQuery.isSuccess;
  const accountId = authQuery.data?.accountId;

  const gameTitlesQuery = useQuery({
    queryKey: masterKeys.gameTitles.list(accountId ?? "anonymous"),
    queryFn: listGameTitles,
    enabled: ready,
  });
  const memberAliasesQuery = useQuery({
    queryKey: masterKeys.memberAliases.list(accountId ?? "anonymous"),
    queryFn: () => listMemberAliases(),
    enabled: ready,
  });

  const hints = useMemo(() => {
    const selected = gameTitlesQuery.data?.items?.find((item) => item.id === gameTitleId);
    const input: { gameTitleName?: string; layoutFamily?: "momotetsu_2" | "world" | "reiwa" } = {};
    if (selected?.name) input.gameTitleName = selected.name;
    const lf = parseLayoutFamily(selected?.layoutFamily);
    if (lf) input.layoutFamily = lf;
    return buildOcrHints(input, buildMemberAliasDirectory(memberAliasesQuery.data?.items ?? []));
  }, [gameTitlesQuery.data, gameTitleId, memberAliasesQuery.data]);

  return {
    auth: {
      accountId,
      data: authQuery.data,
      error: authQuery.error ? normalizeUnknownApiError(authQuery.error) : undefined,
      ready,
    },
    gameTitlesQuery,
    hints,
    memberAliasesQuery,
  };
}

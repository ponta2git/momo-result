import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { getAuthMe } from "@/shared/api/auth";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import type { NormalizedApiError } from "@/shared/api/problemDetails";
import { shouldShowQueryError } from "@/shared/api/queryErrorState";
import { memberAliasesQueryOptions } from "@/shared/api/queryOptions";
import { authQueryOptions } from "@/shared/auth/authQueries";
import { useDevUser } from "@/shared/auth/useDevUser";
import { buildMemberAliasDirectory } from "@/shared/domain/memberDirectory";

type AuthMe = Awaited<ReturnType<typeof getAuthMe>>;

export type OcrCaptureAuthSlice = {
  accountId: string | undefined;
  data: AuthMe | undefined;
  error: NormalizedApiError | undefined;
  ready: boolean;
  retry: () => void;
  retrying: boolean;
};

export type OcrCaptureQueries = {
  auth: OcrCaptureAuthSlice;
  memberAliases: {
    directory: ReturnType<typeof buildMemberAliasDirectory>;
    feedback: {
      error: NormalizedApiError | undefined;
      refresh: () => void;
      refreshing: boolean;
    };
  };
};

/**
 * Adapts authentication and member-alias queries to the OCR capture workflow's semantic data.
 * TanStack Query results stay private so callers depend only on retry and feedback intent.
 */
export function useOcrCaptureQueries(): OcrCaptureQueries {
  const { devUser } = useDevUser();
  const authQuery = useQuery({ ...authQueryOptions(devUser), retry: false });
  const ready = authQuery.isSuccess;
  const accountId = authQuery.data?.accountId;

  const memberAliasesQuery = useQuery({
    ...memberAliasesQueryOptions(),
    enabled: ready,
  });

  const memberAliasDirectory = useMemo(
    () => buildMemberAliasDirectory(memberAliasesQuery.data?.items ?? []),
    [memberAliasesQuery.data],
  );

  return {
    auth: {
      accountId,
      data: authQuery.data,
      error: authQuery.error ? normalizeUnknownApiError(authQuery.error) : undefined,
      ready,
      retry: () => void authQuery.refetch(),
      retrying: authQuery.isFetching,
    },
    memberAliases: {
      directory: memberAliasDirectory,
      feedback: {
        error: shouldShowQueryError(memberAliasesQuery)
          ? normalizeUnknownApiError(memberAliasesQuery.error)
          : undefined,
        refresh: () => void memberAliasesQuery.refetch(),
        refreshing: memberAliasesQuery.isFetching,
      },
    },
  };
}

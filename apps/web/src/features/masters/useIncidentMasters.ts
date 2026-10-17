import { useQuery } from "@tanstack/react-query";

import { selectIncidentMasters } from "@/features/masters/masterQueries";
import { masterDirectoryState } from "@/features/masters/masterViewModel";
import type { IncidentMasterResponse } from "@/shared/api/masters";
import { isInitialQueryLoading, shouldShowQueryError } from "@/shared/api/queryErrorState";
import { incidentMastersQueryOptions } from "@/shared/api/queryOptions";
import { useAuthorizationOperations, usePermissionFacts } from "@/shared/auth/useAuthorization";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

export function useIncidentMasters(enabled: boolean) {
  const permission = usePermissionFacts("operations");
  const authorization = useAuthorizationOperations();
  const query = useQuery({
    ...incidentMastersQueryOptions(),
    select: selectIncidentMasters,
    enabled: () => enabled && permission.allowed && authorization.can("operations"),
  });
  const failed = useRetryNotice(
    shouldShowQueryError(query),
    query.isFetching,
    String(permission.epoch),
  );
  const items: ReadonlyArray<Readonly<IncidentMasterResponse>> = query.data ?? [];
  return {
    ...masterDirectoryState({
      hasData: query.data !== undefined,
      failed,
      initialLoading: isInitialQueryLoading(query),
      fetching: query.isFetching,
      mutationPending: false,
    }),
    items,
    onRetry: async () =>
      Boolean(authorization.begin("operations")) && (await query.refetch()).isSuccess,
  } as const;
}

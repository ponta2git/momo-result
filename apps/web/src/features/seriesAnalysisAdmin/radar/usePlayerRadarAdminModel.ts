import { radarAdministrationPresentation } from "@/features/seriesAnalysisAdmin/radar/playerRadarAdminPresentation";
import { usePlayerRadarOperations } from "@/features/seriesAnalysisAdmin/radar/usePlayerRadarOperations";
import { useAuthorization } from "@/shared/auth/useAuthorization";

/** Composes the title-owned workflow and its pure display contract. */
export function usePlayerRadarAdminModel(
  gameTitleId: string,
  gameTitleName: string,
  onApplyAccepted?: (operationId: string) => void,
) {
  const authorization = useAuthorization();
  const operations = usePlayerRadarOperations(gameTitleId, authorization, onApplyAccepted);
  return {
    model: radarAdministrationPresentation({
      ...operations,
      gameTitleId,
      gameTitleName,
      authorizationRevision: authorization.revision,
    }),
    loading: operations.loading,
    error: operations.error,
    refreshing: operations.refreshing,
    refresh: operations.refresh,
  };
}

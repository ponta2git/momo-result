import { radarAdministrationPresentation } from "@/features/seriesAnalysisAdmin/playerRadarAdminPresentation";
import { usePlayerRadarAdminOwner } from "@/features/seriesAnalysisAdmin/usePlayerRadarAdminOwner";
import { useAuthorization } from "@/shared/auth/useAuthorization";

/** Composes the title-owned workflow and its pure display contract. */
export function usePlayerRadarAdminModel(
  gameTitleId: string,
  gameTitleName: string,
  onApplyAccepted?: (operationId: string) => void,
) {
  const authorization = useAuthorization();
  const owner = usePlayerRadarAdminOwner(gameTitleId, authorization, onApplyAccepted);
  return {
    model: radarAdministrationPresentation({
      ...owner,
      gameTitleId,
      gameTitleName,
      authorizationRevision: authorization.revision,
    }),
    loading: owner.loading,
    error: owner.error,
    refreshing: owner.refreshing,
    refresh: owner.refresh,
  };
}

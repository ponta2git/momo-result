import { useEffect, useRef, useState } from "react";

import type { useSeriesAnalysisAdminLocation } from "@/features/seriesAnalysisAdmin/useSeriesAnalysisAdminLocation";
import type { AuthorizationAccess } from "@/shared/auth/authorization";
import { showToast } from "@/shared/ui/feedback/Toast";

export function useSeriesAnalysisAdminNavigation({
  location,
  authorization,
  selectedTitleName,
  refreshRadar,
  clearRecalculationFeedback,
}: {
  location: ReturnType<typeof useSeriesAnalysisAdminLocation>;
  authorization: Pick<AuthorizationAccess, "epoch" | "retained">;
  selectedTitleName: string | undefined;
  refreshRadar: () => void;
  clearRecalculationFeedback: () => void;
}) {
  const [allDialog, setAllDialog] = useState({ epoch: authorization.epoch.admin, open: false });
  const radarVisible = location.activeTab === "radar" && location.radarView === "current";
  const previouslyVisible = useRef(radarVisible);
  useEffect(() => {
    if (radarVisible && !previouslyVisible.current) refreshRadar();
    previouslyVisible.current = radarVisible;
  }, [radarVisible, refreshRadar]);
  const recalculationTabRef = useRef<HTMLElement>(null);
  const applyFocusRef = useRef<HTMLElement | null>(null);
  return {
    activeTab: location.activeTab,
    radarView: location.radarView,
    radarVisible,
    recalculationTabRef,
    allDialogOpen:
      authorization.retained.admin &&
      allDialog.epoch === authorization.epoch.admin &&
      allDialog.open,
    setAllDialogOpen: (open: boolean) => setAllDialog({ epoch: authorization.epoch.admin, open }),
    setActiveTab: (value: string) => location.update({ kind: "tab", value }),
    setRadarView: (value: string) => location.update({ kind: "radarView", value }),
    onApplyAccepted: (operationId: string) => {
      applyFocusRef.current = recalculationTabRef.current;
      clearRecalculationFeedback();
      location.update({ kind: "tab", value: "recalculation" });
      recalculationTabRef.current?.focus();
      showToast({
        id: `radar-apply-accepted:${operationId}`,
        title: "採点基準の適用を受け付けました",
        description: `${selectedTitleName}の再計算状況を表示しています。`,
      });
    },
    applyFinalFocus: () => {
      const destination = applyFocusRef.current;
      applyFocusRef.current = null;
      return destination;
    },
  };
}

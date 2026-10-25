import { useLayoutEffect, useRef } from "react";

import { useRadarEvaluationRead } from "@/features/seriesAnalysisAdmin/radar/playerRadarQueryAdapter";
import { resolveRadarEditingEvaluation } from "@/features/seriesAnalysisAdmin/radar/radarThresholdEditorModel";
import type { RadarEditingModel } from "@/features/seriesAnalysisAdmin/radar/radarThresholdEditorModel";

/** Adopts saved evaluation metrics only while their publication and scope still match. */
export function useRadarEditingEvaluation({
  active,
  gameTitleId,
  currentBasisId,
  scope,
  prepared,
}: {
  active: boolean;
  gameTitleId: string;
  currentBasisId: string | null;
  scope: { seasonMasterId: string; mapMasterId: string };
  prepared: RadarEditingModel["evaluation"];
}) {
  const usePublished = active && !prepared;
  const read = useRadarEvaluationRead({ enabled: usePublished, gameTitleId, scope });
  const target = read.target;
  const resourceId = target ? JSON.stringify(target) : undefined;
  const refreshIdentity = useRef(resourceId);
  useLayoutEffect(() => {
    refreshIdentity.current = resourceId;
    return () => {
      refreshIdentity.current = undefined;
    };
  }, [resourceId, refreshIdentity]);
  const presentation = resolveRadarEditingEvaluation({
    active,
    currentBasisId,
    scope,
    prepared,
    query: target,
    aggregate: read.aggregate,
    achievements: read.achievements,
    scopeState: read.scopeState,
    fetching: read.fetching,
    failed: read.failed,
  });
  return {
    ...presentation,
    refresh: async (canContinue: () => boolean) => {
      const canRefresh = () => canContinue() && refreshIdentity.current === resourceId;
      if (!usePublished || !canRefresh()) return;
      const artifactId = await read.refreshPublication();
      // A new publication starts its own reads. This continuation only refreshes
      // the captured publication and scope while the editor still owns them.
      if (!canRefresh() || !target || artifactId !== target.artifactId) return;
      try {
        const scopeState = await read.refreshScope(target);
        if (!canRefresh() || scopeState !== "available") return;
        await read.refreshEvaluation(target);
      } catch {
        // The read retains its failure for the editor's explicit retry.
      }
    },
  };
}

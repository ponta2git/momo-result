import { useCallback } from "react";

import { outlookPlayerView } from "@/features/seriesComparison/outlook/outlookProjections";
import {
  useOutlookEdit,
  useOutlookProjection,
} from "@/features/seriesComparison/outlook/OutlookWorkspaceProvider";
import { recentOutlookEntry } from "@/features/seriesComparison/outlook/outlookWorkspaceState";
import type {
  OutlookRole,
  OutlookWorkspaceState,
} from "@/features/seriesComparison/outlook/outlookWorkspaceState";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";

/** One person's assumption and the operations on it; the other person is read, never written. */
export function useOutlookPlayerEditor({
  response,
  role,
  memberId,
}: {
  response: SeriesAnalysisOutlookSummary;
  role: OutlookRole;
  memberId: string;
}) {
  const view = useOutlookProjection(
    useCallback((state: OutlookWorkspaceState) => outlookPlayerView(state, role), [role]),
  );
  const edit = useOutlookEdit();
  return {
    view,
    draft: (text: string) => edit({ kind: "mean-draft", role, text }),
    commit: () => edit({ kind: "commit-mean", role }),
    cancel: () => edit({ kind: "cancel-mean", role }),
    begin: () => edit({ kind: "begin-gesture", role }),
    finish: (cancel: boolean) => edit({ kind: "finish-gesture", cancel }),
    setMean: (hundredths: number) => edit({ kind: "mean", role, hundredths }),
    restoreRecent: () =>
      edit({ kind: "restore-recent", role, recent: recentOutlookEntry(response, memberId) }),
  };
}

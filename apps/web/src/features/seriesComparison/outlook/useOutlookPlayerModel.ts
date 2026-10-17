import { useCallback, useMemo, useState } from "react";

import type { CumulativePair } from "@/features/seriesComparison/model/outlook";
import {
  applyOutlookCountProposal,
  beginOutlookCountProposal,
  restoreOutlookRecent,
  undoOutlookCountProposal,
} from "@/features/seriesComparison/outlook/outlookApplication";
import type { OutlookCountProposal } from "@/features/seriesComparison/outlook/outlookApplication";
import { editOutlook } from "@/features/seriesComparison/outlook/outlookEditing";
import type { OutlookEdit } from "@/features/seriesComparison/outlook/outlookEditing";
import type {
  OutlookRole,
  OutlookSession,
} from "@/features/seriesComparison/outlook/outlookSession";
import {
  useOutlookEdit,
  useOutlookInternalStore,
  useOutlookProjection,
} from "@/features/seriesComparison/outlook/OutlookSessionOwner";
import {
  outlookCountProposalView,
  outlookPlayerInput,
  outlookPlayerView,
} from "@/features/seriesComparison/outlook/outlookViews";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";

/** The page input and the dialog proposal have distinct lifetimes and share pure transitions. */
export function useOutlookPlayerModel({
  response,
  role,
  memberId,
  cumulative,
  names,
  showComparison,
}: {
  response: SeriesAnalysisOutlookSummary;
  role: OutlookRole;
  memberId: string;
  cumulative: CumulativePair;
  names: readonly [string, string];
  showComparison: boolean;
}) {
  const store = useOutlookInternalStore();
  const edit = useOutlookEdit();
  const input = useOutlookProjection(
    useCallback((session: OutlookSession) => outlookPlayerInput(session, role), [role]),
  );
  const editor = useMemo(
    () => outlookPlayerView(input, response, memberId, showComparison),
    [input, response, memberId, showComparison],
  );
  const [proposal, setProposal] = useState<OutlookCountProposal>();
  const openCounts = (open: boolean) => {
    const current = store.read();
    setProposal(
      open && current ? beginOutlookCountProposal(current, role, cumulative, names) : undefined,
    );
  };
  const editCounts = (intent: OutlookEdit) =>
    setProposal((current) =>
      current ? { ...current, draft: editOutlook(current.draft, intent) } : current,
    );
  const undoCounts = () =>
    setProposal((current) => (current ? undoOutlookCountProposal(current) : current));
  const applyCounts = () => {
    const current = store.read();
    if (!current || !proposal) return;
    const result = applyOutlookCountProposal(current, proposal);
    store.commit(result.session);
    if (result.applied) setProposal(undefined);
  };
  const resetRecent = () => {
    const current = store.read();
    if (current) store.commit(restoreOutlookRecent(current, response, memberId, role));
  };
  return {
    editor,
    edit,
    resetRecent,
    dialog: {
      open: proposal !== undefined,
      setOpen: openCounts,
      edit: editCounts,
      undo: undoCounts,
      apply: applyCounts,
      proposal: proposal ? outlookCountProposalView(proposal, input) : undefined,
    },
  };
}

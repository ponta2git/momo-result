import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  MatchFormValues,
  MatchWorkspaceInitialData,
} from "@/features/matches/workspace/matchFormTypes";
import {
  buildReviewItems,
  countChangedReviewCells,
} from "@/features/matches/workspace/review/reviewProgress";
import { reviewCellId } from "@/features/matches/workspace/review/reviewWarningModel";
import type { ReviewFieldKey } from "@/features/matches/workspace/review/reviewWarningModel";
import { incidentDefinitions } from "@/shared/domain/incidents";

export function useMatchWorkspaceReviewState({
  reviewKey,
  values,
  workspaceData,
}: {
  reviewKey: string;
  values: MatchFormValues;
  workspaceData: MatchWorkspaceInitialData | null;
}) {
  const [acknowledgedCellIds, setAcknowledgedCellIds] = useState<string[]>([]);
  const [activeCellId, setActiveCellId] = useState<string | null>(null);

  useEffect(() => {
    setAcknowledgedCellIds([]);
    setActiveCellId(null);
  }, [reviewKey]);

  const items = useMemo(
    () =>
      buildReviewItems({
        incidentByPlayOrder: workspaceData?.incidentByPlayOrder,
        originalPlayers: workspaceData?.originalPlayers,
        players: values.players,
      }),
    [values.players, workspaceData?.incidentByPlayOrder, workspaceData?.originalPlayers],
  );
  const acknowledgedSet = useMemo(() => new Set(acknowledgedCellIds), [acknowledgedCellIds]);
  const unresolvedItems = items.filter((item) => !acknowledgedSet.has(item.cellId));
  const changedCount = useMemo(
    () =>
      countChangedReviewCells({
        incidentByPlayOrder: workspaceData?.incidentByPlayOrder,
        originalPlayers: workspaceData?.originalPlayers,
        players: values.players,
      }),
    [values.players, workspaceData?.incidentByPlayOrder, workspaceData?.originalPlayers],
  );

  const focusCell = useCallback((row: number, field: ReviewFieldKey) => {
    setActiveCellId(reviewCellId(row, field));
  }, []);

  const acknowledgeCell = useCallback((cellId: string) => {
    setAcknowledgedCellIds((current) =>
      current.includes(cellId) ? current : [...current, cellId],
    );
  }, []);

  const restoreAcknowledgedCellIds = useCallback(
    (cellIds: readonly string[]) => {
      const knownCellIds = new Set(items.map((item) => item.cellId));
      setAcknowledgedCellIds([...new Set(cellIds.filter((cellId) => knownCellIds.has(cellId)))]);
    },
    [items],
  );

  const markFieldChanged = useCallback((row: number, field: ReviewFieldKey) => {
    const cellId = reviewCellId(row, field);
    setActiveCellId(cellId);
    setAcknowledgedCellIds((current) =>
      current.includes(cellId) ? current : [...current, cellId],
    );
  }, []);

  const markPlayOrderChanged = useCallback((row: number) => {
    const playOrderCellId = reviewCellId(row, "playOrder");
    const incidentCellIds = new Set(
      incidentDefinitions.map((definition) => reviewCellId(row, `incident.${definition.key}`)),
    );
    setActiveCellId(playOrderCellId);
    setAcknowledgedCellIds((current) => [
      ...current.filter((cellId) => !incidentCellIds.has(cellId)),
      ...(current.includes(playOrderCellId) ? [] : [playOrderCellId]),
    ]);
  }, []);

  return {
    acknowledgeCell,
    acknowledgedCellIds,
    activeCellId,
    changedCount,
    focusCell,
    items,
    markFieldChanged,
    markPlayOrderChanged,
    restoreAcknowledgedCellIds,
    unresolvedCount: unresolvedItems.length,
  };
}

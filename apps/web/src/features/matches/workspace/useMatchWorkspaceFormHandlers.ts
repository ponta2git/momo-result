import { useCallback } from "react";
import type { Dispatch } from "react";

import type { MatchFormAction } from "@/features/matches/workspace/matchFormReducer";
import type {
  IncidentKey,
  MatchFormValues,
  MatchWorkspaceInitialData,
} from "@/features/matches/workspace/matchFormTypes";
import type { ReviewFieldKey } from "@/features/matches/workspace/review/reviewWarningModel";
import { toIsoFromLocal } from "@/features/matches/workspace/workspaceDerivations";

export function useMatchWorkspaceFormHandlers({
  createHeldEvent,
  dispatch,
  eventDraftValue,
  onReviewFieldChange,
  onReviewPlayOrderChange,
  workspaceData,
}: {
  createHeldEvent: (payload: { heldAt: string }) => void;
  dispatch: Dispatch<MatchFormAction>;
  eventDraftValue: string;
  onReviewFieldChange: (row: number, field: ReviewFieldKey) => void;
  onReviewPlayOrderChange: (row: number) => void;
  workspaceData: MatchWorkspaceInitialData | null;
}) {
  const onCreateEvent = useCallback(() => {
    createHeldEvent({
      heldAt: toIsoFromLocal(eventDraftValue),
    });
  }, [createHeldEvent, eventDraftValue]);

  const onGameTitleChange = useCallback(
    (gameTitleId: string) => {
      dispatch({
        patch: {
          gameTitleId,
          mapMasterId: "",
          seasonMasterId: "",
        },
        type: "patch_root",
      });
    },
    [dispatch],
  );

  const onIncidentChange = useCallback(
    (index: number, key: IncidentKey, value: number) => {
      dispatch({ index, key, type: "patch_incident", value });
      onReviewFieldChange(index, `incident.${key}`);
    },
    [dispatch, onReviewFieldChange],
  );

  const onPatchRoot = useCallback(
    (patch: Partial<MatchFormValues>) => dispatch({ patch, type: "patch_root" }),
    [dispatch],
  );

  const onPlayerChange = useCallback(
    (index: number, patch: Partial<MatchFormValues["players"][number]>) => {
      dispatch({ index, patch, type: "patch_player" });
      for (const field of ["memberId", "rank", "revenueManYen", "totalAssetsManYen"] as const) {
        if (field in patch) {
          onReviewFieldChange(index, field);
        }
      }
    },
    [dispatch, onReviewFieldChange],
  );

  const onPlayOrderChange = useCallback(
    (index: number, playOrder: number) => {
      onReviewPlayOrderChange(index);
      dispatch(
        workspaceData?.incidentByPlayOrder
          ? {
              incidentByPlayOrder: workspaceData.incidentByPlayOrder,
              index,
              playOrder,
              type: "sync_incidents_from_play_order",
            }
          : {
              index,
              playOrder,
              type: "set_play_order",
            },
      );
    },
    [dispatch, onReviewPlayOrderChange, workspaceData?.incidentByPlayOrder],
  );

  return {
    onCreateEvent,
    onGameTitleChange,
    onIncidentChange,
    onPatchRoot,
    onPlayerChange,
    onPlayOrderChange,
  };
}

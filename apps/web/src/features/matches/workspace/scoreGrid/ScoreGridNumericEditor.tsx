import { memo, useCallback } from "react";

import type { IncidentKey, MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import {
  NumericInputCell,
  type NumericInputCellProps,
} from "@/features/matches/workspace/scoreGrid/ScoreGridNumericInputCell";
import type {
  NumericKeyboardHandler,
  PreferredImageKind,
  RegisterCellRef,
} from "@/features/matches/workspace/scoreGrid/ScoreGridNumericInputCell";

export type { NumericKeyboardHandler, PreferredImageKind, RegisterCellRef };

export type NumericPlayerField = "rank" | "revenueManYen" | "totalAssetsManYen";
export type PlayerNumericCommit = (index: number, field: NumericPlayerField, value: number) => void;
export type IncidentNumericCommit = (index: number, key: IncidentKey, value: number) => void;

type ScoreGridNumericEditorProps = Omit<NumericInputCellProps, "onCommit"> &
  (
    | {
        commitKind: "player";
        field: NumericPlayerField;
        incidentKey?: never;
        onIncidentCommit?: never;
        onPlayerCommit: PlayerNumericCommit;
      }
    | {
        commitKind: "incident";
        field?: never;
        incidentKey: IncidentKey;
        onIncidentCommit: IncidentNumericCommit;
        onPlayerCommit?: never;
      }
  );

export const ScoreGridNumericEditor = memo(function ScoreGridNumericEditor({
  commitKind,
  field,
  incidentKey,
  onIncidentCommit,
  onPlayerCommit,
  row,
  ...inputProps
}: ScoreGridNumericEditorProps) {
  const commitValue = useCallback(
    (value: number) => {
      if (commitKind === "player") {
        onPlayerCommit(row, field, value);
        return;
      }
      onIncidentCommit(row, incidentKey, value);
    },
    [commitKind, field, incidentKey, onIncidentCommit, onPlayerCommit, row],
  );

  return <NumericInputCell {...inputProps} row={row} onCommit={commitValue} />;
});

export type ScoreGridPlayer = MatchFormValues["players"][number];

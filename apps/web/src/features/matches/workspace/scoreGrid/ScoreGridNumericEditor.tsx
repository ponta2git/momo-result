import { memo, useCallback } from "react";

import type { IncidentKey, MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import {
  NumericInputCell,
  type NumericInputCellField,
  type NumericInputCellInteraction,
  type NumericInputCellState,
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

type ScoreGridNumericEditorBaseProps = NumericInputCellField &
  NumericInputCellState &
  Omit<NumericInputCellInteraction, "onCommit">;

type ScoreGridNumericEditorProps = ScoreGridNumericEditorBaseProps &
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
  allowSign,
  ariaLabel,
  baseClassName,
  cellId,
  col,
  error,
  focusImageKind,
  originalValue,
  registerCellRef,
  showStateLabel,
  synced,
  value,
  onIncidentCommit,
  onKeyboard,
  onPreferImageKindChange,
  onPlayerCommit,
  row,
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
  const inputField = { allowSign, ariaLabel, baseClassName, cellId, value };
  const interaction = {
    col,
    focusImageKind,
    registerCellRef,
    row,
    onCommit: commitValue,
    onKeyboard,
    onPreferImageKindChange,
  };
  const state = { error, originalValue, showStateLabel, synced };

  return <NumericInputCell field={inputField} interaction={interaction} state={state} />;
});

export type ScoreGridPlayer = MatchFormValues["players"][number];

import { memo, useCallback } from "react";

import type { IncidentKey } from "@/features/matches/workspace/matchFormTypes";
import * as NumericInput from "@/features/matches/workspace/scoreGrid/ScoreGridNumericInputCell";

export type NumericKeyboardHandler = NumericInput.NumericKeyboardHandler;
export type PreferredImageKind = NumericInput.PreferredImageKind;
export type RegisterCellRef = NumericInput.RegisterCellRef;

export type NumericPlayerField = "rank" | "revenueManYen" | "totalAssetsManYen";
export type PlayerNumericCommit = (index: number, field: NumericPlayerField, value: number) => void;
export type IncidentNumericCommit = (index: number, key: IncidentKey, value: number) => void;

type ScoreGridNumericEditorBaseProps = NumericInput.NumericInputCellField &
  NumericInput.NumericInputCellState &
  Omit<NumericInput.NumericInputCellInteraction, "onCommit">;

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
    (nextValue: number) => {
      if (commitKind === "player") {
        onPlayerCommit(row, field, nextValue);
        return;
      }
      onIncidentCommit(row, incidentKey, nextValue);
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

  return (
    <NumericInput.NumericInputCell field={inputField} interaction={interaction} state={state} />
  );
});

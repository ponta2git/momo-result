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
  reviewField,
  reviewed,
  reviewMessage,
  showStateLabel,
  synced,
  validationPath,
  value,
  onIncidentCommit,
  onKeyboard,
  onPreferImageKindChange,
  onReviewCellFocus,
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
  const inputField = { allowSign, ariaLabel, baseClassName, cellId, validationPath, value };
  const interaction = {
    col,
    focusImageKind,
    registerCellRef,
    reviewField,
    row,
    onCommit: commitValue,
    onKeyboard,
    onPreferImageKindChange,
    onReviewCellFocus,
  };
  const state = { error, originalValue, reviewed, reviewMessage, showStateLabel, synced };

  return (
    <NumericInput.NumericInputCell field={inputField} interaction={interaction} state={state} />
  );
});

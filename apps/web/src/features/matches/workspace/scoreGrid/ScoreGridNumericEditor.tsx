import { memo, useCallback } from "react";

import type { IncidentKey } from "@/features/matches/workspace/matchFormTypes";
import * as NumericInput from "@/features/matches/workspace/scoreGrid/ScoreGridNumericInputCell";

export type NumericKeyboardHandler = NumericInput.NumericKeyboardHandler;
export type PreferredImageKind = NumericInput.PreferredImageKind;
export type RegisterCellRef = NumericInput.RegisterCellRef;

export type NumericPlayerField = "rank" | "revenueManYen" | "totalAssetsManYen";
export type PlayerNumericCommit = (index: number, field: NumericPlayerField, value: number) => void;
export type IncidentNumericCommit = (index: number, key: IncidentKey, value: number) => void;

type ScoreGridNumericEditorBaseProps = Omit<NumericInput.NumericInputCellField, "controlWidth"> &
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
  const controlWidth: NumericInput.NumericInputCellField["controlWidth"] =
    commitKind === "incident" || field === "rank" ? "short" : "wide";

  return (
    <NumericInput.NumericInputCell
      allowSign={allowSign}
      ariaLabel={ariaLabel}
      cellId={cellId}
      col={col}
      controlWidth={controlWidth}
      error={error}
      focusImageKind={focusImageKind}
      originalValue={originalValue}
      registerCellRef={registerCellRef}
      reviewField={reviewField}
      reviewed={reviewed}
      reviewMessage={reviewMessage}
      row={row}
      showStateLabel={showStateLabel}
      synced={synced}
      validationPath={validationPath}
      value={value}
      onCommit={commitValue}
      onKeyboard={onKeyboard}
      onPreferImageKindChange={onPreferImageKindChange}
      onReviewCellFocus={onReviewCellFocus}
    />
  );
});

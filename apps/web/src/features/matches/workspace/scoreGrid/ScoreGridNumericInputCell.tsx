import { memo, useCallback, useRef } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";

import type { ReviewFieldKey } from "@/features/matches/workspace/review/reviewWarningModel";
import { InputControl } from "@/shared/ui/forms/Control";
import type { ControlTone } from "@/shared/ui/forms/Control";
import { contentText, fieldText } from "@/shared/ui/typography";

export type PreferredImageKind = "incident_log" | "revenue" | "total_assets";
export type RegisterCellRef = (cellId: string, node: HTMLElement | null) => void;

type NumericKeyboardArgs = {
  col: number;
  event: KeyboardEvent<HTMLElement>;
  onRevertCell: () => void;
  row: number;
};

export type NumericKeyboardHandler = (args: NumericKeyboardArgs) => void;

type CellViewState = {
  description?: string;
  label?: string;
  tone: ControlTone;
};

function cellViewState(args: {
  currentValue: number;
  error: boolean;
  originalValue: number | undefined;
  reviewMessage: string | undefined;
  reviewed: boolean;
  synced: boolean;
}): CellViewState {
  if (args.error) {
    return {
      label: "要確認",
      tone: "default",
    };
  }

  if (args.reviewMessage && !args.reviewed) {
    return {
      description: args.reviewMessage,
      label: "OCR要確認",
      tone: "review",
    };
  }

  if (args.originalValue !== undefined && args.currentValue !== args.originalValue) {
    return {
      label: "手修正",
      tone: "warning",
    };
  }

  if (args.reviewMessage && args.reviewed) {
    return {
      description: args.reviewMessage,
      label: "確認済み",
      tone: "success",
    };
  }

  if (args.synced) {
    return {
      label: "同期済み",
      tone: "action",
    };
  }

  return {
    tone: "default",
  };
}

function normalizeNumericDraft(input: string, allowSign: boolean): string {
  if (input.trim() === "") {
    return "";
  }

  if (allowSign && input === "-") {
    return input;
  }

  const sign = allowSign && input.startsWith("-") ? "-" : "";
  const rest = sign ? input.slice(1) : input;
  const digits = rest.replaceAll(/\D/gu, "");

  if (!digits) {
    return sign;
  }

  return `${sign}${digits.replace(/^0+(?=\d)/u, "")}`;
}

function parseNumericValue(value: string, allowSign: boolean): number | undefined {
  if (value.trim() === "" || value === "-") {
    return undefined;
  }

  if (allowSign) {
    return /^-?\d+$/u.test(value) ? Number(value) : undefined;
  }

  return /^\d+$/u.test(value) ? Number(value) : undefined;
}

export type NumericInputCellField = {
  allowSign: boolean;
  ariaLabel: string;
  cellId: string;
  controlWidth: "short" | "wide";
  validationPath?: string | undefined;
  value: number;
  draftValue?: string | undefined;
};

export type NumericInputCellInteraction = {
  col?: number | undefined;
  focusImageKind?: PreferredImageKind | undefined;
  registerCellRef?: RegisterCellRef | undefined;
  row: number;
  onCommit: (value: number) => void;
  onDraftChange: (path: string, value: string | undefined) => void;
  onKeyboard?: NumericKeyboardHandler | undefined;
  onPreferImageKindChange?: ((kind: PreferredImageKind) => void) | undefined;
  onReviewCellFocus?: ((row: number, field: ReviewFieldKey) => void) | undefined;
  reviewField?: ReviewFieldKey | undefined;
};

export type NumericInputCellState = {
  error?: boolean | undefined;
  originalValue?: number | undefined;
  reviewMessage?: string | undefined;
  reviewed?: boolean | undefined;
  showStateLabel?: boolean | undefined;
  synced?: boolean | undefined;
};

export type NumericInputCellProps = NumericInputCellField &
  NumericInputCellInteraction &
  NumericInputCellState;

export const NumericInputCell = memo(function NumericInputCell({
  allowSign,
  ariaLabel,
  cellId,
  col,
  controlWidth,
  draftValue,
  error = false,
  focusImageKind,
  originalValue,
  registerCellRef,
  reviewField,
  reviewed = false,
  reviewMessage,
  row,
  showStateLabel = false,
  synced = false,
  validationPath,
  value,
  onCommit,
  onDraftChange,
  onKeyboard,
  onPreferImageKindChange,
  onReviewCellFocus,
}: NumericInputCellProps) {
  const draftPath = validationPath ?? cellId;
  const setDraftValue = useCallback(
    (next: string | undefined) => onDraftChange(draftPath, next),
    [draftPath, onDraftChange],
  );
  const editStartValueRef = useRef<string | null>(null);
  const fallbackValue = Number.isFinite(value) ? String(value) : "";
  const inputValue = draftValue ?? fallbackValue;
  const parsedDraftValue =
    draftValue === undefined ? undefined : parseNumericValue(draftValue, allowSign);
  const currentValue = parsedDraftValue ?? value;
  const viewState: CellViewState = showStateLabel
    ? cellViewState({
        currentValue,
        error,
        originalValue,
        reviewMessage,
        reviewed,
        synced,
      })
    : { tone: "default" };

  const commitInputValue = useCallback(() => {
    const parsed = parseNumericValue(inputValue, allowSign);
    if (parsed === undefined) {
      return;
    }
    if (parsed !== value) onCommit(parsed);
    setDraftValue(undefined);
  }, [allowSign, inputValue, onCommit, setDraftValue, value]);

  const revertCell = useCallback(() => {
    const before = editStartValueRef.current ?? fallbackValue;
    const parsed = parseNumericValue(before, allowSign);
    setDraftValue(before === fallbackValue ? undefined : before);
    if (parsed !== undefined && parsed !== value) {
      onCommit(parsed);
    }
  }, [allowSign, fallbackValue, onCommit, setDraftValue, value]);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setDraftValue(normalizeNumericDraft(event.currentTarget.value, allowSign));
    },
    [allowSign, setDraftValue],
  );

  const handleFocus = useCallback(() => {
    editStartValueRef.current = inputValue;
    if (focusImageKind) {
      onPreferImageKindChange?.(focusImageKind);
    }
    if (reviewField) {
      onReviewCellFocus?.(row, reviewField);
    }
  }, [focusImageKind, inputValue, onPreferImageKindChange, onReviewCellFocus, reviewField, row]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (col === undefined || !onKeyboard) {
        return;
      }
      onKeyboard({
        col,
        event,
        onRevertCell: revertCell,
        row,
      });
    },
    [col, onKeyboard, revertCell, row],
  );

  const handleRef = useCallback(
    (node: HTMLInputElement | null) => {
      registerCellRef?.(cellId, node);
    },
    [cellId, registerCellRef],
  );

  return (
    <>
      <div
        className={
          controlWidth === "short" ? "min-w-[6ch] tabular-nums" : "min-w-[12ch] tabular-nums"
        }
      >
        <InputControl
          ref={registerCellRef ? handleRef : undefined}
          aria-label={ariaLabel}
          aria-describedby={showStateLabel && viewState.label ? `${cellId}-status` : undefined}
          data-validation-path={validationPath}
          density="compact"
          id={cellId}
          inputMode="numeric"
          invalid={error}
          textAlign={controlWidth === "short" ? "center" : "end"}
          tone={viewState.tone}
          type="text"
          value={inputValue}
          onBlur={commitInputValue}
          onChange={handleChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
        />
      </div>
      {showStateLabel ? (
        <div className="min-h-5 pt-1">
          {viewState.label ? (
            <p className={error ? fieldText.error : contentText.supporting} id={`${cellId}-status`}>
              {viewState.label}
              {viewState.description ? (
                <span className="sr-only">：{viewState.description}</span>
              ) : null}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
});

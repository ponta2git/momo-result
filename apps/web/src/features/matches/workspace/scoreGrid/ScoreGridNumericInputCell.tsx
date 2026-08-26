import { memo, useCallback, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";

import type { ReviewFieldKey } from "@/features/matches/workspace/review/reviewWarningModel";
import { InputControl } from "@/shared/ui/forms/Control";
import type { ControlTone } from "@/shared/ui/forms/Control";

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
};

export type NumericInputCellInteraction = {
  col?: number | undefined;
  focusImageKind?: PreferredImageKind | undefined;
  registerCellRef?: RegisterCellRef | undefined;
  row: number;
  onCommit: (value: number) => void;
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

export type NumericInputCellProps = {
  field: NumericInputCellField;
  interaction: NumericInputCellInteraction;
  state?: NumericInputCellState | undefined;
};

export const NumericInputCell = memo(function NumericInputCell({
  field,
  interaction,
  state,
}: NumericInputCellProps) {
  const [draftValue, setDraftValue] = useState<string | undefined>(undefined);
  const editStartValueRef = useRef<string | null>(null);
  const fallbackValue = Number.isFinite(field.value) ? String(field.value) : "";
  const inputValue = draftValue ?? fallbackValue;
  const parsedDraftValue =
    draftValue === undefined ? undefined : parseNumericValue(draftValue, field.allowSign);
  const currentValue = parsedDraftValue ?? field.value;
  const viewState: CellViewState = state?.showStateLabel
    ? cellViewState({
        currentValue,
        error: state.error ?? false,
        originalValue: state.originalValue,
        reviewMessage: state.reviewMessage,
        reviewed: state.reviewed ?? false,
        synced: state.synced ?? false,
      })
    : { tone: "default" };

  const commitInputValue = useCallback(() => {
    const parsed = parseNumericValue(inputValue, field.allowSign);
    if (parsed === undefined) {
      return;
    }
    interaction.onCommit(parsed);
    setDraftValue(undefined);
  }, [field.allowSign, inputValue, interaction]);

  const revertCell = useCallback(() => {
    const before = editStartValueRef.current ?? fallbackValue;
    const parsed = parseNumericValue(before, field.allowSign);
    setDraftValue(before);
    if (parsed !== undefined) {
      interaction.onCommit(parsed);
    }
  }, [fallbackValue, field.allowSign, interaction]);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setDraftValue(normalizeNumericDraft(event.currentTarget.value, field.allowSign));
    },
    [field.allowSign],
  );

  const handleFocus = useCallback(() => {
    editStartValueRef.current = inputValue;
    if (interaction.focusImageKind) {
      interaction.onPreferImageKindChange?.(interaction.focusImageKind);
    }
    if (interaction.reviewField) {
      interaction.onReviewCellFocus?.(interaction.row, interaction.reviewField);
    }
  }, [inputValue, interaction]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (interaction.col === undefined || !interaction.onKeyboard) {
        return;
      }
      interaction.onKeyboard({
        col: interaction.col,
        event,
        onRevertCell: revertCell,
        row: interaction.row,
      });
    },
    [interaction, revertCell],
  );

  const handleRef = useCallback(
    (node: HTMLInputElement | null) => {
      interaction.registerCellRef?.(field.cellId, node);
    },
    [field.cellId, interaction],
  );

  return (
    <>
      <InputControl
        ref={interaction.registerCellRef ? handleRef : undefined}
        aria-label={field.ariaLabel}
        aria-describedby={
          state?.showStateLabel && viewState.label ? `${field.cellId}-status` : undefined
        }
        className={
          field.controlWidth === "short" ? "min-w-[6ch] tabular-nums" : "min-w-[12ch] tabular-nums"
        }
        data-validation-path={field.validationPath}
        density="compact"
        id={field.cellId}
        inputMode="numeric"
        invalid={state?.error ?? false}
        textAlign={field.controlWidth === "short" ? "center" : "end"}
        tone={viewState.tone}
        type="text"
        value={inputValue}
        onBlur={commitInputValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
      />
      {state?.showStateLabel ? (
        <div className="min-h-5 pt-1">
          {viewState.label ? (
            <p
              key={viewState.label}
              className="momo-enter text-xs leading-4 text-[var(--color-text-secondary)]"
              id={`${field.cellId}-status`}
            >
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

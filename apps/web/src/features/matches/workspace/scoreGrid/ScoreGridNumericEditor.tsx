import { AnimatePresence, motion } from "motion/react";
import { memo, useCallback, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";

import type { IncidentKey, MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import { momoTransition } from "@/shared/ui/motion/variants";

export type NumericPlayerField = "rank" | "revenueManYen" | "totalAssetsManYen";
export type PreferredImageKind = "incident_log" | "revenue" | "total_assets";
export type RegisterCellRef = (cellId: string, node: HTMLElement | null) => void;

type NumericKeyboardArgs = {
  col: number;
  event: KeyboardEvent<HTMLElement>;
  onRevertCell: () => void;
  row: number;
};

export type NumericKeyboardHandler = (args: NumericKeyboardArgs) => void;
export type PlayerNumericCommit = (index: number, field: NumericPlayerField, value: number) => void;
export type IncidentNumericCommit = (index: number, key: IncidentKey, value: number) => void;

type CellViewState = {
  label?: string;
  toneClass: string;
};

function cellViewState(args: {
  currentValue: number;
  error: boolean;
  originalValue: number | undefined;
  synced: boolean;
}): CellViewState {
  if (args.error) {
    return {
      label: "要確認",
      toneClass: "border-[var(--color-danger)]/65 bg-[var(--color-danger)]/10",
    };
  }

  if (args.synced) {
    return {
      label: "同期済み",
      toneClass: "border-[var(--color-action)]/55 bg-[var(--color-action)]/10",
    };
  }

  if (args.originalValue !== undefined && args.currentValue !== args.originalValue) {
    return {
      label: "手修正",
      toneClass: "border-[var(--color-warning)]/65 bg-[var(--color-warning)]/18",
    };
  }

  return {
    toneClass: "",
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

type ScoreGridNumericEditorProps = {
  allowSign: boolean;
  ariaLabel: string;
  baseClassName: string;
  cellId: string;
  col?: number | undefined;
  error?: boolean | undefined;
  focusImageKind?: PreferredImageKind | undefined;
  originalValue?: number | undefined;
  registerCellRef?: RegisterCellRef | undefined;
  row: number;
  showStateLabel?: boolean | undefined;
  synced?: boolean | undefined;
  value: number;
  onKeyboard?: NumericKeyboardHandler | undefined;
  onPreferImageKindChange?: ((kind: PreferredImageKind) => void) | undefined;
} & (
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
  allowSign,
  ariaLabel,
  baseClassName,
  cellId,
  col,
  error = false,
  focusImageKind,
  originalValue,
  registerCellRef,
  row,
  showStateLabel = false,
  synced = false,
  value,
  onKeyboard,
  onPreferImageKindChange,
  ...commitProps
}: ScoreGridNumericEditorProps) {
  const [draftValue, setDraftValue] = useState<string | undefined>(undefined);
  const editStartValueRef = useRef<string | null>(null);
  const fallbackValue = Number.isFinite(value) ? String(value) : "";
  const inputValue = draftValue ?? fallbackValue;
  const parsedDraftValue =
    draftValue === undefined ? undefined : parseNumericValue(draftValue, allowSign);
  const currentValue = parsedDraftValue ?? value;
  const viewState = showStateLabel
    ? cellViewState({
        currentValue,
        error,
        originalValue,
        synced,
      })
    : { toneClass: "" };

  const commitParsedValue = useCallback(
    (parsed: number) => {
      if (commitProps.commitKind === "player") {
        commitProps.onPlayerCommit(row, commitProps.field, parsed);
        return;
      }
      commitProps.onIncidentCommit(row, commitProps.incidentKey, parsed);
    },
    [commitProps, row],
  );

  const commitInputValue = useCallback(() => {
    const parsed = parseNumericValue(inputValue, allowSign);
    if (parsed === undefined) {
      return;
    }
    commitParsedValue(parsed);
    setDraftValue(undefined);
  }, [allowSign, commitParsedValue, inputValue]);

  const revertCell = useCallback(() => {
    const before = editStartValueRef.current ?? fallbackValue;
    const parsed = parseNumericValue(before, allowSign);
    setDraftValue(before);
    if (parsed !== undefined) {
      commitParsedValue(parsed);
    }
  }, [allowSign, commitParsedValue, fallbackValue]);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setDraftValue(normalizeNumericDraft(event.currentTarget.value, allowSign));
    },
    [allowSign],
  );

  const handleFocus = useCallback(() => {
    editStartValueRef.current = inputValue;
    if (focusImageKind) {
      onPreferImageKindChange?.(focusImageKind);
    }
  }, [focusImageKind, inputValue, onPreferImageKindChange]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (col === undefined || !onKeyboard) {
        return;
      }
      onKeyboard({ col, event, onRevertCell: revertCell, row });
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
      <input
        ref={registerCellRef ? handleRef : undefined}
        aria-label={ariaLabel}
        className={`${baseClassName} ${viewState.toneClass}`}
        id={cellId}
        inputMode="numeric"
        type="text"
        value={inputValue}
        onBlur={commitInputValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
      />
      <AnimatePresence initial={false}>
        {showStateLabel && viewState.label ? (
          <motion.p
            key={viewState.label}
            animate={{ opacity: 1, y: 0 }}
            className="mt-1 text-[0.68rem] text-[var(--color-text-secondary)]"
            exit={{ opacity: 0, y: -2 }}
            initial={{ opacity: 0, y: 2 }}
            transition={momoTransition}
          >
            {viewState.label}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </>
  );
});

export type ScoreGridPlayer = MatchFormValues["players"][number];

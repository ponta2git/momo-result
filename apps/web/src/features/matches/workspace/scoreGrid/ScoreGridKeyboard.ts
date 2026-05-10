import type { KeyboardEvent } from "react";

export type GridPosition = {
  col: number;
  row: number;
};

export type ScoreGridKeyArgs = {
  colCount: number;
  event: KeyboardEvent<HTMLElement>;
  getCellId: (position: GridPosition) => string;
  horizontalEnterFromCol?: number | undefined;
  onFocusCell: (cellId: string) => void;
  onRevertCell: () => void;
  onSubmitFocus: () => void;
  position: GridPosition;
  rowCount: number;
};

function moveWithinColumn(args: ScoreGridKeyArgs, delta: -1 | 1) {
  const nextRow = args.position.row + delta;
  if (nextRow >= 0 && nextRow < args.rowCount) {
    args.event.preventDefault();
    args.onFocusCell(args.getCellId({ col: args.position.col, row: nextRow }));
  }
}

function moveByEnter(args: ScoreGridKeyArgs, reverse: boolean) {
  args.event.preventDefault();

  if (
    args.horizontalEnterFromCol !== undefined &&
    args.position.col >= args.horizontalEnterFromCol
  ) {
    const nextCol = reverse ? args.position.col - 1 : args.position.col + 1;
    if (nextCol >= args.horizontalEnterFromCol && nextCol < args.colCount) {
      args.onFocusCell(args.getCellId({ col: nextCol, row: args.position.row }));
      return;
    }

    const nextRow = reverse ? args.position.row - 1 : args.position.row + 1;
    if (nextRow < 0 || nextRow >= args.rowCount) {
      return;
    }
    const wrappedCol = reverse ? args.colCount - 1 : args.horizontalEnterFromCol;
    args.onFocusCell(args.getCellId({ col: wrappedCol, row: nextRow }));
    return;
  }

  const delta = reverse ? -1 : 1;
  const nextRow = args.position.row + delta;
  if (nextRow >= 0 && nextRow < args.rowCount) {
    args.onFocusCell(args.getCellId({ col: args.position.col, row: nextRow }));
    return;
  }

  const nextCol = reverse ? args.position.col - 1 : args.position.col + 1;
  if (nextCol < 0 || nextCol >= args.colCount) {
    return;
  }

  const wrappedRow = reverse ? args.rowCount - 1 : 0;
  args.onFocusCell(args.getCellId({ col: nextCol, row: wrappedRow }));
}

export function handleScoreGridKeydown(args: ScoreGridKeyArgs): void {
  const isComposing =
    typeof args.event.nativeEvent === "object" &&
    "isComposing" in args.event.nativeEvent &&
    Boolean(args.event.nativeEvent.isComposing);

  if ((args.event.metaKey || args.event.ctrlKey) && args.event.key === "Enter") {
    args.event.preventDefault();
    args.onSubmitFocus();
    return;
  }

  if (isComposing) {
    return;
  }

  if (args.event.key === "Escape") {
    args.event.preventDefault();
    args.onRevertCell();
    return;
  }

  if (args.event.key === "Enter") {
    moveByEnter(args, args.event.shiftKey);
    return;
  }

  if (args.event.key === "ArrowUp") {
    moveWithinColumn(args, -1);
    return;
  }

  if (args.event.key === "ArrowDown") {
    moveWithinColumn(args, 1);
  }
}

// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import type { GridPosition, ScoreGridKeyArgs, ScoreGridKeyboardEvent } from "./ScoreGridKeyboard";
import { handleScoreGridKeydown } from "./ScoreGridKeyboard";

type EventOverrides = Partial<Omit<ScoreGridKeyboardEvent, "preventDefault">> & {
  preventDefault?: ScoreGridKeyboardEvent["preventDefault"];
};

function createKeyboardEvent(overrides: EventOverrides = {}) {
  return {
    ctrlKey: false,
    key: "Enter",
    metaKey: false,
    nativeEvent: {},
    preventDefault: vi.fn(),
    shiftKey: false,
    ...overrides,
  } satisfies ScoreGridKeyboardEvent;
}

function cellId(position: GridPosition): string {
  return `r${position.row}c${position.col}`;
}

function buildArgs(
  overrides: Partial<Omit<ScoreGridKeyArgs, "event" | "getCellId">> & {
    event?: EventOverrides;
  } = {},
) {
  const { event: eventOverrides, ...argsOverrides } = overrides;
  const event = createKeyboardEvent(eventOverrides);
  const onFocusCell = vi.fn();
  const onRevertCell = vi.fn();
  const onSubmitFocus = vi.fn();
  const args = {
    colCount: 3,
    event,
    getCellId: cellId,
    onFocusCell,
    onRevertCell,
    onSubmitFocus,
    position: { col: 1, row: 1 },
    rowCount: 3,
    ...argsOverrides,
  } satisfies ScoreGridKeyArgs;

  return { args, event, onFocusCell, onRevertCell, onSubmitFocus };
}

describe("handleScoreGridKeydown", () => {
  it.each([
    {
      event: { key: "Enter" },
      expectedCellId: "r2c1",
      name: "moves Enter down within the same column",
      position: { col: 1, row: 1 },
    },
    {
      event: { key: "Enter", shiftKey: true },
      expectedCellId: "r0c1",
      name: "moves Shift+Enter up within the same column",
      position: { col: 1, row: 1 },
    },
    {
      event: { key: "Enter" },
      expectedCellId: "r0c2",
      name: "wraps Enter from the bottom row to the next column",
      position: { col: 1, row: 2 },
    },
    {
      event: { key: "Enter", shiftKey: true },
      expectedCellId: "r2c0",
      name: "wraps Shift+Enter from the top row to the previous column",
      position: { col: 1, row: 0 },
    },
  ] satisfies Array<{
    event: EventOverrides;
    expectedCellId: string;
    name: string;
    position: GridPosition;
  }>)("$name", ({ event, expectedCellId, position }) => {
    const context = buildArgs({ event, position });

    handleScoreGridKeydown(context.args);

    expect(context.event.preventDefault).toHaveBeenCalledOnce();
    expect(context.onFocusCell).toHaveBeenCalledExactlyOnceWith(expectedCellId);
  });

  it.each([
    {
      event: { key: "Enter" },
      name: "stops Enter at the last cell",
      position: { col: 2, row: 2 },
    },
    {
      event: { key: "Enter", shiftKey: true },
      name: "stops Shift+Enter at the first cell",
      position: { col: 0, row: 0 },
    },
  ] satisfies Array<{
    event: EventOverrides;
    name: string;
    position: GridPosition;
  }>)("$name", ({ event, position }) => {
    const context = buildArgs({ event, position });

    handleScoreGridKeydown(context.args);

    expect(context.event.preventDefault).toHaveBeenCalledOnce();
    expect(context.onFocusCell).not.toHaveBeenCalled();
  });

  it.each([
    {
      event: { key: "Enter" },
      expectedCellId: "r1c3",
      name: "moves Enter horizontally inside configured columns",
      position: { col: 2, row: 1 },
    },
    {
      event: { key: "Enter" },
      expectedCellId: "r2c2",
      name: "wraps Enter to the first horizontal column on the next row",
      position: { col: 3, row: 1 },
    },
    {
      event: { key: "Enter", shiftKey: true },
      expectedCellId: "r1c2",
      name: "moves Shift+Enter horizontally backward",
      position: { col: 3, row: 1 },
    },
    {
      event: { key: "Enter", shiftKey: true },
      expectedCellId: "r0c3",
      name: "wraps Shift+Enter to the last horizontal column on the previous row",
      position: { col: 2, row: 1 },
    },
  ] satisfies Array<{
    event: EventOverrides;
    expectedCellId: string;
    name: string;
    position: GridPosition;
  }>)("$name", ({ event, expectedCellId, position }) => {
    const context = buildArgs({ colCount: 4, event, horizontalEnterFromCol: 2, position });

    handleScoreGridKeydown(context.args);

    expect(context.event.preventDefault).toHaveBeenCalledOnce();
    expect(context.onFocusCell).toHaveBeenCalledExactlyOnceWith(expectedCellId);
  });

  it("uses vertical Enter behavior before the horizontal range", () => {
    const context = buildArgs({
      colCount: 4,
      event: { key: "Enter" },
      horizontalEnterFromCol: 2,
      position: { col: 1, row: 1 },
    });

    handleScoreGridKeydown(context.args);

    expect(context.event.preventDefault).toHaveBeenCalledOnce();
    expect(context.onFocusCell).toHaveBeenCalledExactlyOnceWith("r2c1");
  });

  it.each([
    {
      event: { key: "Enter" },
      name: "stops horizontal Enter at the last row",
      position: { col: 3, row: 2 },
    },
    {
      event: { key: "Enter", shiftKey: true },
      name: "stops horizontal Shift+Enter at the first row",
      position: { col: 2, row: 0 },
    },
  ] satisfies Array<{
    event: EventOverrides;
    name: string;
    position: GridPosition;
  }>)("$name", ({ event, position }) => {
    const context = buildArgs({ colCount: 4, event, horizontalEnterFromCol: 2, position });

    handleScoreGridKeydown(context.args);

    expect(context.event.preventDefault).toHaveBeenCalledOnce();
    expect(context.onFocusCell).not.toHaveBeenCalled();
  });

  it.each([
    {
      event: { key: "ArrowUp" },
      expectedCellId: "r0c1",
      name: "moves ArrowUp within the same column",
      position: { col: 1, row: 1 },
    },
    {
      event: { key: "ArrowDown" },
      expectedCellId: "r2c1",
      name: "moves ArrowDown within the same column",
      position: { col: 1, row: 1 },
    },
  ] satisfies Array<{
    event: EventOverrides;
    expectedCellId: string;
    name: string;
    position: GridPosition;
  }>)("$name", ({ event, expectedCellId, position }) => {
    const context = buildArgs({ event, position });

    handleScoreGridKeydown(context.args);

    expect(context.event.preventDefault).toHaveBeenCalledOnce();
    expect(context.onFocusCell).toHaveBeenCalledExactlyOnceWith(expectedCellId);
  });

  it.each([
    {
      event: { key: "ArrowUp" },
      name: "ignores ArrowUp at the first row",
      position: { col: 1, row: 0 },
    },
    {
      event: { key: "ArrowDown" },
      name: "ignores ArrowDown at the last row",
      position: { col: 1, row: 2 },
    },
  ] satisfies Array<{
    event: EventOverrides;
    name: string;
    position: GridPosition;
  }>)("$name", ({ event, position }) => {
    const context = buildArgs({ event, position });

    handleScoreGridKeydown(context.args);

    expect(context.event.preventDefault).not.toHaveBeenCalled();
    expect(context.onFocusCell).not.toHaveBeenCalled();
  });

  it.each([
    {
      event: { key: "Enter", metaKey: true },
      name: "moves focus to submit on Command+Enter",
    },
    {
      event: { ctrlKey: true, key: "Enter" },
      name: "moves focus to submit on Control+Enter",
    },
  ] satisfies Array<{
    event: EventOverrides;
    name: string;
  }>)("$name", ({ event }) => {
    const context = buildArgs({ event });

    handleScoreGridKeydown(context.args);

    expect(context.event.preventDefault).toHaveBeenCalledOnce();
    expect(context.onSubmitFocus).toHaveBeenCalledOnce();
    expect(context.onFocusCell).not.toHaveBeenCalled();
  });

  it("reverts the current cell on Escape", () => {
    const context = buildArgs({ event: { key: "Escape" } });

    handleScoreGridKeydown(context.args);

    expect(context.event.preventDefault).toHaveBeenCalledOnce();
    expect(context.onRevertCell).toHaveBeenCalledOnce();
  });

  it("does not handle composing text input", () => {
    const context = buildArgs({ event: { key: "Enter", nativeEvent: { isComposing: true } } });

    handleScoreGridKeydown(context.args);

    expect(context.event.preventDefault).not.toHaveBeenCalled();
    expect(context.onFocusCell).not.toHaveBeenCalled();
    expect(context.onRevertCell).not.toHaveBeenCalled();
    expect(context.onSubmitFocus).not.toHaveBeenCalled();
  });

  it("ignores unrelated keys", () => {
    const context = buildArgs({ event: { key: "Tab" } });

    handleScoreGridKeydown(context.args);

    expect(context.event.preventDefault).not.toHaveBeenCalled();
    expect(context.onFocusCell).not.toHaveBeenCalled();
  });
});

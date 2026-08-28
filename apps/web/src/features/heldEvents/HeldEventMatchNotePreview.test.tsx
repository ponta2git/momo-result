import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HeldEventMatchNotePreview } from "@/features/heldEvents/HeldEventMatchNotePreview";

let clientHeight = 72;
let scrollHeight = 72;
let resizeCallback: ResizeObserverCallback | undefined;
let originalClientHeight: PropertyDescriptor | undefined;
let originalResizeObserver: PropertyDescriptor | undefined;
let originalScrollHeight: PropertyDescriptor | undefined;

const resizeObserverArgument: ResizeObserver = {
  disconnect: () => undefined,
  observe: () => undefined,
  unobserve: () => undefined,
};

class ControlledResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }

  disconnect() {
    return undefined;
  }
  observe() {
    return undefined;
  }
  unobserve() {
    return undefined;
  }
}

function resizeNote(nextScrollHeight: number) {
  scrollHeight = nextScrollHeight;
  const callback = resizeCallback;
  if (!callback) throw new Error("ResizeObserver is not connected");
  act(() => callback([], resizeObserverArgument));
}

beforeEach(() => {
  clientHeight = 72;
  scrollHeight = 72;
  resizeCallback = undefined;
  originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  originalResizeObserver = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => clientHeight,
  });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => scrollHeight,
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: ControlledResizeObserver,
  });
});

afterEach(() => {
  if (originalClientHeight) {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
  } else {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)["clientHeight"];
  }
  if (originalScrollHeight) {
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
  } else {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)["scrollHeight"];
  }
  if (originalResizeObserver) {
    Object.defineProperty(globalThis, "ResizeObserver", originalResizeObserver);
  } else {
    delete (globalThis as unknown as Record<string, unknown>)["ResizeObserver"];
  }
});

describe("HeldEventMatchNotePreview", () => {
  it("offers expansion only while the current width truncates the note", () => {
    render(<HeldEventMatchNotePreview body="3行以内の試合メモ" />);

    expect(screen.queryByRole("button", { name: "メモ全文を表示" })).not.toBeInTheDocument();

    resizeNote(96);
    expect(screen.getByRole("button", { name: "メモ全文を表示" })).toBeInTheDocument();

    resizeNote(72);
    expect(screen.queryByRole("button", { name: "メモ全文を表示" })).not.toBeInTheDocument();
  });

  it("exposes the controlled note and its expanded state while reading the full text", async () => {
    scrollHeight = 96;
    const user = userEvent.setup();
    render(<HeldEventMatchNotePreview body={"終盤のカード交換で\n流れが変わった"} />);

    const note = screen.getByText(/終盤のカード交換/u);
    const expand = screen.getByRole("button", { name: "メモ全文を表示" });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    expect(expand).toHaveAttribute("aria-controls", note.id);
    expect(note).toHaveClass("line-clamp-3");

    clientHeight = 96;
    await user.click(expand);

    const collapse = screen.getByRole("button", { name: "メモを閉じる" });
    expect(collapse).toBe(expand);
    expect(collapse).toHaveFocus();
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    expect(collapse).toHaveAttribute("aria-controls", note.id);
    expect(note).not.toHaveClass("line-clamp-3");

    clientHeight = 72;
    await user.click(collapse);

    const reopened = screen.getByRole("button", { name: "メモ全文を表示" });
    expect(reopened).toBe(expand);
    expect(reopened).toHaveFocus();
    expect(reopened).toHaveAttribute("aria-expanded", "false");
    expect(note).toHaveClass("line-clamp-3");
  });
});

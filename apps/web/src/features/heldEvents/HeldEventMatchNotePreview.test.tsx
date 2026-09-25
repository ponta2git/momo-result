import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { HeldEventMatchNotePreview } from "@/features/heldEvents/HeldEventMatchNotePreview";
import { notifyResize } from "@/test/resizeObserver";

function resizeNote(note: HTMLElement, scrollHeight: number, clientHeight = 72) {
  Object.defineProperties(note, {
    clientHeight: { configurable: true, value: clientHeight },
    scrollHeight: { configurable: true, value: scrollHeight },
  });
  act(() => notifyResize(note));
}

describe("HeldEventMatchNotePreview", () => {
  it("offers expansion only while the current width truncates the note", () => {
    render(<HeldEventMatchNotePreview body="3行以内の試合メモ" />);

    expect(screen.queryByRole("button", { name: "メモ全文を表示" })).not.toBeInTheDocument();

    const note = screen.getByText("3行以内の試合メモ");
    resizeNote(note, 96);
    expect(screen.getByRole("button", { name: "メモ全文を表示" })).toBeInTheDocument();

    resizeNote(note, 72);
    expect(screen.queryByRole("button", { name: "メモ全文を表示" })).not.toBeInTheDocument();
  });

  it("exposes the controlled note and its expanded state while reading the full text", async () => {
    const user = userEvent.setup();
    render(<HeldEventMatchNotePreview body={"終盤のカード交換で\n流れが変わった"} />);

    const note = screen.getByText(/終盤のカード交換/u);
    resizeNote(note, 96);
    const expand = screen.getByRole("button", { name: "メモ全文を表示" });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    expect(expand).toHaveAttribute("aria-controls", note.id);

    await user.click(expand);
    resizeNote(note, 96, 96);

    const collapse = screen.getByRole("button", { name: "メモを閉じる" });
    expect(collapse).toBe(expand);
    expect(collapse).toHaveFocus();
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    expect(collapse).toHaveAttribute("aria-controls", note.id);

    resizeNote(note, 96, 72);
    await user.click(collapse);

    const reopened = screen.getByRole("button", { name: "メモ全文を表示" });
    expect(reopened).toBe(expand);
    expect(reopened).toHaveFocus();
    expect(reopened).toHaveAttribute("aria-expanded", "false");
  });
});

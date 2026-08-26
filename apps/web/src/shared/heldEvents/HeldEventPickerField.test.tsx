import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { HeldEventResponse } from "@/shared/api/heldEvents";
import { HeldEventPickerField } from "@/shared/heldEvents/HeldEventPickerField";

const heldEvent = {
  draftCount: 1,
  heldAt: "2026-08-09T00:00:00Z",
  id: "held-1",
  matchCount: 3,
  nextMatchNo: 5,
} satisfies HeldEventResponse;

describe("HeldEventPickerField", () => {
  it("owns held-event copy and returns the selected DTO", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <HeldEventPickerField
        emptyChoiceDescription="開催で絞り込みません。"
        emptyChoiceLabel="すべての開催"
        heldEvents={[heldEvent]}
        label="開催"
        name="held-event"
        value=""
        onValueChange={onValueChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "開催を変更" }));
    const eventChoice = screen.getByRole("radio", {
      name: "2026/08/09 09:00 — 確定 3試合・未完了 1件",
    });
    expect(screen.getByRole("dialog", { name: "開催を選択" })).toHaveTextContent(
      "開催で絞り込みません。",
    );

    await user.click(eventChoice);

    expect(onValueChange).toHaveBeenCalledWith("held-1", heldEvent);
  });

  it("keeps an off-page selected event visible", async () => {
    const user = userEvent.setup();
    render(
      <HeldEventPickerField
        emptyChoiceDescription="開催を選択してください。"
        emptyChoiceLabel="未選択"
        heldEvents={[]}
        label="開催履歴"
        name="held-event"
        selectedHeldEvent={heldEvent}
        value="held-1"
        onValueChange={vi.fn()}
      />,
    );

    expect(screen.getByText("2026/08/09 09:00 — 確定 3試合・未完了 1件")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "開催履歴を変更" }));

    expect(
      screen.getByRole("radio", {
        name: "2026/08/09 09:00 — 確定 3試合・未完了 1件",
      }),
    ).toBeChecked();
  });
});

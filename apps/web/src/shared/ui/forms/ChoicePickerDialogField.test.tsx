import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChoicePickerDialogField } from "@/shared/ui/forms/ChoicePickerDialogField";

describe("ChoicePickerDialogField", () => {
  it("shows the current value and closes the dialog after a descriptive choice", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();

    render(
      <ChoicePickerDialogField
        label="開催"
        name="held-event"
        options={[
          { description: "開催で絞り込みません。", label: "すべての開催", value: "" },
          {
            description: "確定 3試合・未完了 1件",
            label: "2026/08/09 09:00",
            value: "held-1",
          },
        ]}
        selectedLabel="すべての開催"
        value=""
        onValueChange={onValueChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "開催を変更" }));
    const dialog = screen.getByRole("dialog", { name: "開催を選択" });
    expect(dialog).toHaveTextContent("確定 3試合・未完了 1件");

    await user.click(screen.getByRole("radio", { name: /2026\/08\/09 09:00/u }));

    expect(onValueChange).toHaveBeenCalledWith("held-1");
    expect(screen.queryByRole("dialog", { name: "開催を選択" })).not.toBeInTheDocument();
  });

  it("associates a field error with the dialog trigger", () => {
    render(
      <ChoicePickerDialogField
        error="未入力です"
        label="開催履歴（必須）"
        name="held-event"
        options={[]}
        required
        selectedLabel="未選択"
        value=""
        onValueChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: "開催履歴（必須）を変更" });
    expect(trigger).toHaveAttribute("aria-invalid", "true");
    expect(
      document.getElementById(trigger.getAttribute("aria-describedby") ?? ""),
    ).toHaveTextContent("未入力です");
  });
});

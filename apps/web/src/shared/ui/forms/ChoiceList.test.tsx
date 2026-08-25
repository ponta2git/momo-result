import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "@/shared/ui/actions/Button";
import { ChoiceList } from "@/shared/ui/forms/ChoiceList";

describe("ChoiceList", () => {
  it("exposes native exclusive choices with descriptions and a visible selected state", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <ChoiceList
        legend="出力対象"
        name="candidate"
        options={[
          { description: "2026年8月開催", label: "第12回", value: "event-12" },
          { description: "2026年7月開催", label: "第11回", value: "event-11" },
        ]}
        value="event-12"
        onValueChange={onValueChange}
      />,
    );

    expect(screen.getByRole("group", { name: "出力対象" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /第12回/u })).toBeChecked();
    expect(screen.getByText("選択中")).toBeVisible();

    await user.click(screen.getByText("第11回"));
    expect(onValueChange).toHaveBeenCalledWith("event-11");
  });

  it("keeps a trailing action outside selection behavior", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const onEdit = vi.fn();
    render(
      <ChoiceList
        legend="作品"
        name="game-title"
        options={[
          {
            label: "桃太郎電鉄2",
            trailingAction: (
              <Button size="sm" variant="quiet" onClick={onEdit}>
                編集
              </Button>
            ),
            value: "game-1",
          },
        ]}
        value="game-1"
        onValueChange={onValueChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "編集" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("disables the group while pending and announces the busy state", () => {
    render(
      <ChoiceList
        pending
        legend="開催"
        name="event"
        options={[{ label: "第12回", value: "event-12" }]}
        value="event-12"
        onValueChange={vi.fn()}
      />,
    );

    const group = screen.getByRole("group", { name: "開催" });
    expect(group).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("radio", { name: /第12回/u })).toBeDisabled();
  });
});

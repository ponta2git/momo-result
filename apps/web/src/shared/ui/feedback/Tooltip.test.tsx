import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Tooltip, TooltipProvider } from "@/shared/ui/feedback/Tooltip";

describe("Tooltip", () => {
  it("remains independently renderable and exposes accessible descriptive content", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content={<span>保存前に入力内容を確認します</span>}>
        <button type="button">保存について</button>
      </Tooltip>,
    );

    const trigger = screen.getByRole("button", { name: "保存について" });
    await user.tab();

    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAccessibleName("保存について");
    expect(await screen.findByText("保存前に入力内容を確認します")).toBeVisible();
  });

  it("shares the initial delay and opens adjacent tooltips instantly within the group", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <Tooltip content="最初の説明">
          <button type="button">最初</button>
        </Tooltip>
        <Tooltip content="次の説明">
          <button type="button">次</button>
        </Tooltip>
      </TooltipProvider>,
    );

    const firstTrigger = screen.getByRole("button", { name: "最初" });
    const nextTrigger = screen.getByRole("button", { name: "次" });

    await user.hover(firstTrigger);
    expect(screen.queryByText("最初の説明")).not.toBeInTheDocument();
    expect(await screen.findByText("最初の説明")).toBeVisible();

    await user.unhover(firstTrigger);
    await user.hover(nextTrigger);
    expect(screen.getByText("次の説明")).toBeVisible();
  });
});

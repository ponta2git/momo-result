import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Tooltip, TooltipProvider } from "@/shared/ui/feedback/Tooltip";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Tooltip", () => {
  it("remains independently renderable and exposes accessible descriptive content", () => {
    vi.useFakeTimers();
    render(
      <Tooltip content={<span>保存前に入力内容を確認します</span>}>
        <button type="button">保存について</button>
      </Tooltip>,
    );

    const trigger = screen.getByRole("button", { name: "保存について" });
    act(() => {
      trigger.focus();
      vi.runOnlyPendingTimers();
    });

    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAccessibleName("保存について");
    expect(screen.getByText("保存前に入力内容を確認します").closest("[data-open]")).not.toBeNull();
  });

  it("shares the initial delay and opens adjacent tooltips instantly within the group", () => {
    vi.useFakeTimers();
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

    fireEvent.pointerMove(firstTrigger, { pointerType: "mouse" });
    fireEvent.mouseEnter(firstTrigger);
    fireEvent.mouseMove(firstTrigger);
    expect(screen.queryByText("最初の説明")).not.toBeInTheDocument();
    act(() => vi.runOnlyPendingTimers());
    expect(screen.getByText("最初の説明").closest("[data-open]")).not.toBeNull();

    fireEvent.mouseLeave(firstTrigger);
    fireEvent.pointerMove(nextTrigger, { pointerType: "mouse" });
    fireEvent.mouseEnter(nextTrigger);
    fireEvent.mouseMove(nextTrigger);
    expect(screen.getByText("次の説明").closest("[data-open]")).not.toBeNull();
  });
});

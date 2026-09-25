import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Dialog } from "@/shared/ui/feedback/Dialog";
import { Tooltip, TooltipProvider } from "@/shared/ui/feedback/Tooltip";

describe("Tooltip", () => {
  it("remains independently renderable and exposes accessible descriptive content", () => {
    vi.useFakeTimers();
    render(
      <>
        <p id="existing-description">変更は確認後に保存されます</p>
        <Tooltip content={<span>保存前に入力内容を確認します</span>}>
          <button aria-describedby="existing-description" type="button">
            保存について
          </button>
        </Tooltip>
      </>,
    );

    const trigger = screen.getByRole("button", { name: "保存について" });
    act(() => {
      trigger.focus();
      vi.runOnlyPendingTimers();
    });

    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAccessibleName("保存について");
    expect(screen.getByRole("tooltip")).toHaveTextContent("保存前に入力内容を確認します");
    expect(trigger).toHaveAccessibleDescription(
      "変更は確認後に保存されます 保存前に入力内容を確認します",
    );
  });

  it("keeps a dialog's description inside its owning accessible layer", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <Dialog open title="保存内容の確認">
        <Tooltip content="確定する前に試合を確認できます">
          <button type="button">試合の確認について</button>
        </Tooltip>
      </Dialog>,
    );
    const trigger = screen.getByRole("button", { name: "試合の確認について" });
    act(() => {
      trigger.focus();
      vi.runOnlyPendingTimers();
    });
    const tooltip = screen.getByRole("tooltip");
    expect(screen.getByRole("dialog", { name: "保存内容の確認" })).toContainElement(tooltip);
    expect(trigger).toHaveAccessibleDescription("確定する前に試合を確認できます");

    rerender(<Dialog open={false} title="保存内容の確認" />);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
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

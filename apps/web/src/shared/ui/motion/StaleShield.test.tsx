import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { StaleShield } from "@/shared/ui/motion/StaleShield";

function focusRestorationView(active: boolean) {
  return (
    <div>
      <button type="button">外の操作</button>
      <StaleShield active={active} fallback={<div>読み込み中</div>} strategy="preserve-inert">
        <button type="button">表示中の操作</button>
      </StaleShield>
    </div>
  );
}

describe("StaleShield", () => {
  it("replaces content for initial loading", () => {
    render(
      <StaleShield active fallback={<div>読み込み中</div>}>
        <div>未表示の内容</div>
      </StaleShield>,
    );

    expect(screen.getByText("読み込み中")).toBeInTheDocument();
    expect(screen.queryByText("未表示の内容")).not.toBeInTheDocument();
  });

  it("blocks interaction when requested and rendered scopes differ", () => {
    render(
      <StaleShield
        active
        busyLabel="比較条件を更新中"
        fallback={<div>読み込み中</div>}
        strategy="preserve-inert"
      >
        <button type="button">表示中の結果</button>
      </StaleShield>,
    );

    const preservedContent = screen.getByText("表示中の結果").parentElement;
    expect(preservedContent).toHaveAttribute("inert");
    expect(screen.getByRole("status")).toHaveTextContent("比較条件を更新中");
    expect(preservedContent).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status").closest('[aria-busy="true"]')).toBeNull();
  });

  it("keeps safe operations interactive during a same-scope refresh", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <StaleShield
        active
        busyLabel="一覧を更新中"
        fallback={<div>読み込み中</div>}
        strategy="preserve-interactive"
      >
        <button type="button" onClick={onOpen}>
          表示中の試合を開く
        </button>
      </StaleShield>,
    );

    const button = screen.getByRole("button", { name: "表示中の試合を開く" });
    expect(button.closest("[inert]")).toBeNull();
    await user.tab();
    expect(button).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("一覧を更新中");
    expect(screen.getByRole("status").closest('[aria-busy="true"]')).toBeNull();
  });

  it("restores focus dropped by inert without stealing focus moved outside", () => {
    const rendered = render(focusRestorationView(false));
    const insideButton = screen.getByRole("button", { name: "表示中の操作" });
    const outsideButton = screen.getByRole("button", { name: "外の操作" });

    insideButton.focus();
    rendered.rerender(focusRestorationView(true));
    insideButton.blur();
    rendered.rerender(focusRestorationView(false));

    expect(insideButton).toHaveFocus();

    rendered.rerender(focusRestorationView(true));
    outsideButton.focus();
    rendered.rerender(focusRestorationView(false));

    expect(outsideButton).toHaveFocus();
  });
});

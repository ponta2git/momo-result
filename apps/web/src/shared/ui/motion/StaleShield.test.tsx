import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StaleShield } from "@/shared/ui/motion/StaleShield";

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

    expect(screen.getByText("表示中の結果").parentElement).toHaveAttribute("inert");
    expect(screen.getByRole("status")).toHaveTextContent("比較条件を更新中");
  });

  it("keeps safe operations interactive during a same-scope refresh", () => {
    render(
      <StaleShield
        active
        busyLabel="一覧を更新中"
        fallback={<div>読み込み中</div>}
        strategy="preserve-interactive"
      >
        <button type="button">表示中の試合を開く</button>
      </StaleShield>,
    );

    const button = screen.getByRole("button", { name: "表示中の試合を開く" });
    expect(button.parentElement).not.toHaveAttribute("inert");
    expect(screen.getByRole("status")).toHaveTextContent("一覧を更新中");
  });
});

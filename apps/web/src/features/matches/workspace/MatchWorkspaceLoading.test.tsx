import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MatchWorkspaceLoading } from "@/features/matches/workspace/MatchWorkspaceLoading";

describe("MatchWorkspaceLoading", () => {
  it("reserves the persistent header action slot while loading", () => {
    render(
      <MatchWorkspaceLoading
        description="読み取り結果を確認して、開催と4人分の結果を確定します。現在の状態: 状態不明"
        sample
      />,
    );

    const heading = screen.getByRole("heading", { name: "試合フォームを読み込み中" });
    const header = heading.closest("header");
    expect(header).toHaveTextContent(
      "読み取り結果を確認して、開催と4人分の結果を確定します。現在の状態: 状態不明",
    );
    expect(header).toHaveTextContent("サンプルの読み取り結果で表示中");
    expect(header?.children).toHaveLength(2);
    expect(header?.children.item(1)?.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

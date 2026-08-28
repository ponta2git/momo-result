import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MasterReturnNotice } from "@/features/masters/MasterReturnNotice";

describe("MasterReturnNotice", () => {
  it("promises input preservation only for an available handoff", () => {
    render(<MasterReturnNotice handoffStatus="available" onReturn={vi.fn()} />);

    expect(screen.getByText("現在の入力内容を保ったまま戻れます。")).toBeInTheDocument();
    expect(screen.queryByText(/復元できない可能性/u)).not.toBeInTheDocument();
  });

  it.each(["missing", "expired", "invalid"] as const)(
    "%s handoff warns that restoration is not guaranteed",
    (handoffStatus) => {
      render(<MasterReturnNotice handoffStatus={handoffStatus} onReturn={vi.fn()} />);

      const warningCopy = screen.getByText(/入力内容を復元できない可能性があります/u);
      expect(warningCopy).toBeInTheDocument();
      expect(screen.queryByText(/入力内容を保ったまま/u)).not.toBeInTheDocument();
    },
  );

  it("explains whether return is waiting for an edit or navigation", () => {
    const view = render(
      <MasterReturnNotice
        disabled
        disabledReason="設定の追加・保存・削除が完了すると戻れます。"
        handoffStatus="available"
        onReturn={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "元の入力画面へ戻る" })).toBeDisabled();
    expect(screen.getByText("設定の追加・保存・削除が完了すると戻れます。")).toBeInTheDocument();

    view.rerender(
      <MasterReturnNotice
        disabled
        disabledReason="元の入力画面へ移動しています。"
        handoffStatus="available"
        pending
        onReturn={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "移動中…" })).toBeDisabled();
    expect(screen.getByText("元の入力画面へ移動しています。")).toBeInTheDocument();
  });
});

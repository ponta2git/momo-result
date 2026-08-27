import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MatchesStatusFilter } from "@/features/matches/list/MatchesStatusFilter";

const counts = {
  incompleteCount: 8,
  needsReviewCount: 2,
  ocrRunningCount: 3,
  preConfirmCount: 5,
};

describe("MatchesStatusFilter", () => {
  it("offers all six exclusive statuses with only available counts", async () => {
    const user = userEvent.setup();
    const onSelectStatus = vi.fn();

    render(
      <MatchesStatusFilter
        counts={counts}
        currentStatus="needs_review"
        onSelectStatus={onSelectStatus}
      />,
    );

    const select = screen.getByLabelText("確定状況");
    expect(select).toHaveValue("needs_review");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "すべて",
      "未確定すべて（8件）",
      "処理中（3件）",
      "対応待ち（5件）",
      "要確認のみ（2件）",
      "確定済み",
    ]);

    await user.selectOptions(select, "ocr_running");
    expect(onSelectStatus).toHaveBeenCalledWith("ocr_running");
  });

  it("does not turn unavailable counts into zero and keeps the filter usable", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(
      <MatchesStatusFilter
        currentStatus="all"
        unavailable
        onRetry={onRetry}
        onSelectStatus={vi.fn()}
      />,
    );

    expect(screen.getByRole("option", { name: "未確定すべて" })).toBeInTheDocument();
    expect(screen.queryByText(/0件/u)).not.toBeInTheDocument();
    expect(
      screen.getByText("内訳の件数を取得できません。確定状況の絞り込みは利用できます。"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "件数を再取得" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("masks counts from the previous scope while the next summary loads", () => {
    render(
      <MatchesStatusFilter
        counts={counts}
        currentStatus="incomplete"
        masked
        onSelectStatus={vi.fn()}
      />,
    );

    expect(screen.getByRole("option", { name: "未確定すべて" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /8件/u })).not.toBeInTheDocument();
    expect(screen.getByText("内訳の件数を確認中です。")).toBeInTheDocument();
  });
});

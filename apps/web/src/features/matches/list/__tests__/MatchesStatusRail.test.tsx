import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MatchesStatusRail } from "@/features/matches/list/MatchesStatusRail";

const counts = {
  incompleteCount: 8,
  needsReviewCount: 2,
  ocrRunningCount: 3,
  preConfirmCount: 5,
};

describe("MatchesStatusRail", () => {
  it("shows unfinished subfilters and keeps the parent state selected", async () => {
    const user = userEvent.setup();
    const onSelectStatus = vi.fn();

    render(
      <MatchesStatusRail
        counts={counts}
        currentStatus="needs_review"
        onSelectStatus={onSelectStatus}
      />,
    );

    expect(screen.getByRole("region", { name: "確定状況" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "確定状況" })).not.toBeInTheDocument();
    const unfinishedButton = screen.getByRole("button", { name: /未確定8件/u });
    const selectedReviewButton = screen.getByRole("button", { name: /要確認のみ2件/u });
    expect(unfinishedButton).toHaveAttribute("aria-pressed", "true");
    expect(unfinishedButton).toBeDisabled();
    expect(selectedReviewButton).toHaveAttribute("aria-pressed", "true");
    expect(selectedReviewButton).toBeDisabled();

    await user.click(selectedReviewButton);
    expect(onSelectStatus).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /処理中3件/u }));
    expect(onSelectStatus).toHaveBeenCalledWith("ocr_running");
  });

  it("keeps subfilters in a stable layout for direct access", () => {
    render(<MatchesStatusRail counts={counts} currentStatus="all" onSelectStatus={vi.fn()} />);

    expect(screen.getByRole("button", { name: "すべて" })).toBeDisabled();
    expect(screen.getByRole("group", { name: "未確定の内訳" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /処理中3件/u })).toBeEnabled();
  });
});

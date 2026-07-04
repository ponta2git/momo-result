import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ReviewViewContent } from "@/features/seriesComparison/review/SeriesComparisonReviewPanel";
import {
  makeSeriesComparisonResponse,
  makeSeriesComparisonReviewResponse,
} from "@/test/msw/seriesComparisonHandlers";

describe("SeriesComparisonReviewPanel", () => {
  it("renders player-facing playbook copy without exposing backend keys", async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();

    render(
      <ReviewViewContent
        hasReviewError={false}
        onViewChange={onViewChange}
        response={makeSeriesComparisonResponse()}
        review={makeSeriesComparisonReviewResponse()}
        reviewLoading={false}
      />,
    );

    expect(screen.getByRole("heading", { name: "行動プレイブック" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ぽんた" })).toBeInTheDocument();
    expect(screen.getAllByText(/物件収益/u)[0]).toBeInTheDocument();
    expect(screen.getAllByText(/下位後の戻し方/u)[0]).toBeInTheDocument();
    expect(screen.getAllByText("再現する")[0]).toBeInTheDocument();
    expect(screen.getAllByText("見直す")[0]).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "詳しい根拠" })[0]!);
    expect(screen.getByText("データ上の理由")).toBeInTheDocument();
    expect(
      screen.getByText("差の大きさ +0.62 / ぶれ幅 +0.31〜+0.84 / ぶれにくさ 高"),
    ).toBeInTheDocument();

    const visibleText = document.body.textContent ?? "";
    expect(visibleText).not.toContain("member_ponta");
    expect(visibleText).not.toContain("revenue.top.winRate");
    expect(visibleText).not.toContain("playOrder");
  });

  it("moves from review cards to the existing evidence tab without replacing history", async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();

    render(
      <ReviewViewContent
        hasReviewError={false}
        onViewChange={onViewChange}
        response={makeSeriesComparisonResponse()}
        review={makeSeriesComparisonReviewResponse()}
        reviewLoading={false}
      />,
    );

    const firstPontaCard = screen.getByRole("heading", { name: "ぽんた" }).closest("section");
    expect(firstPontaCard).not.toBeNull();
    await user.click(
      within(firstPontaCard as HTMLElement).getByRole("button", {
        name: "詳細: 物件収益と勝ちへ",
      }),
    );

    expect(onViewChange).toHaveBeenCalledWith("drivers", { replace: false });
  });
});

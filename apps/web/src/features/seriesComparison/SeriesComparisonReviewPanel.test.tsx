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

    expect(screen.getByRole("region", { name: "次戦の行動仮説" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ぽんた" })).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(4);
    expect(screen.getAllByText(/物件収益/u)[0]).toBeInTheDocument();
    expect(screen.getAllByText("再現する")[0]).toBeInTheDocument();
    expect(screen.queryByText("見直す")).not.toBeInTheDocument();
    const commonTopicToggle = screen.getByRole("button", { name: "卓全体の共通論点" });
    const pontaHeading = screen.getByRole("heading", { name: "ぽんた" });
    expect(
      commonTopicToggle.compareDocumentPosition(pontaHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(commonTopicToggle).toHaveTextContent("収益先行後の勝ち切り");
    expect(commonTopicToggle).not.toHaveTextContent("重複候補");
    expect(commonTopicToggle).not.toHaveTextContent("まとめて");

    const pontaSection = pontaHeading.closest("section");
    expect(pontaSection).not.toBeNull();
    await user.click(
      within(pontaSection as HTMLElement).getByRole("button", { name: "ほかの仮説 1件" }),
    );
    expect(within(pontaSection as HTMLElement).getByText("検証する")).toBeInTheDocument();

    await user.click(
      within(pontaSection as HTMLElement).getAllByRole("button", {
        name: "根拠・注意・試合後の確認",
      })[0]!,
    );
    const detailsDialog = await screen.findByRole("dialog", {
      name: "行動仮説の根拠と確認",
    });
    expect(within(detailsDialog).getByText("データ上の理由")).toBeInTheDocument();
    expect(
      within(detailsDialog).getByText("差の大きさ +0.62 / ぶれ幅 +0.31〜+0.84 / ぶれにくさ 高"),
    ).toBeInTheDocument();

    const visibleText = document.body.textContent ?? "";
    expect(visibleText).not.toContain("member_ponta");
    expect(visibleText).not.toContain("revenue.top.winRate");
    expect(visibleText).not.toContain("playOrder");
  });

  it("opens classification help in a modal without expanding the playbook layout", async () => {
    const user = userEvent.setup();

    render(
      <ReviewViewContent
        hasReviewError={false}
        onViewChange={vi.fn()}
        response={makeSeriesComparisonResponse()}
        review={makeSeriesComparisonReviewResponse()}
        reviewLoading={false}
      />,
    );

    const guideButton = screen.getByRole("button", { name: "分類と信頼度の読み方" });
    expect(guideButton).toHaveAttribute("aria-haspopup", "dialog");
    await user.click(guideButton);

    const guideDialog = await screen.findByRole("dialog", {
      name: "分類と信頼度の読み方",
    });
    expect(within(guideDialog).getByRole("heading", { name: "分類" })).toBeInTheDocument();
    expect(within(guideDialog).getByRole("heading", { name: "信頼度" })).toBeInTheDocument();
    expect(within(guideDialog).getByText("件数少")).toBeInTheDocument();
    expect(
      within(guideDialog).getByText("該当試合がごく少ないため、結論にせず観察を優先します。"),
    ).toBeInTheDocument();
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

  it("explains why a player has no hypothesis and offers a concrete analysis route", async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    const review = makeSeriesComparisonReviewResponse();
    review.playbookByPlayer![1]!.cards = [];

    render(
      <ReviewViewContent
        hasReviewError={false}
        onViewChange={onViewChange}
        response={makeSeriesComparisonResponse()}
        review={review}
        reviewLoading={false}
      />,
    );

    const pontaSection = screen.getByRole("heading", { name: "ぽんた" }).closest("section");
    expect(pontaSection).not.toBeNull();
    expect(pontaSection).toHaveTextContent(
      "この条件では、次回行動として出せる強い差分はありません。",
    );
    await user.click(
      within(pontaSection as HTMLElement).getByRole("button", { name: "今の差を見る" }),
    );
    expect(onViewChange).toHaveBeenCalledWith("overview", { replace: false });
  });
});

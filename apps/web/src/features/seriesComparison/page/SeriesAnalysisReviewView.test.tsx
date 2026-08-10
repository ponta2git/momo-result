import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ReviewView } from "@/features/seriesComparison/page/SeriesAnalysisReviewView";
import { makeSeriesAnalysisReview } from "@/test/msw/seriesAnalysisFixtures";

describe("ReviewView", () => {
  it("keeps secondary hypotheses collapsed and moves shared explanations into dialogs", async () => {
    const user = userEvent.setup();
    const response = makeSeriesAnalysisReview();
    const firstEntry = response.playbookByPlayer[0];
    const primary = firstEntry?.primaryCard;
    if (!firstEntry || !primary) throw new Error("primary fixture is required");
    response.commonPlaybookTopics = [
      {
        category: "revenue",
        detail: "複数人に同じ論点が出たため、個人カードを絞っています。",
        heading: "収益先行後の詰め方",
        playerIds: ["member-1", "member-2", "member-3"],
        topicId: "common:revenue",
      },
    ];
    response.playbookByPlayer[0] = {
      ...firstEntry,
      secondaryCards: [
        {
          ...primary,
          actionHypothesis: "下位後は目的地を1回取って戻す。",
          cardId: "playbook:member_ponta:recovery",
          category: "recovery",
        },
      ],
    };

    const onViewChange = vi.fn();
    render(
      <ReviewView
        loading={false}
        response={response}
        showError={false}
        onViewChange={onViewChange}
      />,
    );

    expect(screen.getByRole("button", { name: "卓全体で出やすい論点" })).toHaveTextContent(
      "収益先行後の詰め方",
    );
    expect(screen.queryByText("下位後は目的地を1回取って戻す。")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "ぽんたのほかの仮説" }));
    expect(screen.getByText("下位後は目的地を1回取って戻す。")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "分類と信頼度の読み方" }));
    const helpDialog = await screen.findByRole("dialog");
    expect(within(helpDialog).getByText("再現する")).toBeInTheDocument();
    expect(within(helpDialog).getByText(/自分で思い出す/u)).toBeInTheDocument();
    await user.click(within(helpDialog).getByRole("button", { name: "ダイアログを閉じる" }));

    await user.click(screen.getAllByRole("button", { name: "根拠・注意・試合後の確認" })[0]!);
    const detailDialog = await screen.findByRole("dialog");
    expect(within(detailDialog).getByText("収益だけで安全と見ない。")).toBeInTheDocument();
    expect(within(detailDialog).getByText(/採用優先度/u)).toBeInTheDocument();
  });
});

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

    const usage = screen.getByLabelText("行動仮説の使い方");
    expect(within(usage).getByText("対象")).toBeInTheDocument();
    expect(within(usage).getByText("次の4戦")).toBeInTheDocument();
    expect(within(usage).getByText("使う場面")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "卓全体で出やすい論点" })).toHaveTextContent(
      "収益先行後の詰め方",
    );
    expect(screen.queryByText("下位後は目的地を1回取って戻す。")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "ぽんたのほかの仮説" }));
    expect(screen.getByText("下位後は目的地を1回取って戻す。")).toBeInTheDocument();

    expect(screen.queryByText(/信頼度高め/u)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "分類の読み方" }));
    const helpDialog = await screen.findByRole("dialog");
    expect(within(helpDialog).getByText("再現する")).toBeInTheDocument();
    expect(within(helpDialog).getByText(/「やること」を行動候補にします/u)).toBeInTheDocument();
    await user.click(within(helpDialog).getByRole("button", { name: "ダイアログを閉じる" }));

    await user.click(screen.getAllByRole("button", { name: "根拠・注意・試合後の確認" })[0]!);
    const detailDialog = await screen.findByRole("dialog");
    expect(within(detailDialog).getByText("収益だけで安全と見ない。")).toBeInTheDocument();
    expect(within(detailDialog).getByText(/対象 5戦／ぶれにくさ 高め/u)).toBeInTheDocument();
    expect(within(detailDialog).getByText(/開催単位bootstrap/u)).toHaveTextContent(
      "95%区間 0.31〜0.82・開催安定性 74%",
    );
  });

  it("warns only when a playbook or its evidence has low reliability", async () => {
    const user = userEvent.setup();
    const response = makeSeriesAnalysisReview();
    const card = response.playbookByPlayer[0]?.primaryCard;
    const evidence = card?.evidence[0];
    if (!card || !evidence) throw new Error("primary evidence fixture is required");
    card.evidenceStrength = "low";
    evidence.qualityStatus = "reference";

    render(
      <ReviewView loading={false} response={response} showError={false} onViewChange={vi.fn()} />,
    );

    expect(screen.getByText("信頼度低め")).toBeInTheDocument();
    expect(screen.queryByText(/信頼度高め|信頼度中/u)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "根拠・注意・試合後の確認" }));
    expect(await screen.findByText("参考値")).toBeInTheDocument();
  });
});

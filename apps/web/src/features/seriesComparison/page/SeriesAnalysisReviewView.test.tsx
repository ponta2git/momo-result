import { render as renderUI, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ReviewView } from "@/features/seriesComparison/page/SeriesAnalysisReviewView";
import {
  makeFourPlayerSeriesAnalysisReview,
  makeSeriesAnalysisReview,
} from "@/test/msw/seriesAnalysisFixtures";

function render(ui: ReactElement) {
  return renderUI(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("ReviewView", () => {
  it("identifies the players covered by a common hypothesis before the individual hypotheses", () => {
    const response = makeFourPlayerSeriesAnalysisReview();
    response.commonPlaybookTopics = [
      {
        category: "revenue",
        detail: "共通の根拠",
        heading: "収益先行後の詰め方",
        playerIds: response.playbookByPlayer.slice(0, 3).map((entry) => entry.player.memberId),
        topicId: "common:revenue",
      },
    ];
    render(
      <ReviewView loading={false} response={response} showError={false} onViewChange={vi.fn()} />,
    );
    const common = screen.getByRole("region", { name: "複数人共通の行動仮説" });
    expect(within(common).getByText("3人")).toBeInTheDocument();
    expect(within(common).getByText("いーゆー、ぽんた、あかねまみ")).toBeInTheDocument();
    expect(within(common).queryByText("おーたか")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "いーゆー" })).toBeInTheDocument();
  });

  it("shows the selected hypothesis evidence with its uncertainty and denominator", async () => {
    const user = userEvent.setup();
    const response = makeFourPlayerSeriesAnalysisReview();
    response.playbookByPlayer = response.playbookByPlayer.slice(0, 2);
    const firstEntry = response.playbookByPlayer[0];
    const primary = firstEntry?.primaryCard;
    if (!firstEntry || !primary) throw new Error("primary fixture is required");
    const onViewChange = vi.fn();
    render(
      <ReviewView
        loading={false}
        response={response}
        showError={false}
        onViewChange={onViewChange}
      />,
    );

    await user.click(screen.getAllByRole("button", { name: "根拠・注意・試合後の確認" })[0]!);
    const detailDialog = await screen.findByRole("dialog");
    expect(within(detailDialog).getByText(primary.dataReason)).toBeVisible();
    expect(within(detailDialog).getByText("収益だけで安全と見ない。")).toBeInTheDocument();
    expect(within(detailDialog).getByText("ぶれにくさ: 高め")).toBeInTheDocument();
    expect(within(detailDialog).getByText(/開催単位の再標本化/u)).toHaveTextContent(
      "95%区間: 0.31〜0.82。開催を変えても傾向が残った割合: 74%。",
    );
    expect(within(detailDialog).queryByText("対象5戦")).not.toBeInTheDocument();
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

  it("shows only an evidence-specific denominator", async () => {
    const user = userEvent.setup();
    const response = makeSeriesAnalysisReview();
    const card = response.playbookByPlayer[0]?.primaryCard;
    const evidence = card?.evidence[0];
    if (!card || !evidence) throw new Error("primary evidence fixture is required");
    evidence.denominator = 12;

    render(
      <ReviewView loading={false} response={response} showError={false} onViewChange={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "根拠・注意・試合後の確認" }));
    const detailDialog = await screen.findByRole("dialog");
    expect(within(detailDialog).getByText("本人基準12戦")).toBeInTheDocument();
    expect(within(detailDialog).queryByText("対象5戦")).not.toBeInTheDocument();
  });
});

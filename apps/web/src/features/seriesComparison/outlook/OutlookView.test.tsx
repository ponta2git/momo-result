import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { OutlookSessionOwner } from "@/features/seriesComparison/outlook/OutlookSessionOwner";
import { OutlookView } from "@/features/seriesComparison/outlook/OutlookView";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { makeSeriesAnalysisOutlookSummary } from "@/test/msw/seriesAnalysisOutlookFixtures";
import { createTestQueryClient } from "@/test/queryClient";

type RankCounts = SeriesAnalysisOutlookSummary["recent"]["players"][number]["rankCounts"];
type JointRanks = SeriesAnalysisOutlookSummary["recent"]["jointRanks"][number]["rankCounts"];

const focusName = "いーゆー";
const rivalName = "ぽんた";

function RoutedWorkspace({ response }: { response: SeriesAnalysisOutlookSummary }) {
  const location = useLocation();
  const navigate = useNavigate();
  if (location.pathname === "/matches")
    return (
      <button type="button" onClick={() => navigate(-1)}>
        見通しに戻る
      </button>
    );
  return (
    <OutlookView
      response={response}
      selection={{
        gameTitleId: response.artifact.gameTitleId,
        view: "outlook",
        focusMemberId: "member_eu",
        rivalMemberId: "member_ponta",
      }}
    />
  );
}

function renderOutlook(response: SeriesAnalysisOutlookSummary) {
  const queryClient = createTestQueryClient();
  const tree = (summary: SeriesAnalysisOutlookSummary) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[
          `/analytics/series?gameTitleId=${response.artifact.gameTitleId}&view=outlook`,
        ]}
      >
        <OutlookSessionOwner>
          <RoutedWorkspace response={summary} />
        </OutlookSessionOwner>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const result = render(tree(response));
  return {
    updateSummary: (summary: SeriesAnalysisOutlookSummary) => result.rerender(tree(summary)),
  };
}

function meanField(name = focusName) {
  return screen.getByRole("textbox", { name: `${name}のこれからの平均順位` });
}
function countField(rank: number, name = focusName) {
  return screen.getByRole("textbox", { name: `${name}の${rank}位の回数` });
}
async function fillCounts(
  user: ReturnType<typeof userEvent.setup>,
  values: readonly string[],
  name = focusName,
) {
  for (const [index, value] of values.entries()) {
    await user.clear(countField(index + 1, name));
    await user.type(countField(index + 1, name), value);
  }
}

/** A legal rank permutation corrects the recent games while preserving the older games. */
async function correctedSummary(base: SeriesAnalysisOutlookSummary) {
  const players = base.recent.players.map((player) => {
    const rankCounts: RankCounts = [
      player.rankCounts[3],
      player.rankCounts[0],
      player.rankCounts[1],
      player.rankCounts[2],
    ];
    const rankSum = rankCounts.reduce((sum, count, index) => sum + count * (index + 1), 0);
    return { ...player, rankCounts, rankSum, averageRank: rankSum / base.recent.matchCount };
  });
  return makeSeriesAnalysisOutlookSummary({
    ...base,
    artifact: { ...base.artifact, artifactId: "artifact-corrected", inputRevision: "13" },
    recent: {
      ...base.recent,
      players,
      jointRanks: base.recent.jointRanks.map((pair) => ({
        ...pair,
        rankCounts: Array.from({ length: 4 }, (_row, i) =>
          Array.from({ length: 4 }, (_column, j) => pair.rankCounts[(i + 3) % 4]![(j + 3) % 4]!),
        ) as JointRanks,
      })),
    },
    players: base.players.map((player) => {
      const previous = base.recent.players.find((recent) => recent.memberId === player.memberId)!;
      const next = players.find((recent) => recent.memberId === player.memberId)!;
      const rankSum = player.rankSum + next.rankSum - previous.rankSum;
      return { ...player, rankSum, averageRank: rankSum / base.scope.matchCount };
    }),
  });
}

async function threeGameSummary() {
  const base = await makeSeriesAnalysisOutlookSummary();
  const matches = [
    [1, 2, 3, 4],
    [1, 2, 4, 3],
    [2, 1, 3, 4],
  ];
  const players = base.recent.players.map((player, memberIndex) => {
    const rankCounts = [1, 2, 3, 4].map(
      (rank) => matches.filter((match) => match[memberIndex] === rank).length,
    ) as RankCounts;
    const rankSum = rankCounts.reduce((sum, count, index) => sum + count * (index + 1), 0);
    return { ...player, rankCounts, rankSum, averageRank: rankSum / 3 };
  });
  const period = {
    startMatchId: "synthetic-1",
    endMatchId: "synthetic-3",
    startSequence: 1,
    endSequence: 3,
    startedAt: "2026-01-01T00:00:00.000000Z",
    endedAt: "2026-01-01T00:00:00.000002Z",
  };
  const jointRanks = base.recent.jointRanks.map((pair) => {
    const first = players.findIndex((player) => player.memberId === pair.memberAId);
    const second = players.findIndex((player) => player.memberId === pair.memberBId);
    return {
      ...pair,
      rankCounts: [1, 2, 3, 4].map((a) =>
        [1, 2, 3, 4].map(
          (b) => matches.filter((match) => match[first] === a && match[second] === b).length,
        ),
      ) as JointRanks,
    };
  });
  return makeSeriesAnalysisOutlookSummary({
    ...base,
    period,
    scope: { ...base.scope, matchCount: 3 },
    source: { ...base.source, titleMatchCount: 3 },
    recent: { ...base.recent, period, matchCount: 3, players, jointRanks },
    players: players.map(({ rankCounts: _counts, ...player }) => player),
  });
}

describe("OutlookView input and update boundaries", () => {
  it("keeps fractional counts through a mean-mode round trip and an exact same-value entry", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    const conclusion = screen.getByRole("img").getAttribute("aria-label");
    await user.click(screen.getByRole("tab", { name: "順位の回数で調整" }));
    await fillCounts(user, ["5.54", "5.18", "4.81", "4.47"]);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", conclusion);
    await user.click(screen.getByRole("button", { name: "回数を反映" }));
    await user.click(screen.getByRole("tab", { name: "平均順位で調整" }));
    expect(meanField()).toHaveValue("2.4105");
    await user.clear(meanField());
    await user.type(meanField(), "2.41050{Enter}");
    await user.click(screen.getByRole("tab", { name: "順位の回数で調整" }));
    expect([1, 2, 3, 4].map((rank) => (countField(rank) as HTMLInputElement).value)).toEqual([
      "5.54",
      "5.18",
      "4.81",
      "4.47",
    ]);
    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    expect([1, 2, 3, 4].map((rank) => (countField(rank) as HTMLInputElement).value)).toEqual([
      "4.00",
      "2.00",
      "7.00",
      "7.00",
    ]);
    expect(screen.getByRole("button", { name: "元に戻す" })).toBeDisabled();
  });

  it("preserves a hidden dirty draft and allows rival edits and a route round trip before explicit discard", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    await user.clear(meanField());
    await user.type(meanField(), "2.70{Enter}");
    await user.click(screen.getByRole("tab", { name: "順位の回数で調整" }));
    await fillCounts(user, ["1", "15", "2", "2"]);
    expect(screen.getByRole("button", { name: "回数を反映" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "元に戻す" })).toBeDisabled();
    await user.click(
      within(screen.getByRole("tablist", { name: "調整する人" })).getByRole("tab", {
        name: rivalName,
      }),
    );
    await fillCounts(user, ["4", "6", "4", "6"], rivalName);
    await user.click(screen.getByRole("button", { name: "回数を反映" }));
    expect(
      screen.getByText(`${focusName}の回数は入力中・まだ反映されていません。`),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "元に戻す" })).toBeDisabled();
    await user.click(screen.getByRole("link", { name: "この作品の確定戦績を見る" }));
    await user.click(screen.getByRole("button", { name: "見通しに戻る" }));
    await user.click(screen.getByRole("button", { name: "入力へ戻る" }));
    expect(countField(1)).toHaveValue("1");
    expect(countField(2)).toHaveValue("15");
    expect(screen.getByText("2位は相手との合計が20回を超えます。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "回数を反映" })).toBeDisabled();
    await user.click(screen.getByRole("tab", { name: "平均順位で調整" }));
    expect(meanField()).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "入力を破棄" }));
    expect(meanField()).toHaveValue("2.7000");
    expect(screen.getByRole("button", { name: "元に戻す" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    await user.click(
      within(screen.getByRole("tablist", { name: "調整する人" })).getByRole("tab", {
        name: rivalName,
      }),
    );
    expect(meanField(rivalName)).toHaveValue("2.4500");
  });

  it("restores the exact hand-entered allocation when one held-key gesture returns to its starting mean", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    await user.click(screen.getByRole("tab", { name: "順位の回数で調整" }));
    await fillCounts(user, ["5", "5", "6.8", "3.2"]);
    await user.click(screen.getByRole("button", { name: "回数を反映" }));
    await user.click(screen.getByRole("tab", { name: "平均順位で調整" }));
    await user.click(meanField());
    await user.tab();
    expect(screen.getByRole("slider", { name: `${focusName}の平均順位を動かす` })).toHaveFocus();
    await user.keyboard("{ArrowLeft>}{ArrowRight>}{/ArrowRight}{/ArrowLeft}");
    await user.click(screen.getByRole("tab", { name: "順位の回数で調整" }));
    expect([1, 2, 3, 4].map((rank) => (countField(rank) as HTMLInputElement).value)).toEqual([
      "5.00",
      "5.00",
      "6.80",
      "3.20",
    ]);
    await user.click(screen.getByRole("tab", { name: "平均順位で調整" }));
    await user.click(meanField());
    await user.tab();
    await user.keyboard("{ArrowLeft>3/}");
    expect(meanField()).toHaveValue("2.3800");
    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    await user.click(screen.getByRole("tab", { name: "順位の回数で調整" }));
    expect([1, 2, 3, 4].map((rank) => (countField(rank) as HTMLInputElement).value)).toEqual([
      "5.00",
      "5.00",
      "6.80",
      "3.20",
    ]);
    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(countField(1)).toHaveValue("4.00");
    expect(screen.getByRole("button", { name: "元に戻す" })).toBeDisabled();
  });

  it("synchronizes a pending mean after Undo but preserves it across an artifact adoption", async () => {
    const user = userEvent.setup();
    const response = await makeSeriesAnalysisOutlookSummary();
    const view = renderOutlook(response);
    await user.clear(meanField());
    await user.type(meanField(), "2.70{Enter}");
    await user.clear(meanField());
    await user.type(meanField(), "2.60");
    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(meanField()).toHaveValue("2.8500");
    await user.clear(meanField());
    await user.type(meanField(), "2.70");
    view.updateSummary(await correctedSummary(response));
    expect(meanField()).toHaveValue("2.70");
    expect(
      screen.getByText(`${focusName}の平均は入力中・まだ反映されていません。`),
    ).toBeInTheDocument();
    expect(screen.getByText("直近の成績と総合成績を更新しました。")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(meanField()).toHaveValue("2.4500");
    await user.click(
      within(screen.getByRole("tablist", { name: "調整する人" })).getByRole("tab", {
        name: rivalName,
      }),
    );
    expect(meanField(rivalName)).toHaveValue("2.0500");
    expect(screen.getByRole("button", { name: "元に戻す" })).toBeDisabled();
  });

  it("preserves both chosen distributions and the dirty draft when an edited comparison adopts a new artifact", async () => {
    const user = userEvent.setup();
    const response = await makeSeriesAnalysisOutlookSummary();
    const view = renderOutlook(response);
    await user.clear(meanField());
    await user.type(meanField(), "2.70{Enter}");
    await user.click(screen.getByRole("tab", { name: "順位の回数で調整" }));
    await user.clear(countField(1));
    await user.type(countField(1), "19");
    view.updateSummary(await correctedSummary(response));
    expect(countField(1)).toHaveValue("19");
    expect(screen.getByText("試している成績を残して実績を更新しました。")).toBeInTheDocument();
    expect(screen.getByText("総合の平均順位 2.06位")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "入力を破棄" }));
    await user.click(screen.getByRole("tab", { name: "平均順位で調整" }));
    expect(meanField()).toHaveValue("2.7000");
    await user.click(
      within(screen.getByRole("tablist", { name: "調整する人" })).getByRole("tab", {
        name: rivalName,
      }),
    );
    expect(meanField(rivalName)).toHaveValue("2.4500");
    expect(screen.getByRole("button", { name: "元に戻す" })).toBeDisabled();
  });

  it("keeps a three-game native average until the proposed decimal counts are explicitly applied", async () => {
    const user = userEvent.setup();
    renderOutlook(await threeGameSummary());
    expect(meanField()).toHaveValue("1.3333");
    await user.click(screen.getByRole("tab", { name: "順位の回数で調整" }));
    expect([1, 2, 3, 4].map((rank) => (countField(rank) as HTMLInputElement).value)).toEqual([
      "13.33",
      "6.66",
      "0.01",
      "0.00",
    ]);
    expect(screen.getByRole("slider", { name: "1位と4位の合計を保って動かす" })).toBeDisabled();
    await user.click(screen.getByRole("tab", { name: "平均順位で調整" }));
    expect(meanField()).toHaveValue("1.3333");
    expect(meanField()).toBeEnabled();
    await user.click(meanField());
    await user.tab();
    await user.keyboard("{ArrowLeft}");
    expect(meanField()).toHaveValue("1.3333");
    expect(screen.getByRole("button", { name: "元に戻す" })).toBeDisabled();
    await user.click(screen.getByRole("tab", { name: "順位の回数で調整" }));
    await user.click(screen.getByRole("button", { name: "回数を反映" }));
    expect(screen.getByRole("slider", { name: "1位と4位の合計を保って動かす" })).toBeEnabled();
    await user.click(screen.getByRole("tab", { name: "平均順位で調整" }));
    expect(meanField()).toHaveValue("1.3340");
    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(meanField()).toHaveValue("1.3333");
  });

  it("rejects a recent-result reset that conflicts with the rival without changing either player or adding Undo", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    await user.clear(meanField());
    await user.type(meanField(), "2.50{Enter}");
    await user.click(
      within(screen.getByRole("tablist", { name: "調整する人" })).getByRole("tab", {
        name: rivalName,
      }),
    );
    await user.click(screen.getByRole("tab", { name: "順位の回数で調整" }));
    await fillCounts(user, ["0", "5", "15", "0"], rivalName);
    await user.click(screen.getByRole("button", { name: "回数を反映" }));
    await user.click(
      within(screen.getByRole("tablist", { name: "調整する人" })).getByRole("tab", {
        name: focusName,
      }),
    );
    await user.click(screen.getByRole("tab", { name: "平均順位で調整" }));
    await user.click(screen.getByRole("button", { name: `${focusName}を直近の成績に戻す` }));
    expect(meanField()).toHaveValue("2.5000");
    expect(meanField()).toHaveAccessibleDescription(/3位/u);
    await user.click(
      within(screen.getByRole("tablist", { name: "調整する人" })).getByRole("tab", {
        name: rivalName,
      }),
    );
    expect(meanField(rivalName)).toHaveValue("2.7500");
    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(meanField(rivalName)).toHaveValue("2.4500");
  });
});

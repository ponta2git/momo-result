import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { OutlookSessionOwner } from "@/features/seriesComparison/outlook/OutlookSessionOwner";
import { OutlookView } from "@/features/seriesComparison/outlook/OutlookView";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { setDevUser } from "@/test/auth";
import { setupMsw } from "@/test/msw/lifecycle";
import { makeSeriesAnalysisOutlookSummary } from "@/test/msw/seriesAnalysisOutlookFixtures";
import { createTestQueryClient } from "@/test/queryClient";
import { selectOption } from "@/test/selectOption";

setupMsw();
beforeEach(() => setDevUser());

type RankCounts = SeriesAnalysisOutlookSummary["recent"]["players"][number]["rankCounts"];
type JointRanks = SeriesAnalysisOutlookSummary["recent"]["jointRanks"][number]["rankCounts"];

const focusName = "いーゆー";
const rivalName = "ぽんた";

function RoutedWorkspace({
  response,
  memberIds,
}: {
  response: SeriesAnalysisOutlookSummary;
  memberIds: readonly [string, string];
}) {
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
        ...(response.scope.kind === "season"
          ? { seasonMasterId: response.scope.seasonMasterId }
          : {}),
        view: "outlook",
        focusMemberId: memberIds[0],
        rivalMemberId: memberIds[1],
      }}
    />
  );
}

function renderOutlook(
  response: SeriesAnalysisOutlookSummary,
  memberIds: readonly [string, string] = ["member_eu", "member_ponta"],
) {
  const queryClient = createTestQueryClient();
  const tree = (summary: SeriesAnalysisOutlookSummary, people = memberIds) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[
          `/analytics/series?gameTitleId=${response.artifact.gameTitleId}&view=outlook`,
        ]}
      >
        <OutlookSessionOwner>
          <RoutedWorkspace response={summary} memberIds={people} />
        </OutlookSessionOwner>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const result = render(tree(response));
  return {
    updateSummary: (summary: SeriesAnalysisOutlookSummary) => result.rerender(tree(summary)),
    updateMembers: (people: readonly [string, string]) => result.rerender(tree(response, people)),
  };
}

function meanField(name = focusName) {
  return screen.getByRole("textbox", { name: `${name}のこれからの平均順位` });
}
function countField(rank: number, name = focusName) {
  return screen.getByRole("textbox", { name: `${name}の${rank}位の回数` });
}
function displayedCounts(name = focusName) {
  return within(screen.getByLabelText(`${name}の順位内訳`))
    .getAllByRole("definition")
    .map((value) => value.textContent);
}
function gapValue(label: "試している成績" | "保持した成績", horizon = 20) {
  return (
    within(screen.getByLabelText(`${horizon}戦後の差`)).queryByText(label, { selector: "dt" })
      ?.nextElementSibling ?? null
  );
}
function chartAxisLabels() {
  return [...screen.getByRole("img").querySelectorAll("text")]
    .slice(0, 3)
    .map((label) => label.textContent);
}
function expectHeldPointInsideChart(horizon: number) {
  const guide = screen.getByLabelText(`${horizon}戦後の確認位置`).querySelector("line")!;
  const heldY = Number(
    screen
      .getByLabelText(`${horizon}戦後の保持した成績`)
      .querySelector("circle")!
      .getAttribute("cy"),
  );
  expect(heldY).toBeGreaterThanOrEqual(Number(guide.getAttribute("y1")));
  expect(heldY).toBeLessThanOrEqual(Number(guide.getAttribute("y2")));
}
async function editPerson(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(
    within(screen.getByRole("tablist", { name: "調整する人" })).getByRole("tab", { name }),
  );
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
  it("keeps each member's results and editor attached to their identity when focus follows rival in canonical order", async () => {
    const user = userEvent.setup();
    const response = await makeSeriesAnalysisOutlookSummary();
    renderOutlook(response, ["member_ponta", "member_eu"]);
    const people = within(screen.getByRole("tablist", { name: "調整する人" }));
    expect(people.getAllByRole("tab").map((tab) => tab.getAttribute("aria-label"))).toEqual([
      "いーゆー",
      "ぽんた",
    ]);
    expect(people.getByRole("tab", { name: "ぽんた" })).toHaveAttribute("aria-selected", "true");
    const results = within(screen.getByRole("table", { name: "現在とこの先の総合平均順位" }));
    expect(results.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "時点",
      "いーゆー",
      "ぽんた",
    ]);
    const current = results.getByRole("row", { name: /^現在/u });
    expect(
      within(current)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(
      ["member_eu", "member_ponta"].map(
        (id) =>
          `${response.players.find((player) => player.memberId === id)!.averageRank.toFixed(2)}位`,
      ),
    );
    const before = results.getByRole("row", { name: /^50戦後/u });
    const rivalBefore = within(before).getAllByRole("cell")[0]!.textContent;
    const focusBefore = within(before).getAllByRole("cell")[1]!.textContent;
    await user.clear(meanField("ぽんた"));
    await user.type(meanField("ぽんた"), "2.40{Enter}");
    expect(within(before).getAllByRole("cell")[0]).toHaveTextContent(rivalBefore!);
    expect(within(before).getAllByRole("cell")[1]).not.toHaveTextContent(focusBefore!);
  });

  it("keeps a precise mean and allocation through mode changes, a no-op gesture and the first whole-count move", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    await user.clear(meanField());
    await user.type(meanField(), "2.41{Enter}");
    const conclusion = screen.getByRole("img").getAttribute("aria-label");
    await user.click(screen.getByRole("tab", { name: "回数を変えたら" }));
    await selectOption(user, screen.getByRole("combobox", { name: "増やす順位" }), "0");
    const preciseCounts = ["5.54回", "5.18回", "4.82回", "4.46回"];
    expect(displayedCounts()).toEqual(preciseCounts);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", conclusion);
    expect(countField(1)).toHaveValue("6");
    await user.click(screen.getByRole("tab", { name: "平均を変えたら" }));
    await user.clear(meanField());
    await user.type(meanField(), "2.4100{Enter}");
    await user.click(screen.getByRole("tab", { name: "回数を変えたら" }));
    expect(displayedCounts()).toEqual(preciseCounts);
    await user.click(countField(1));
    await user.tab();
    await user.tab();
    expect(screen.getByRole("slider", { name: "1位と4位の配分" })).toHaveFocus();
    await user.keyboard("{ArrowLeft>}{ArrowRight>}{/ArrowRight}{/ArrowLeft}");
    expect(displayedCounts()).toEqual(preciseCounts);
    await user.click(screen.getByRole("button", { name: "4位から1位へ1回移す" }));
    expect(displayedCounts()).toEqual(["7回", "5回", "4回", "4回"]);
    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(displayedCounts()).toEqual(preciseCounts);
    await user.click(screen.getByRole("tab", { name: "平均を変えたら" }));
    expect(meanField()).toHaveValue("2.41");
    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(meanField()).toHaveValue("2.85");
    expect(screen.getByRole("button", { name: "元に戻す" })).toBeDisabled();
  });

  it("moves whole counts immediately between the named ranks and leaves valid results intact on invalid input", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    await user.click(screen.getByRole("tab", { name: "回数を変えたら" }));
    expect(screen.getByRole("button", { name: "4位から3位へ1回移す" })).toBeEnabled();
    await user.clear(countField(3));
    await user.type(countField(3), "8");
    expect(displayedCounts()).toEqual(["4回", "2回", "8回", "6回"]);
    expect(
      within(screen.getByRole("tablist", { name: "調整する人" })).getByRole("tab", {
        name: focusName,
      }),
    ).toHaveTextContent("2.80位");
    await user.keyboard("{Enter}");
    await user.tab();
    await user.click(countField(3));
    await user.clear(countField(3));
    await user.paste("20");
    expect(displayedCounts()).toEqual(["4回", "2回", "8回", "6回"]);
    expect(screen.getByRole("alert")).toHaveTextContent("整数を入力してください");
    await user.keyboard("{Escape}");
    expect(countField(3)).toHaveValue("8");
    expect(countField(3)).toBeValid();
    await user.clear(countField(3));
    await user.type(countField(3), "8");
    expect(countField(3)).toBeValid();
    await user.keyboard("{Enter}");
    await editPerson(user, rivalName);
    expect(displayedCounts(rivalName)).toEqual(["7回", "4回", "2回", "7回"]);
    await editPerson(user, focusName);
    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(displayedCounts()).toEqual(["4回", "2回", "7回", "7回"]);
    expect(screen.getByRole("button", { name: "元に戻す" })).toBeDisabled();
  });

  it("preserves a hidden pending mean during rival edits and a route round trip", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    await user.clear(meanField());
    await user.type(meanField(), "2.70{Enter}");
    await user.clear(meanField());
    await user.type(meanField(), "2.60");
    await editPerson(user, rivalName);
    expect(screen.getByText(`${focusName}の平均は入力中です。`)).toBeInTheDocument();
    await user.clear(meanField(rivalName));
    await user.type(meanField(rivalName), "2.40{Enter}");
    await user.click(screen.getByRole("tab", { name: "回数を変えたら" }));
    await user.click(countField(3, rivalName));
    await user.tab();
    expect(screen.getByText(`${focusName}の平均は入力中です。`)).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "平均を変えたら" }));
    await user.click(screen.getByRole("link", { name: "この作品の確定戦績を見る" }));
    await user.click(screen.getByRole("button", { name: "見通しに戻る" }));
    expect(meanField(rivalName)).toHaveValue("2.40");
    await user.click(screen.getByRole("button", { name: "入力へ戻る" }));
    expect(meanField()).toHaveValue("2.60");
    await user.click(meanField());
    await user.keyboard("{Escape}");
    expect(meanField()).toHaveValue("2.70");
    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    await editPerson(user, rivalName);
    expect(meanField(rivalName)).toHaveValue("2.45");
  });

  it("restores an unbalanced whole-count allocation when a held mean gesture returns to its start", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    await user.click(screen.getByRole("tab", { name: "回数を変えたら" }));
    await selectOption(user, screen.getByRole("combobox", { name: "増やす順位" }), "0");
    await user.click(screen.getByRole("button", { name: "4位から1位へ1回移す" }));
    await user.click(screen.getByRole("tab", { name: "平均を変えたら" }));
    expect(meanField()).toHaveValue("2.70");
    await user.click(meanField());
    await user.tab();
    expect(screen.getByRole("slider", { name: `${focusName}の平均順位を動かす` })).toHaveFocus();
    await user.keyboard("{ArrowLeft>}{ArrowRight>}{/ArrowRight}{/ArrowLeft}");
    await user.click(screen.getByRole("tab", { name: "回数を変えたら" }));
    expect(displayedCounts()).toEqual(["5回", "2回", "7回", "6回"]);
    await user.click(screen.getByRole("tab", { name: "平均を変えたら" }));
    await user.click(meanField());
    await user.tab();
    await user.keyboard("{ArrowLeft>3/}");
    expect(meanField()).toHaveValue("2.67");
    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    await user.click(screen.getByRole("tab", { name: "回数を変えたら" }));
    expect(displayedCounts()).toEqual(["5回", "2回", "7回", "6回"]);
    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(displayedCounts()).toEqual(["4回", "2回", "7回", "7回"]);
    expect(screen.getByRole("button", { name: "元に戻す" })).toBeDisabled();
  });

  it("synchronizes a pending mean after Undo but preserves it when unedited results follow a new artifact", async () => {
    const user = userEvent.setup();
    const response = await makeSeriesAnalysisOutlookSummary();
    const view = renderOutlook(response);
    await user.clear(meanField());
    await user.type(meanField(), "2.70{Enter}");
    await user.clear(meanField());
    await user.type(meanField(), "2.60");
    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(meanField()).toHaveValue("2.85");
    await user.clear(meanField());
    await user.type(meanField(), "2.70");
    view.updateSummary(await correctedSummary(response));
    expect(meanField()).toHaveValue("2.70");
    expect(screen.getByText("直近の成績と総合成績を更新しました。")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(meanField()).toHaveValue("2.45");
    await editPerson(user, rivalName);
    expect(meanField(rivalName)).toHaveValue("2.05");
    expect(screen.getByRole("button", { name: "元に戻す" })).toBeDisabled();
  });

  it("preserves both chosen distributions and a pending mean when an edited comparison adopts a new artifact", async () => {
    const user = userEvent.setup();
    const response = await makeSeriesAnalysisOutlookSummary();
    const view = renderOutlook(response);
    await user.clear(meanField());
    await user.type(meanField(), "2.70{Enter}");
    await user.click(screen.getByRole("button", { name: "今の成績を保持" }));
    await user.clear(meanField());
    await user.type(meanField(), "2.60");
    await user.click(screen.getByRole("tab", { name: "回数を変えたら" }));
    const before = displayedCounts();
    expect(gapValue("保持した成績")).toBeInTheDocument();
    view.updateSummary(await correctedSummary(response));
    expect(displayedCounts()).toEqual(before);
    expect(gapValue("保持した成績")).not.toBeInTheDocument();
    expect(screen.getByText(`${focusName}の平均は入力中です。`)).toBeInTheDocument();
    expect(
      screen.getByText(
        "試している成績を残して実績を更新しました。比較用に保持した成績を解除しました。",
      ),
    ).toBeInTheDocument();
    const results = screen.getByRole("table", { name: "現在とこの先の総合平均順位" });
    expect(within(results).getByRole("row", { name: /現在/u })).toHaveTextContent("2.06位");
    await user.click(screen.getByRole("button", { name: "入力へ戻る" }));
    expect(meanField()).toHaveValue("2.60");
    await user.click(meanField());
    await user.keyboard("{Escape}");
    expect(meanField()).toHaveValue("2.70");
    await editPerson(user, rivalName);
    expect(meanField(rivalName)).toHaveValue("2.45");
    expect(screen.getByRole("button", { name: "元に戻す" })).toBeDisabled();
  });

  it("preserves a three-game exact average on same-value input and undoes a new edit after Enter in one step", async () => {
    const user = userEvent.setup();
    renderOutlook(await threeGameSummary());
    expect(meanField()).toHaveValue("1.3333");
    expect(screen.getByText(/今の成績で条件を満たしています/u)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /平均.+位で試す$/u })).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "回数を変えたら" }));
    await selectOption(user, screen.getByRole("combobox", { name: "増やす順位" }), "0");
    const actual = ["13.33回", "6.67回", "0回", "0回"];
    expect(displayedCounts()).toEqual(actual);
    expect(countField(1)).toHaveValue("13");
    expect(screen.getByRole("button", { name: "4位から1位へ1回移す" })).toBeDisabled();
    await user.clear(countField(1));
    await user.type(countField(1), "13{Enter}");
    expect(displayedCounts()).toEqual(actual);
    expect(screen.getByRole("button", { name: "元に戻す" })).toBeDisabled();
    // Enter ended the previous gesture; this edit starts while the same field still has focus.
    await user.clear(countField(1));
    await user.type(countField(1), "12");
    expect(displayedCounts()).toEqual(["12回", "6回", "1回", "1回"]);
    expect(
      within(screen.getByRole("tablist", { name: "調整する人" })).getByRole("tab", {
        name: focusName,
      }),
    ).toHaveTextContent("1.55位");
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(displayedCounts()).toEqual(actual);
    await user.click(screen.getByRole("tab", { name: "平均を変えたら" }));
    expect(meanField()).toHaveValue("1.3333");
    expect(screen.getByRole("button", { name: "元に戻す" })).toBeDisabled();
    await user.click(meanField());
    await user.tab();
    await user.keyboard("{ArrowLeft}");
    expect(meanField()).toHaveValue("1.3333");
    expect(screen.getByRole("button", { name: "元に戻す" })).toBeDisabled();
  });

  it("rejects an incompatible recent-result reset without changing either person or adding Undo", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    await user.clear(meanField());
    await user.type(meanField(), "2.50{Enter}");
    await editPerson(user, rivalName);
    await user.click(screen.getByRole("tab", { name: "回数を変えたら" }));
    await selectOption(user, screen.getByRole("combobox", { name: "増やす順位" }), "2");
    await user.clear(countField(3, rivalName));
    await user.type(countField(3, rivalName), "9{Enter}");
    await selectOption(user, screen.getByRole("combobox", { name: "減らす順位" }), "0");
    await user.clear(countField(3, rivalName));
    await user.type(countField(3, rivalName), "15{Enter}");
    expect(displayedCounts(rivalName)).toEqual(["1回", "4回", "15回", "0回"]);
    await editPerson(user, focusName);
    await user.click(screen.getByRole("tab", { name: "平均を変えたら" }));
    await user.click(screen.getByRole("button", { name: `${focusName}を直近の成績に戻す` }));
    expect(meanField()).toHaveValue("2.50");
    expect(meanField()).toHaveAccessibleDescription(/3位/u);
    await editPerson(user, rivalName);
    expect(meanField(rivalName)).toHaveValue("2.70");
    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(meanField(rivalName)).toHaveValue("2.10");
  });

  it("does not recommend recent results that conflict with the rival or claim an impossible target is reachable", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    const horizon = screen.getByRole("textbox", { name: "何戦後" });
    await user.clear(horizon);
    await user.type(horizon, "100");
    await user.clear(meanField());
    await user.type(meanField(), "2.50{Enter}");
    await editPerson(user, rivalName);
    await user.clear(meanField(rivalName));
    await user.type(meanField(rivalName), "3.75{Enter}");
    // The rival now takes fourth place 15 times; the focus's recent seven fourths cannot coexist.
    const requirements = screen.getByRole("table", { name: "必要な成績と同期間の過去実績" });
    expect(within(requirements).getByRole("row", { name: /^50戦後/u })).toHaveTextContent(
      "平均は条件内・内訳の変更が必要",
    );
    const review = screen.getByRole("region", { name: "戦績を振り返る" });
    expect(review).not.toHaveTextContent(/直近の成績.*上回/u);
    expect(review).toHaveTextContent("順位の内訳が相手の指定と両立しません");
    // Each edit remains legal; the rival's all-first-place assumption makes 100 games unreachable.
    await editPerson(user, focusName);
    await user.clear(meanField());
    await user.type(meanField(), "3.25{Enter}");
    await editPerson(user, rivalName);
    await user.clear(meanField(rivalName));
    await user.type(meanField(rivalName), "1.00{Enter}");
    await editPerson(user, focusName);
    await user.clear(meanField());
    await user.type(meanField(), "2.00{Enter}");
    expect(within(requirements).getByRole("row", { name: /^100戦後/u })).toHaveTextContent(
      "相手がこの成績なら届きません",
    );
    expect(review).not.toHaveTextContent(/直近の成績.*上回/u);
  });

  it("applies the strict required mean to the focus alone and restores both original distributions in one Undo", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    // At 20 games, 2.65 ties (74 + 20 * 2.65 = 78 + 20 * 2.45); 2.64 must stay ahead.
    await editPerson(user, rivalName);
    await user.click(screen.getByRole("tab", { name: "回数を変えたら" }));
    const originalRival = displayedCounts(rivalName);
    await user.click(screen.getByRole("button", { name: `${focusName}を平均2.64位で試す` }));
    expect(meanField()).toHaveValue("2.64");
    expect(screen.getByText(`${focusName}に平均2.64位を適用中`)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: `${focusName}を平均2.64位で試す` }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "計算に使った実績と詳しい数値" }));
    const details = screen.getByRole("table", { name: "今後の総合平均順位" });
    expect(within(details).getByRole("row", { name: /^20戦/u })).toHaveTextContent(
      "0.0038 · いーゆーが上",
    );
    await user.click(screen.getByRole("tab", { name: "回数を変えたら" }));
    const applied = displayedCounts().map((count) => Number(count!.replace(/回$/u, "")));
    expect(applied.reduce((sum, count) => sum + count, 0)).toBeCloseTo(20);
    expect(applied.reduce((sum, count, index) => sum + count * (index + 1), 0) / 20).toBeCloseTo(
      2.64,
    );
    applied.forEach((count, index) => {
      expect(count + Number(originalRival[index]!.replace(/回$/u, ""))).toBeLessThanOrEqual(20);
    });
    await editPerson(user, rivalName);
    expect(displayedCounts(rivalName)).toEqual(originalRival);
    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(displayedCounts(rivalName)).toEqual(originalRival);
    await editPerson(user, focusName);
    expect(displayedCounts()).toEqual(["4回", "2回", "7回", "7回"]);
    expect(screen.getByRole("button", { name: "元に戻す" })).toBeDisabled();
  });

  it("replaces only the focus mean draft when applying a required mean from the rival editor", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    await user.clear(meanField());
    await user.type(meanField(), "2.60");
    await editPerson(user, rivalName);
    await user.clear(meanField(rivalName));
    await user.type(meanField(rivalName), "2.30");
    await user.click(screen.getByRole("button", { name: `${focusName}を平均2.64位で試す` }));
    expect(meanField()).toHaveValue("2.64");
    expect(screen.queryByText(`${focusName}の平均は入力中です。`)).not.toBeInTheDocument();
    expect(screen.getByText(`${rivalName}の平均は入力中です。`)).toBeInTheDocument();
    await editPerson(user, rivalName);
    expect(meanField(rivalName)).toHaveValue("2.30");
    await user.click(meanField(rivalName));
    await user.keyboard("{Escape}");
    expect(meanField(rivalName)).toHaveValue("2.45");
  });

  it("keeps an explicit pair through edits, Undo and a recent reset until it is updated or released", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    expect(gapValue("保持した成績")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "今の成績を保持" }));
    expect(screen.getByText(/^保持：/u)).toHaveTextContent(
      `保持：${focusName} 2.85位、${rivalName} 2.45位`,
    );
    const held = gapValue("保持した成績")!.textContent;
    await user.clear(meanField());
    await user.type(meanField(), "2.40{Enter}");
    await editPerson(user, rivalName);
    await user.clear(meanField(rivalName));
    await user.type(meanField(rivalName), "2.55{Enter}");
    expect(gapValue("保持した成績")).toHaveTextContent(held!);
    expect(gapValue("試している成績")).toHaveTextContent(/約0\.1346位.*いーゆーが上/u);
    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(meanField(rivalName)).toHaveValue("2.45");
    expect(gapValue("保持した成績")).toHaveTextContent(held!);
    await editPerson(user, focusName);
    await user.click(screen.getByRole("button", { name: `${focusName}を直近の成績に戻す` }));
    expect(meanField()).toHaveValue("2.85");
    expect(gapValue("保持した成績")).toHaveTextContent(held!);
    const update = screen.getByRole("button", { name: "保持を更新" });
    expect(update).toHaveAttribute("aria-disabled", "true");
    await user.click(update);
    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(meanField()).toHaveValue("2.40");
    expect(gapValue("保持した成績")).toHaveTextContent(held!);
    await user.click(screen.getByRole("button", { name: "保持を更新" }));
    expect(screen.getByText(/^保持：/u)).toHaveTextContent(
      `保持：${focusName} 2.40位、${rivalName} 2.45位`,
    );
    expect(gapValue("保持した成績")!.textContent).toBe(gapValue("試している成績")!.textContent);
    await user.click(screen.getByRole("button", { name: "保持を解除" }));
    expect(gapValue("保持した成績")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("20戦後の保持した成績")).not.toBeInTheDocument();
    expect(meanField()).toHaveValue("2.40");
    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(meanField()).toHaveValue("2.85");
    expect(screen.getByRole("button", { name: "元に戻す" })).toBeDisabled();
  });

  it("keeps pinning focusable but inactive for pending input, invalid means and an unfinished gesture", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    const pin = screen.getByRole("button", { name: "今の成績を保持" });
    await user.clear(meanField());
    await user.type(meanField(), "2.60");
    expect(pin).toHaveAttribute("aria-disabled", "true");
    await user.click(pin);
    expect(pin).toHaveFocus();
    expect(meanField()).toHaveValue("2.60");
    expect(gapValue("保持した成績")).not.toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(gapValue("保持した成績")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "元に戻す" })).toBeDisabled();
    await user.tab();
    expect(screen.getByRole("slider", { name: "グラフで確認する戦数" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("textbox", { name: "何戦後" })).toHaveValue("21");
    expect(meanField()).toHaveValue("2.60");
    expect(gapValue("保持した成績", 21)).not.toBeInTheDocument();
    await user.keyboard("{ArrowLeft}");
    await user.clear(meanField());
    await user.type(meanField(), "2.6001{Enter}");
    expect(meanField()).toBeInvalid();
    expect(pin).toHaveAttribute("aria-disabled", "true");
    await user.click(pin);
    expect(meanField()).toHaveValue("2.6001");
    expect(gapValue("保持した成績")).not.toBeInTheDocument();
    await user.click(meanField());
    await user.keyboard("{Escape}");
    await user.tab();
    const slider = screen.getByRole("slider", { name: `${focusName}の平均順位を動かす` });
    expect(slider).toHaveFocus();
    await user.keyboard("{ArrowLeft>}");
    expect(pin).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(pin);
    expect(gapValue("保持した成績")).not.toBeInTheDocument();
    await user.keyboard("{/ArrowLeft}");
    await user.click(pin);
    expect(screen.getByText(/^保持：/u)).toHaveTextContent(`${focusName} 2.84位`);
  });

  it.each(["person", "scope"] as const)(
    "releases the held pair when the %s changes",
    async (kind) => {
      const user = userEvent.setup();
      const response = await makeSeriesAnalysisOutlookSummary();
      const view = renderOutlook(response);
      await user.click(screen.getByRole("button", { name: "今の成績を保持" }));
      expect(gapValue("保持した成績")).toBeInTheDocument();
      if (kind === "person") view.updateMembers(["member_ponta", "member_eu"]);
      else
        view.updateSummary(
          await makeSeriesAnalysisOutlookSummary({
            ...response,
            scope: { ...response.scope, kind: "season", seasonMasterId: "another-season" },
          }),
        );
      expect(gapValue("保持した成績")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "今の成績を保持" })).not.toHaveAttribute(
        "aria-disabled",
        "true",
      );
    },
  );

  it("does not pin when a count draft or gesture loses focus to the inactive pin button", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    await user.click(screen.getByRole("tab", { name: "回数を変えたら" }));
    const pin = screen.getByRole("button", { name: "今の成績を保持" });
    await user.clear(countField(3));
    await user.type(countField(3), "20");
    expect(countField(3)).toBeInvalid();
    expect(pin).toHaveAttribute("aria-disabled", "true");
    await user.click(pin);
    expect(pin).toHaveFocus();
    expect(countField(3)).toHaveValue("20");
    expect(countField(3)).toBeInvalid();
    expect(gapValue("保持した成績")).not.toBeInTheDocument();
    await user.clear(countField(3));
    await user.type(countField(3), "8");
    expect(pin).toHaveAttribute("aria-disabled", "true");
    await user.click(pin);
    expect(pin).toHaveFocus();
    expect(pin).toHaveAttribute("aria-disabled", "true");
    expect(countField(3)).toHaveValue("8");
    expect(gapValue("保持した成績")).not.toBeInTheDocument();
    expect(displayedCounts()).toEqual(["4回", "2回", "8回", "6回"]);
    await user.click(countField(3));
    await user.keyboard("{Enter}");
    await user.click(pin);
    expect(screen.getByText(/^保持：/u)).toHaveTextContent(`${focusName} 2.80位`);
  });

  it("compares a pinned pair with a stable chart scale and retains numeric results outside the chart", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    await user.clear(meanField());
    await user.type(meanField(), "1.35{Enter}");
    await user.click(screen.getByRole("button", { name: "今の成績を保持" }));
    await user.clear(meanField());
    await user.type(meanField(), "3.65{Enter}");
    const horizon = screen.getByRole("textbox", { name: "何戦後" });
    const fixedAxisLabels = chartAxisLabels();
    expect(gapValue("保持した成績")).toHaveTextContent(/0\.50位.*いーゆーが上/u);
    expect(gapValue("試している成績")).toHaveTextContent(/約0\.3846位.*ぽんたが上/u);
    const initialPoint = screen.getByLabelText("20戦後の試している成績");
    const initialBeforePoint = screen
      .getByLabelText("20戦後の保持した成績")
      .querySelector("circle")!;
    const initialX = initialPoint.getAttribute("cx");
    const initialBeforeY = initialBeforePoint.getAttribute("cy");
    expect(initialBeforePoint).toHaveAttribute("cx", initialX);
    expect(Number(initialPoint.getAttribute("cy"))).toBeGreaterThan(Number(initialBeforeY));

    await user.clear(horizon);
    await user.type(horizon, "1");
    expect(chartAxisLabels()).toEqual(fixedAxisLabels);
    expectHeldPointInsideChart(1);

    await user.clear(horizon);
    await user.type(horizon, "50");
    expect(chartAxisLabels()).toEqual(fixedAxisLabels);
    expectHeldPointInsideChart(50);
    expect(gapValue("保持した成績", 50)).toHaveTextContent(/約0\.7195位.*いーゆーが上/u);
    expect(gapValue("試している成績", 50)).toHaveTextContent(/約0\.6829位.*ぽんたが上/u);
    expect(screen.queryByLabelText("20戦後の確認位置")).not.toBeInTheDocument();
    const point = screen.getByLabelText("50戦後の試している成績");
    const beforePoint = screen.getByLabelText("50戦後の保持した成績").querySelector("circle")!;
    expect(point.getAttribute("cx")).not.toBe(initialX);
    expect(beforePoint).toHaveAttribute("cx", point.getAttribute("cx"));
    expect(beforePoint.getAttribute("cy")).not.toBe(initialBeforeY);
    expect(Number(point.getAttribute("cy"))).toBeGreaterThan(
      Number(beforePoint.getAttribute("cy")),
    );
    expect(
      screen.getByRole("heading", { name: `50戦後に${focusName}が上回るための成績` }),
    ).toBeInTheDocument();

    await user.clear(horizon);
    await user.type(horizon, "100");
    expect(chartAxisLabels()).toEqual(fixedAxisLabels);
    expectHeldPointInsideChart(100);
    expect(screen.getByLabelText("100戦後の確認位置")).toBeInTheDocument();
    await user.clear(horizon);
    await user.type(horizon, "101");
    expect(chartAxisLabels()).toEqual(fixedAxisLabels);
    expect(screen.queryByLabelText(/戦後の確認位置$/u)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/戦後の保持した成績$/u)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/戦後の試している成績$/u)).not.toBeInTheDocument();
    expect(screen.getByText("101戦後はグラフの範囲外")).toBeInTheDocument();
    expect(gapValue("保持した成績", 101)).toHaveTextContent(/約0\.8654位.*いーゆーが上/u);
    expect(gapValue("試している成績", 101)).toHaveTextContent(/約0\.8812位.*ぽんたが上/u);

    await user.clear(horizon);
    await user.type(horizon, "50");
    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(screen.getByLabelText("50戦後の保持した成績")).toBeInTheDocument();
    expect(screen.getByLabelText("50戦後の試している成績")).toBeInTheDocument();
    expect(gapValue("保持した成績", 50)).toHaveTextContent(/約0\.7195位.*いーゆーが上/u);
    expect(gapValue("試している成績", 50)!.textContent).toBe(
      gapValue("保持した成績", 50)!.textContent,
    );
    expect(meanField()).toHaveValue("1.35");
  });

  it("updates the displayed horizon while typing and disables application until the horizon is valid", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    const horizon = screen.getByRole("textbox", { name: "何戦後" });
    expect(horizon).toHaveValue("20");
    const results = screen.getByRole("table", { name: "現在とこの先の総合平均順位" });
    const customRow = within(results).getByRole("row", { name: /指定した戦数/u });
    const averages = () =>
      within(customRow)
        .getAllByRole("cell")
        .map((cell) => cell.textContent);
    expect(averages()).toEqual(["2.52位", "2.44位"]);
    await user.clear(horizon);
    expect(horizon).toBeValid();
    expect(averages()).toEqual(["2.52位", "2.44位"]);
    expect(screen.getByRole("button", { name: `${focusName}を平均2.64位で試す` })).toBeDisabled();
    await user.type(horizon, "50");
    expect(horizon).toHaveFocus();
    expect(horizon).toHaveValue("50");
    expect(averages()).toEqual(["2.64位", "2.45位"]);
    expect(screen.getByRole("button", { name: `${focusName}を平均2.52位で試す` })).toBeEnabled();
    await user.clear(horizon);
    await user.paste("1001");
    expect(horizon).toHaveFocus();
    expect(averages()).toEqual(["2.64位", "2.45位"]);
    expect(screen.getByText(/結果は50戦後のまま/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `${focusName}を平均2.52位で試す` })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(horizon).toHaveValue("50");
    expect(screen.getByRole("button", { name: `${focusName}を平均2.52位で試す` })).toBeEnabled();
    expect(meanField()).toHaveValue("2.85");
    expect(screen.getByRole("button", { name: "元に戻す" })).toBeDisabled();
  });
});

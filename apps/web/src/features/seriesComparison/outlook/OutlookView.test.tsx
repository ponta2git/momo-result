import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

function meanField(name = focusName, container?: HTMLElement) {
  return (container ? within(container) : screen).getByRole("textbox", {
    name: `${name}のこれからの平均順位`,
  });
}
function countField(rank: number, name = focusName) {
  return screen.getByRole("textbox", { name: `${name}の${rank}位の回数` });
}
function displayedCounts(name = focusName) {
  return within(screen.getByLabelText(`${name}の順位内訳`))
    .getAllByRole("definition")
    .map((value) => value.textContent);
}
function chartAxisLabels() {
  return [...screen.getByRole("img").querySelectorAll("text")]
    .slice(0, 3)
    .map((label) => label.textContent);
}
function resultCells(name = focusName) {
  const table = within(screen.getByRole("table", { name: "現在と指定戦数後の総合平均順位" }));
  return within(table.getByRole("row", { name: new RegExp(`^${name}`, "u") }))
    .getAllByRole("cell")
    .map((cell) => cell.textContent);
}
function undo() {
  return screen.getByRole("button", { name: "1つ戻す" });
}
async function setMean(
  user: ReturnType<typeof userEvent.setup>,
  value: string,
  name = focusName,
  container?: HTMLElement,
) {
  const input = meanField(name, container);
  await user.clear(input);
  await user.type(input, `${value}{Enter}`);
}
async function openCounts(user: ReturnType<typeof userEvent.setup>, name = focusName) {
  await user.click(screen.getByRole("button", { name: `${name}を順位の回数で設定` }));
  return screen.getByRole("dialog", { name: `${name}の順位の回数を変える` });
}
async function openComparison(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^(?:別の成績|残した条件)と比べる$/u }));
  return screen.getByRole("dialog", { name: "2つの成績を比べる" });
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
  it("keeps both named editors and chart rows in member order when focus follows rival", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary(), ["member_ponta", "member_eu"]);
    expect(meanField(focusName)).toHaveValue("2.85");
    expect(meanField(rivalName)).toHaveValue("2.45");
    const table = within(screen.getByRole("table", { name: "現在と指定戦数後の総合平均順位" }));
    expect(table.getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual([
      "いーゆー（実線）",
      "ぽんた（破線）",
    ]);
    const otherBefore = resultCells(focusName);
    const before = screen.getByLabelText("いーゆーの総合平均順位（実線）").getAttribute("d");
    const axes = chartAxisLabels();
    await setMean(user, "2.40", rivalName);
    expect(resultCells(focusName)).toEqual(otherBefore);
    expect(resultCells(rivalName)).toEqual(["2.44位", "2.42位"]);
    expect(screen.getByLabelText("いーゆーの総合平均順位（実線）")).toHaveAttribute("d", before);
    expect(chartAxisLabels()).toEqual(axes);
  });

  it("commits each mean only with Enter or its adjacent button and retains invalid input on blur", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    await user.clear(meanField());
    await user.type(meanField(), "2.60");
    await setMean(user, "2.55", rivalName);
    expect(meanField()).toHaveValue("2.60");
    expect(resultCells(focusName)).toEqual(["2.31位", "2.52位"]);
    expect(resultCells(rivalName)).toEqual(["2.44位", "2.48位"]);
    expect(screen.getByText("入力中・見通しは前の値")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `${focusName}の平均順位を反映` }));
    expect(resultCells(focusName)).toEqual(["2.31位", "2.42位"]);
    await setMean(user, "2.6001");
    await user.click(meanField(rivalName));
    expect(meanField()).toHaveValue("2.6001");
    expect(meanField()).toHaveAccessibleDescription(/0\.01刻み/u);
    expect(resultCells(focusName)).toEqual(["2.31位", "2.42位"]);
    await user.click(meanField());
    await user.keyboard("{Escape}");
    expect(meanField()).toHaveValue("2.60");
    await user.click(undo());
    expect(meanField()).toHaveValue("2.85");
    expect(meanField(rivalName)).toHaveValue("2.55");
  });

  it("preserves an exact allocation when a count dialog opens or a gesture makes no change", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    await setMean(user, "2.41");
    const main = meanField();
    await openCounts(user);
    await selectOption(user, screen.getByRole("combobox", { name: "増やす順位" }), "0");
    expect(displayedCounts()).toEqual(["5.54回", "5.18回", "4.82回", "4.46回"]);
    expect(countField(1)).toHaveValue("6");
    await user.click(countField(1));
    await user.tab();
    await user.tab();
    expect(screen.getByRole("slider", { name: "1位と4位の配分" })).toHaveFocus();
    await user.keyboard("{ArrowLeft>}{ArrowRight}{/ArrowLeft}");
    expect(displayedCounts()).toEqual(["5.54回", "5.18回", "4.82回", "4.46回"]);
    await user.click(screen.getByRole("button", { name: "4位から1位へ1回移す" }));
    expect(displayedCounts()).toEqual(["7回", "5回", "4回", "4回"]);
    expect(main).toHaveValue("2.41");
    await user.click(screen.getByRole("button", { name: "この回数を使う" }));
    expect(meanField()).toHaveValue("2.25");
    await user.click(undo());
    expect(meanField()).toHaveValue("2.41");
    await setMean(user, "2.4100");
    await openCounts(user);
    expect(displayedCounts()).toEqual(["5.54回", "5.18回", "4.82回", "4.46回"]);
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    await user.click(undo());
    expect(meanField()).toHaveValue("2.85");
    expect(undo()).toBeDisabled();
  });

  it("previews count input locally and prevents an invalid draft from being applied on blur", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    const main = meanField();
    await openCounts(user);
    await user.clear(countField(3));
    await user.type(countField(3), "8");
    expect(displayedCounts()).toEqual(["4回", "2回", "8回", "6回"]);
    expect(screen.getByLabelText("この回数を続けた結果")).toHaveTextContent(
      "いーゆーの平均：2.80位",
    );
    expect(main).toHaveValue("2.85");
    await user.clear(countField(3));
    await user.type(countField(3), "20");
    await user.click(screen.getByRole("button", { name: "この回数を使う" }));
    expect(countField(3)).toHaveValue("20");
    expect(screen.getByRole("alert")).toHaveTextContent("整数を入力してください");
    expect(screen.getByRole("button", { name: "この回数を使う" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await user.click(countField(3));
    await user.keyboard("{Enter}");
    expect(countField(3)).toHaveValue("20");
    expect(countField(3)).toHaveAccessibleDescription(/整数を入力してください/u);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(meanField()).toHaveValue("2.85");
    await openCounts(user);
    expect(countField(3)).toHaveValue("7");
    await user.clear(countField(3));
    await user.type(countField(3), "8{Enter}");
    await user.click(screen.getByRole("button", { name: "この回数を使う" }));
    expect(meanField()).toHaveValue("2.80");
    await user.click(undo());
    expect(meanField()).toHaveValue("2.85");
    expect(undo()).toBeDisabled();
  });

  it("clears an invalid count draft when the local Undo restores its original allocation", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    await openCounts(user);
    await user.clear(countField(3));
    await user.type(countField(3), "8{Enter}");
    await user.clear(countField(3));
    await user.type(countField(3), "20");
    await user.click(screen.getByRole("button", { name: "回数の変更を戻す" }));
    expect(countField(3)).toHaveValue("8");
    expect(countField(3)).not.toHaveAttribute("aria-invalid", "true");
    expect(displayedCounts()).toEqual(["4回", "2回", "8回", "6回"]);
    await user.click(screen.getByRole("button", { name: "回数の変更を戻す" }));
    expect(countField(3)).toHaveValue("7");
    expect(displayedCounts()).toEqual(["4回", "2回", "7回", "7回"]);
    await user.click(screen.getByRole("button", { name: "この回数を使う" }));
    expect(meanField()).toHaveValue("2.85");
    expect(undo()).toBeDisabled();
  });

  it.each(["キャンセル", "ダイアログを閉じる", "Escape"])(
    "discards count changes with %s and returns focus to the named trigger",
    async (closing) => {
      const user = userEvent.setup();
      renderOutlook(await makeSeriesAnalysisOutlookSummary());
      const trigger = screen.getByRole("button", { name: `${focusName}を順位の回数で設定` });
      await user.click(trigger);
      await user.click(screen.getByRole("button", { name: "4位から3位へ1回移す" }));
      expect(displayedCounts()).toEqual(["4回", "2回", "8回", "6回"]);
      if (closing === "Escape") await user.keyboard("{Escape}");
      else await user.click(screen.getByRole("button", { name: closing }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(trigger).toHaveFocus();
      expect(meanField()).toHaveValue("2.85");
      expect(undo()).toBeDisabled();
      await openCounts(user);
      expect(displayedCounts()).toEqual(["4回", "2回", "7回", "7回"]);
    },
  );

  it("rejects a count proposal after the source artifact changes", async () => {
    const user = userEvent.setup();
    const initial = await makeSeriesAnalysisOutlookSummary();
    const view = renderOutlook(initial);
    await openCounts(user);
    await user.click(screen.getByRole("button", { name: "4位から3位へ1回移す" }));
    view.updateSummary(await correctedSummary(initial));
    expect(screen.getByText(/現在の条件から設定し直してください/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "この回数を使う" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(meanField()).toHaveValue("2.45");
    expect(meanField(rivalName)).toHaveValue("2.05");
    expect(undo()).toBeDisabled();
  });

  it("preserves two independent entries and a pending mean through task and route changes", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    await setMean(user, "2.70");
    await user.clear(meanField());
    await user.type(meanField(), "2.60");
    await setMean(user, "2.40", rivalName);
    await user.click(screen.getByRole("tab", { name: "戦数から考える" }));
    await user.click(screen.getByRole("link", { name: "この作品の確定戦績を見る" }));
    await user.click(screen.getByRole("button", { name: "見通しに戻る" }));
    await user.click(screen.getByRole("tab", { name: "成績から試す" }));
    expect(meanField()).toHaveValue("2.60");
    expect(meanField(rivalName)).toHaveValue("2.40");
    expect(resultCells(focusName)).toEqual(["2.31位", "2.46位"]);
    await user.click(meanField());
    await user.keyboard("{Escape}");
    expect(meanField()).toHaveValue("2.70");
    await user.click(undo());
    expect(meanField()).toHaveValue("2.70");
    expect(meanField(rivalName)).toHaveValue("2.45");
  });

  it("restores a custom count allocation after a mean slider gesture with one Undo", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    await openCounts(user);
    await selectOption(user, screen.getByRole("combobox", { name: "増やす順位" }), "0");
    await user.click(screen.getByRole("button", { name: "4位から1位へ1回移す" }));
    expect(displayedCounts()).toEqual(["5回", "2回", "7回", "6回"]);
    await user.click(screen.getByRole("button", { name: "この回数を使う" }));
    await user.click(meanField());
    await user.tab();
    const slider = screen.getByRole("slider", { name: `${focusName}の平均順位を動かす` });
    expect(slider).toHaveFocus();
    await user.keyboard("{ArrowLeft>}{ArrowRight}{/ArrowLeft}");
    expect(meanField()).toHaveValue("2.70");
    await user.keyboard("{ArrowLeft>3}{/ArrowLeft}");
    expect(meanField()).toHaveValue("2.67");
    await user.click(undo());
    expect(meanField()).toHaveValue("2.70");
    await openCounts(user);
    expect(displayedCounts()).toEqual(["5回", "2回", "7回", "6回"]);
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    await user.click(undo());
    expect(meanField()).toHaveValue("2.85");
    expect(undo()).toBeDisabled();
  });

  it("refreshes untouched results while retaining a pending mean until explicitly cancelled", async () => {
    const user = userEvent.setup();
    const initial = await makeSeriesAnalysisOutlookSummary();
    const view = renderOutlook(initial);
    await user.clear(meanField());
    await user.type(meanField(), "2.60");
    view.updateSummary(await correctedSummary(initial));
    expect(meanField()).toHaveValue("2.60");
    expect(meanField(rivalName)).toHaveValue("2.05");
    expect(undo()).toBeDisabled();
    await user.click(meanField());
    await user.keyboard("{Escape}");
    expect(meanField()).toHaveValue("2.45");
    expect(undo()).toBeDisabled();
  });

  it("preserves edited distributions on artifact refresh but clears their history and comparison baseline", async () => {
    const user = userEvent.setup();
    const initial = await makeSeriesAnalysisOutlookSummary();
    const view = renderOutlook(initial);
    await setMean(user, "2.70");
    await openComparison(user);
    await user.click(screen.getByRole("button", { name: "この条件を使う" }));
    await user.clear(meanField());
    await user.type(meanField(), "2.60");
    view.updateSummary(await correctedSummary(initial));
    expect(meanField()).toHaveValue("2.60");
    expect(meanField(rivalName)).toHaveValue("2.45");
    expect(resultCells(focusName)[0]).toBe("2.06位");
    await user.click(meanField());
    await user.keyboard("{Escape}");
    expect(meanField()).toHaveValue("2.70");
    expect(undo()).toBeDisabled();
    expect(screen.getByRole("button", { name: "別の成績と比べる" })).toBeInTheDocument();
  });

  it("keeps short-window rational precision through no-op edits and count-dialog Undo", async () => {
    const user = userEvent.setup();
    renderOutlook(await threeGameSummary());
    expect(meanField()).toHaveValue("1.3333");
    await setMean(user, "1.3333");
    expect(undo()).toBeDisabled();
    await openCounts(user);
    await selectOption(user, screen.getByRole("combobox", { name: "増やす順位" }), "0");
    expect(displayedCounts()).toEqual(["13.33回", "6.67回", "0回", "0回"]);
    await user.clear(countField(1));
    await user.type(countField(1), "13{Enter}");
    expect(displayedCounts()).toEqual(["13.33回", "6.67回", "0回", "0回"]);
    await user.clear(countField(1));
    await user.type(countField(1), "12{Enter}");
    expect(displayedCounts()).toEqual(["12回", "6回", "1回", "1回"]);
    await user.click(screen.getByRole("button", { name: "この回数を使う" }));
    expect(meanField()).toHaveValue("1.55");
    await user.click(undo());
    expect(meanField()).toHaveValue("1.3333");
    expect(undo()).toBeDisabled();
    await user.click(meanField());
    await user.tab();
    await user.keyboard("{ArrowLeft}");
    expect(meanField()).toHaveValue("1.3333");
    expect(undo()).toBeDisabled();
  });

  it("rejects an incompatible recent reset without changing either player or adding history", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    await setMean(user, "2.50");
    await openCounts(user, rivalName);
    await user.clear(countField(3, rivalName));
    await user.type(countField(3, rivalName), "9{Enter}");
    await selectOption(user, screen.getByRole("combobox", { name: "減らす順位" }), "0");
    await user.clear(countField(3, rivalName));
    await user.type(countField(3, rivalName), "15{Enter}");
    expect(displayedCounts(rivalName)).toEqual(["1回", "4回", "15回", "0回"]);
    await user.click(screen.getByRole("button", { name: "この回数を使う" }));
    await user.click(screen.getByRole("button", { name: `${focusName}を直近の成績に戻す` }));
    expect(meanField()).toHaveValue("2.50");
    expect(meanField()).toHaveAccessibleDescription(/3位/u);
    expect(meanField(rivalName)).toHaveValue("2.70");
    await user.click(undo());
    expect(meanField()).toHaveValue("2.50");
    expect(meanField(rivalName)).toHaveValue("2.45");
  });

  it("keeps the goal horizon independent until applying its required mean as one undoable change", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    const horizon = screen.getByRole("textbox", { name: "何戦後を見る" });
    await user.clear(horizon);
    await user.type(horizon, "50{Enter}");
    await user.click(screen.getByRole("tab", { name: "戦数から考える" }));
    const goal = screen.getByRole("textbox", { name: "目標の戦数" });
    expect(goal).toHaveValue("100");
    await user.clear(goal);
    await user.type(goal, "500{Enter}");
    await user.click(screen.getByRole("tab", { name: "成績から試す" }));
    expect(screen.getByRole("textbox", { name: "何戦後を見る" })).toHaveValue("50");
    await user.click(screen.getByRole("tab", { name: "戦数から考える" }));
    expect(screen.getByRole("textbox", { name: "目標の戦数" })).toHaveValue("500");
    await user.click(screen.getByRole("button", { name: "この成績で推移を見る" }));
    expect(screen.getByRole("tab", { name: "成績から試す" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("textbox", { name: "何戦後を見る" })).toHaveValue("500");
    expect(screen.getByRole("combobox", { name: "表示範囲" })).toHaveTextContent("500戦");
    expect(meanField()).toHaveValue("2.45");
    expect(meanField(rivalName)).toHaveValue("2.45");
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "この成績が続くと" })).toHaveFocus(),
    );
    await user.click(undo());
    expect(meanField()).toHaveValue("2.85");
    expect(undo()).toBeDisabled();
  });

  it("uses committed rival performance for a goal and preserves the rival's pending draft", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    await user.clear(meanField());
    await user.type(meanField(), "2.60");
    await user.clear(meanField(rivalName));
    await user.type(meanField(rivalName), "2.30");
    await user.click(screen.getByRole("tab", { name: "戦数から考える" }));
    await user.click(screen.getByRole("button", { name: "この成績で推移を見る" }));
    expect(meanField()).toHaveValue("2.48");
    expect(meanField(rivalName)).toHaveValue("2.30");
    expect(resultCells(rivalName)).toEqual(["2.44位", "2.45位"]);
    await user.click(meanField(rivalName));
    await user.keyboard("{Escape}");
    expect(meanField(rivalName)).toHaveValue("2.45");
    await user.click(undo());
    expect(meanField()).toHaveValue("2.85");
    expect(undo()).toBeDisabled();
  });

  it("keeps the comparison trigger focusable without opening or committing pending or invalid input", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    const trigger = screen.getByRole("button", { name: "別の成績と比べる" });
    await user.clear(meanField());
    await user.type(meanField(), "2.60");
    await user.click(trigger);
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(meanField()).toHaveValue("2.60");
    expect(resultCells()[1]).toBe("2.52位");
    await setMean(user, "bad");
    await user.click(trigger);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(meanField()).toHaveValue("bad");
    await user.click(meanField());
    await user.keyboard("{Escape}");
    expect(trigger).not.toHaveAttribute("aria-disabled");
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "2つの成績を比べる" })).toBeInTheDocument();
  });

  it.each(["キャンセル", "ダイアログを閉じる", "Escape"])(
    "discards both comparison edits and its rebased baseline with %s",
    async (closing) => {
      const user = userEvent.setup();
      renderOutlook(await makeSeriesAnalysisOutlookSummary());
      const trigger = screen.getByRole("button", { name: "別の成績と比べる" });
      const mainFocus = meanField();
      const mainRival = meanField(rivalName);
      const dialog = await openComparison(user);
      await setMean(user, "2.40", focusName, dialog);
      await setMean(user, "2.55", rivalName, dialog);
      await user.click(screen.getByRole("button", { name: "試した条件を基準にする" }));
      expect(mainFocus).toHaveValue("2.85");
      expect(mainRival).toHaveValue("2.45");
      if (closing === "Escape") await user.keyboard("{Escape}");
      else await user.click(screen.getByRole("button", { name: closing }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(trigger).toHaveFocus();
      expect(meanField()).toHaveValue("2.85");
      expect(meanField(rivalName)).toHaveValue("2.45");
      expect(undo()).toBeDisabled();
      await openComparison(user);
      expect(screen.getByLabelText("残した成績")).toHaveTextContent("これからの平均 2.85位");
      expect(screen.getByLabelText("残した成績")).toHaveTextContent("これからの平均 2.45位");
    },
  );

  it("applies both comparison entries with one Undo while rebasing alone adds no history", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    const dialog = await openComparison(user);
    await setMean(user, "2.40", focusName, dialog);
    await setMean(user, "2.55", rivalName, dialog);
    await user.click(screen.getByRole("button", { name: "この条件を使う" }));
    expect(meanField()).toHaveValue("2.40");
    expect(meanField(rivalName)).toHaveValue("2.55");
    await openComparison(user);
    expect(screen.getByLabelText("残した成績")).toHaveTextContent("これからの平均 2.85位");
    await user.click(screen.getByRole("button", { name: "試した条件を基準にする" }));
    await user.click(screen.getByRole("button", { name: "この条件を使う" }));
    await user.click(undo());
    expect(meanField()).toHaveValue("2.85");
    expect(meanField(rivalName)).toHaveValue("2.45");
    expect(undo()).toBeDisabled();
    await openComparison(user);
    expect(screen.getByLabelText("残した成績")).toHaveTextContent("これからの平均 2.40位");
    expect(screen.getByLabelText("残した成績")).toHaveTextContent("これからの平均 2.55位");
  });

  it("blocks a pending comparison draft and rejects a proposal after its artifact changes", async () => {
    const user = userEvent.setup();
    const initial = await makeSeriesAnalysisOutlookSummary();
    const view = renderOutlook(initial);
    const dialog = await openComparison(user);
    await user.clear(meanField(focusName, dialog));
    await user.type(meanField(focusName, dialog), "2.40");
    expect(screen.getByRole("button", { name: "この条件を使う" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: `${focusName}の平均順位を反映` }));
    expect(screen.getByRole("button", { name: "この条件を使う" })).toBeEnabled();
    view.updateSummary(await correctedSummary(initial));
    expect(screen.getByText(/現在の条件から比べ直してください/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "この条件を使う" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(meanField()).toHaveValue("2.45");
    expect(meanField(rivalName)).toHaveValue("2.05");
    expect(undo()).toBeDisabled();
  });

  it.each(["members", "scope"] as const)(
    "starts a fresh experiment when %s change",
    async (change) => {
      const user = userEvent.setup();
      const initial = await makeSeriesAnalysisOutlookSummary();
      const view = renderOutlook(initial);
      await setMean(user, "2.70");
      await openComparison(user);
      await user.click(screen.getByRole("button", { name: "この条件を使う" }));
      const horizon = screen.getByRole("textbox", { name: "何戦後を見る" });
      await user.clear(horizon);
      await user.type(horizon, "50{Enter}");
      await user.clear(meanField());
      await user.type(meanField(), "2.60");
      await openCounts(user);
      await user.click(screen.getByRole("button", { name: "4位から3位へ1回移す" }));
      if (change === "members") view.updateMembers(["member_ponta", "member_eu"]);
      else
        view.updateSummary(
          await makeSeriesAnalysisOutlookSummary({
            ...initial,
            scope: { ...initial.scope, kind: "season", seasonMasterId: "season-2026" },
          }),
        );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(meanField()).toHaveValue("2.85");
      expect(meanField(rivalName)).toHaveValue("2.45");
      expect(screen.getByRole("textbox", { name: "何戦後を見る" })).toHaveValue("20");
      expect(undo()).toBeDisabled();
      expect(screen.getByRole("button", { name: "別の成績と比べる" })).toBeInTheDocument();
    },
  );

  it("keeps the chart scale fixed while editing and preserves a horizon outside its selected range", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    const axes = chartAxisLabels();
    await setMean(user, "1.35");
    expect(chartAxisLabels()).toEqual(axes);
    await setMean(user, "3.65");
    expect(chartAxisLabels()).toEqual(axes);
    const horizon = screen.getByRole("textbox", { name: "何戦後を見る" });
    for (const value of ["1", "50", "100"]) {
      await user.clear(horizon);
      await user.type(horizon, `${value}{Enter}`);
      expect(chartAxisLabels()).toEqual(axes);
    }
    await user.clear(horizon);
    await user.type(horizon, "101{Enter}");
    expect(screen.getByRole("combobox", { name: "表示範囲" })).toHaveTextContent("100戦");
    expect(horizon).toHaveValue("101");
    expect(screen.getByRole("img")).toHaveAccessibleName(
      /確認する時点は101戦後（グラフの範囲外）/u,
    );
    expect(screen.queryByLabelText("いーゆーの101戦後")).not.toBeInTheDocument();
    expect(screen.getByRole("table", { name: "現在と指定戦数後の総合平均順位" })).toHaveTextContent(
      "101戦後",
    );
    await selectOption(user, screen.getByRole("combobox", { name: "表示範囲" }), "1000");
    expect(screen.getByLabelText("いーゆーの101戦後")).toBeInTheDocument();
    const slider = screen.getByRole("slider", { name: "グラフで確認する戦数" });
    fireEvent.keyDown(slider, { key: "Home" });
    expect(horizon).toHaveValue("1");
    fireEvent.keyDown(slider, { key: "End" });
    expect(horizon).toHaveValue("1000");
  });
});

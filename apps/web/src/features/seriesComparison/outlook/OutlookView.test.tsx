import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { OutlookSessionOwner } from "@/features/seriesComparison/outlook/OutlookSessionOwner";
import { OutlookView } from "@/features/seriesComparison/outlook/OutlookView";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { setDevUser } from "@/test/auth";
import { setupMsw } from "@/test/msw/lifecycle";
import {
  makeSeriesAnalysisOutlookExamples,
  makeSeriesAnalysisOutlookSummary,
} from "@/test/msw/seriesAnalysisOutlookFixtures";
import { server } from "@/test/msw/server";
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
function resultCells(name = focusName) {
  const table = within(screen.getByRole("table", { name: /^現在と\d+戦後の総合平均順位$/u }));
  const column =
    table.getAllByRole("columnheader").indexOf(table.getByRole("columnheader", { name })) - 1;
  return ["現在", "平均"].map((label) => {
    const cell = within(
      table.getByRole("row", { name: new RegExp(`^${label}`, "u") }),
    ).getAllByRole("cell")[column]!;
    return within(cell).getByText(/^\d\.\d{2}位$/u).textContent;
  });
}
function undo() {
  return screen.getByRole("button", { name: "成績を1つ戻す" });
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
async function pinComparison(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "この成績を残して比べる" }));
}

function pastExamples(name: string) {
  const trigger = screen.getByRole("button", { name: `${name}の過去の成績例` });
  const panelId = trigger.getAttribute("aria-controls");
  const panel = panelId ? document.getElementById(panelId) : null;
  if (!panel) throw new Error(`The historical examples for ${name} must be open.`);
  return within(panel);
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
  it("keeps both named editors and result columns in member order when focus follows rival", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary(), ["member_ponta", "member_eu"]);
    expect(meanField(focusName)).toHaveValue("2.85");
    expect(meanField(rivalName)).toHaveValue("2.45");
    const table = within(screen.getByRole("table", { name: "現在と20戦後の総合平均順位" }));
    expect(table.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "展開",
      "いーゆー",
      "ぽんた",
    ]);
    const otherBefore = resultCells(focusName);
    await setMean(user, "2.40", rivalName);
    expect(resultCells(focusName)).toEqual(otherBefore);
    expect(resultCells(rivalName)).toEqual(["2.44位", "2.42位"]);
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
    expect(screen.getByText(/反映済み.*2.85位/u)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `${focusName}の平均順位を反映` }));
    expect(resultCells(focusName)).toEqual(["2.31位", "2.42位"]);
    await setMean(user, "2.6001");
    await user.click(meanField(rivalName));
    expect(meanField()).toHaveValue("2.6001");
    expect(meanField()).toHaveAccessibleDescription(/0\.01刻み/u);
    expect(resultCells(focusName)).toEqual(["2.31位", "2.42位"]);
    await user.click(screen.getByRole("button", { name: `${focusName}の入力を取り消す` }));
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
    await pinComparison(user);
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
    expect(screen.getByRole("button", { name: "この成績を残して比べる" })).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: `${focusName}の入力を取り消す` }));
    expect(meanField()).toHaveValue("2.50");
    expect(meanField()).not.toHaveAttribute("aria-invalid", "true");
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
    await user.click(screen.getByRole("button", { name: /^平均.+位で推移を見る$/u }));
    expect(screen.getByRole("tab", { name: "成績から試す" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getAllByRole("figure")).toHaveLength(4);
    expect(screen.getByRole("textbox", { name: "何戦後を見る" })).toHaveValue("500");
    expect(screen.getByRole("combobox", { name: "表示範囲" })).toHaveTextContent("200戦");
    expect(meanField()).toHaveValue("2.45");
    expect(meanField(rivalName)).toHaveValue("2.45");
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "平均どおりに進むと" })).toHaveFocus(),
    );
    await user.click(undo());
    expect(meanField()).toHaveValue("2.85");
    expect(undo()).toBeDisabled();
  });

  it("waits for the rival's pending input to be resolved before applying a goal", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    await user.clear(meanField());
    await user.type(meanField(), "2.60");
    await user.clear(meanField(rivalName));
    await user.type(meanField(rivalName), "2.30");
    await user.click(screen.getByRole("tab", { name: "戦数から考える" }));
    const apply = screen.getByRole("button", { name: /^平均.+位で推移を見る$/u });
    expect(apply).toBeDisabled();
    await user.click(apply);
    expect(screen.getByRole("tab", { name: "戦数から考える" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(meanField(rivalName)).toHaveValue("2.30");
    await user.click(screen.getByRole("button", { name: `${rivalName}の入力を取り消す` }));
    expect(meanField(rivalName)).toHaveValue("2.45");
    await user.click(apply);
    expect(meanField()).toHaveValue("2.48");
    expect(meanField(rivalName)).toHaveValue("2.45");
    expect(resultCells(rivalName)).toEqual(["2.44位", "2.45位"]);
    await user.click(undo());
    expect(meanField()).toHaveValue("2.85");
    expect(undo()).toBeDisabled();
  });

  it("requires pending inputs to be resolved before pinning without changing them on comparison controls", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    const pin = screen.getByRole("button", { name: "この成績を残して比べる" });
    expect(pin).toHaveTextContent("残して比べる");
    await user.clear(meanField());
    await user.type(meanField(), "2.60");
    expect(pin).toBeDisabled();
    await user.click(pin);
    expect(meanField()).toHaveValue("2.60");
    expect(resultCells()[1]).toBe("2.52位");
    await user.click(screen.getByRole("button", { name: `${focusName}の入力を取り消す` }));
    await user.click(pin);
    expect(screen.getByLabelText(`${focusName}の比較基準`)).toHaveTextContent("2.85位");
    expect(undo()).toBeDisabled();
    await setMean(user, "bad");
    expect(
      screen.getByRole("button", { name: "基準を更新（今の成績を基準にする）" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "比較を終える" }));
    expect(meanField()).toHaveValue("bad");
    expect(meanField()).toHaveAttribute("aria-invalid", "true");
    expect(undo()).toBeDisabled();
    await user.click(screen.getByRole("button", { name: `${focusName}の入力を取り消す` }));
    expect(meanField()).toHaveValue("2.85");
    expect(pin).toBeEnabled();
  });

  it("compares the main inputs to a fixed baseline and keeps rebasing separate from Undo", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    expect(screen.getByLabelText(`${focusName}の直近の平均`)).toHaveTextContent(
      "直近の平均 2.85位",
    );
    await pinComparison(user);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(undo()).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "基準を更新（今の成績を基準にする）" }),
    ).toHaveTextContent("基準を更新");
    const comparison = within(screen.getByRole("region", { name: "平均どおりに進んだときの差" }));
    expect(comparison.getAllByRole("term").map((term) => term.textContent)).toEqual([
      "残した成績",
      "今の成績",
    ]);
    for (const outcome of comparison.getAllByRole("definition"))
      expect(outcome).toHaveTextContent("11戦後にぽんたが上回ります");
    await setMean(user, "2.65");
    expect(screen.getByRole("status")).toHaveTextContent(
      "ぽんたに上回られる時点が10戦遅くなります",
    );
    expect(screen.getByText("11戦後にぽんたが上回ります")).toBeInTheDocument();
    expect(screen.getByText("21戦後にぽんたが上回ります")).toBeInTheDocument();
    await setMean(user, "2.55", rivalName);
    expect(screen.getByRole("status")).toHaveTextContent(
      "ぽんたに上回られる時点が30戦遅くなります",
    );
    expect(screen.getByLabelText(`${focusName}の比較基準`)).toHaveTextContent("2.85位");
    expect(screen.getByLabelText(`${rivalName}の比較基準`)).toHaveTextContent("2.45位");
    await user.click(undo());
    expect(meanField()).toHaveValue("2.65");
    expect(meanField(rivalName)).toHaveValue("2.45");
    expect(screen.getByLabelText(`${focusName}の比較基準`)).toHaveTextContent("2.85位");
    await user.click(screen.getByRole("button", { name: "基準を更新（今の成績を基準にする）" }));
    expect(screen.getByLabelText(`${focusName}の比較基準`)).toHaveTextContent("2.65位");
    for (const outcome of comparison.getAllByRole("definition"))
      expect(outcome).toHaveTextContent("21戦後にぽんたが上回ります");
    await user.click(undo());
    expect(meanField()).toHaveValue("2.85");
    expect(undo()).toBeDisabled();
    expect(screen.getByLabelText(`${focusName}の比較基準`)).toHaveTextContent("2.65位");
    expect(screen.getByRole("status")).toHaveTextContent("ぽんたに上回られる時点が10戦早まります");
    await user.click(screen.getByRole("button", { name: "比較を終える" }));
    expect(meanField()).toHaveValue("2.85");
    expect(meanField(rivalName)).toHaveValue("2.45");
    expect(undo()).toBeDisabled();
    expect(screen.queryByLabelText(`${focusName}の比較基準`)).not.toBeInTheDocument();
    expect(screen.getByLabelText(`${focusName}の直近の平均`)).toHaveTextContent(
      "直近の平均 2.85位",
    );
    expect(screen.getByText("11戦後にぽんたが上回ります")).toBeInTheDocument();
  });

  it("continues following recent results when pinning has not changed either condition", async () => {
    const user = userEvent.setup();
    const initial = await makeSeriesAnalysisOutlookSummary();
    const view = renderOutlook(initial);
    await pinComparison(user);
    view.updateSummary(await correctedSummary(initial));
    expect(meanField()).toHaveValue("2.45");
    expect(meanField(rivalName)).toHaveValue("2.05");
    expect(undo()).toBeDisabled();
    expect(screen.queryByLabelText(`${focusName}の比較基準`)).not.toBeInTheDocument();
    expect(screen.getByText(/比較の基準に残した成績を解除しました/u)).toBeInTheDocument();
  });

  it("preserves the shared chart horizon, input draft, and comparison baseline across task switches", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    const horizon = screen.getByRole("textbox", { name: "何戦後を見る" });
    await user.clear(horizon);
    await user.type(horizon, "450{Enter}");
    await selectOption(user, screen.getByRole("combobox", { name: "表示範囲" }), "50");
    await pinComparison(user);
    const average = resultCells();
    await user.clear(meanField());
    await user.type(meanField(), "2.60");
    await user.click(screen.getByRole("tab", { name: "戦数から考える" }));
    expect(screen.getByRole("textbox", { name: "目標の戦数" })).toHaveValue("100");
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "成績から試す" }));
    expect(screen.getByRole("textbox", { name: "何戦後を見る" })).toHaveValue("450");
    expect(screen.getByRole("combobox", { name: "表示範囲" })).toHaveTextContent("50戦");
    expect(screen.getAllByRole("figure")).toHaveLength(4);
    expect(resultCells()).toEqual(average);
    expect(meanField()).toHaveValue("2.60");
    expect(meanField(rivalName)).toHaveValue("2.45");
    expect(screen.getByLabelText(`${focusName}の比較基準`)).toHaveTextContent("2.85位");
    expect(undo()).toBeDisabled();
  });

  it.each(["members", "scope"] as const)(
    "starts a fresh experiment when %s change",
    async (change) => {
      const user = userEvent.setup();
      const initial = await makeSeriesAnalysisOutlookSummary();
      const view = renderOutlook(initial);
      await setMean(user, "2.70");
      await pinComparison(user);
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
      expect(screen.getByRole("button", { name: "この成績を残して比べる" })).toBeInTheDocument();
    },
  );

  it("keeps results beyond the graph's range and lets a graph control the shared horizon", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    const horizon = screen.getByRole("textbox", { name: "何戦後を見る" });
    await user.clear(horizon);
    await user.type(horizon, "101{Enter}");
    expect(screen.getByRole("combobox", { name: "表示範囲" })).toHaveTextContent("100戦");
    expect(horizon).toHaveValue("101");
    for (const chart of screen.getAllByRole("img"))
      expect(chart).toHaveAccessibleName(/確認する時点は101戦後（グラフの範囲外）/u);
    expect(screen.queryAllByLabelText("いーゆーの101戦後")).toHaveLength(0);
    expect(screen.getByRole("table", { name: "現在と101戦後の総合平均順位" })).toBeVisible();
    await selectOption(user, screen.getByRole("combobox", { name: "表示範囲" }), "200");
    expect(screen.getAllByLabelText("いーゆーの101戦後")).toHaveLength(4);
    const slider = screen.getByRole("slider", { name: "平均のグラフで確認する戦数" });
    fireEvent.keyDown(slider, { key: "Home" });
    expect(horizon).toHaveValue("1");
    fireEvent.keyDown(slider, { key: "End" });
    expect(horizon).toHaveValue("1000");
    expect(screen.getByRole("table", { name: "現在と1000戦後の総合平均順位" })).toBeVisible();
    for (const chart of screen.getAllByRole("img"))
      expect(chart).toHaveAccessibleName(/この先200戦.+確認する時点は1000戦後（グラフの範囲外）/u);
  });

  it("opens an event beyond 200 games in the numeric table while keeping the graph bounded", async () => {
    const user = userEvent.setup();
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    await setMean(user, "2.46");
    await user.click(screen.getByRole("button", { name: "401戦後の数値を見る" }));
    expect(screen.getByRole("textbox", { name: "何戦後を見る" })).toHaveValue("401");
    expect(screen.getByRole("combobox", { name: "表示範囲" })).toHaveTextContent("200戦");
    expect(screen.getByRole("table", { name: "現在と401戦後の総合平均順位" })).toBeVisible();
    for (const chart of screen.getAllByRole("img"))
      expect(chart).toHaveAccessibleName(/この先200戦.+確認する時点は401戦後（グラフの範囲外）/u);
  });

  it("loads each person's examples on demand and applies only the rival after pending inputs are resolved", async () => {
    const user = userEvent.setup();
    const base = await makeSeriesAnalysisOutlookExamples();
    const focusExamples = await makeSeriesAnalysisOutlookExamples({
      memberId: "member_eu",
      examples: {
        ...base.examples,
        types: base.examples.types.filter((example) => example.window.rankSum === 47),
      },
    });
    const rivalExamples = await makeSeriesAnalysisOutlookExamples({
      memberId: "member_ponta",
      examples: {
        ...base.examples,
        types: base.examples.types.filter((example) => example.window.rankSum === 44),
      },
    });
    const requestedMembers: string[] = [];
    server.use(
      http.get("/api/analytics/series-comparison/v1/outlook-examples", ({ request }) => {
        const memberId = new URL(request.url).searchParams.get("memberId")!;
        requestedMembers.push(memberId);
        return HttpResponse.json(memberId === "member_ponta" ? rivalExamples : focusExamples);
      }),
    );
    renderOutlook(await makeSeriesAnalysisOutlookSummary());
    const horizon = screen.getByRole("textbox", { name: "何戦後を見る" });
    await user.clear(horizon);
    await user.type(horizon, "37");
    expect(requestedMembers).toEqual([]);
    await user.click(screen.getByRole("button", { name: "ぽんたの過去の成績例" }));
    const rival = pastExamples(rivalName);
    expect(await rival.findByText("2.20位")).toBeVisible();
    expect(requestedMembers).toEqual(["member_ponta"]);
    const apply = rival.getByRole("button", { name: "この成績を試す" });
    await user.clear(meanField(rivalName));
    await user.type(meanField(rivalName), "2.10");
    await user.clear(meanField());
    await user.type(meanField(), "2.60");
    expect(rival.getByText(/平均2\.45位以下.*反映済みの平均で確認しています/u)).toBeVisible();
    expect(apply).toBeDisabled();
    expect(apply).toHaveAccessibleDescription(
      "成績例を試す前に、2人の入力を反映するか、取り消してください。",
    );
    await user.click(apply);
    expect(meanField(rivalName)).toHaveValue("2.10");
    expect(meanField()).toHaveValue("2.60");
    expect(undo()).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "ぽんたの入力を取り消す" }));
    expect(apply).toBeDisabled();
    await setMean(user, "bad");
    expect(meanField()).toHaveAttribute("aria-invalid", "true");
    expect(apply).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "いーゆーの入力を取り消す" }));
    const slider = screen.getByRole("slider", { name: "ぽんたの平均順位を動かす" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(apply).toBeDisabled();
    fireEvent.keyUp(slider, { key: "ArrowLeft" });
    expect(apply).toBeEnabled();
    expect(undo()).toBeDisabled();

    await user.click(screen.getByRole("tab", { name: "戦数から考える" }));
    const goal = screen.getByRole("textbox", { name: "目標の戦数" });
    await user.clear(goal);
    await user.type(goal, "80");
    expect(screen.getByRole("button", { name: "ぽんたの過去の成績例" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: "いーゆーの過去の成績例" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(requestedMembers).toEqual(["member_ponta"]);
    await user.click(screen.getByRole("button", { name: "いーゆーの過去の成績例" }));
    expect(await pastExamples(focusName).findByText("2.35位")).toBeVisible();
    expect(pastExamples(rivalName).queryByText("2.35位")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ぽんたの過去の成績例" }));
    expect(screen.getByRole("button", { name: "いーゆーの過去の成績例" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await user.click(screen.getByRole("tab", { name: "成績から試す" }));
    expect(screen.getByRole("button", { name: "ぽんたの過去の成績例" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await user.click(screen.getByRole("button", { name: "ぽんたの過去の成績例" }));
    await user.click(screen.getByRole("tab", { name: "戦数から考える" }));
    expect(screen.getByRole("button", { name: "いーゆーの過去の成績例" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await user.click(pastExamples(rivalName).getByRole("button", { name: "この成績を試す" }));
    expect(screen.getByRole("tab", { name: "戦数から考える" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("textbox", { name: "目標の戦数" })).toHaveValue("80");
    expect(meanField(rivalName)).toHaveValue("2.20");
    await user.click(screen.getByRole("tab", { name: "成績から試す" }));
    expect(screen.getByRole("textbox", { name: "何戦後を見る" })).toHaveValue("37");
    expect(meanField()).toHaveValue("2.85");
    await openCounts(user, rivalName);
    expect(displayedCounts(rivalName)).toEqual(["5回", "7回", "7回", "1回"]);
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    await user.click(undo());
    expect(meanField()).toHaveValue("2.85");
    expect(meanField(rivalName)).toHaveValue("2.45");
    expect(undo()).toBeDisabled();
    expect(requestedMembers).toEqual(["member_ponta", "member_eu"]);
  });
});

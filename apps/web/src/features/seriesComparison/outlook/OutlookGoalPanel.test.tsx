import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useLayoutEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  distributionFromCounts,
  distributionMean,
} from "@/features/seriesComparison/model/outlook";
import { OutlookEditor } from "@/features/seriesComparison/outlook/OutlookEditor";
import { OutlookGoalPanel } from "@/features/seriesComparison/outlook/OutlookGoalPanel";
import { OutlookHorizonControl } from "@/features/seriesComparison/outlook/OutlookHorizonControl";
import {
  adoptOutlookSummary,
  outlookPlayer,
  undoOutlook,
} from "@/features/seriesComparison/outlook/outlookSession";
import type { OutlookSession } from "@/features/seriesComparison/outlook/outlookSession";
import {
  OutlookSessionOwner,
  useOutlookSession,
} from "@/features/seriesComparison/outlook/OutlookSessionOwner";
import type {
  SeriesAnalysisOutlookExamples,
  SeriesAnalysisOutlookSummary,
} from "@/shared/api/seriesAnalysis";
import { setDevUser } from "@/test/auth";
import { setupMsw } from "@/test/msw/lifecycle";
import {
  makeSeriesAnalysisOutlookSummary,
  makeSeriesAnalysisOutlookWindow,
  makeSeriesAnalysisOutlookExamples,
} from "@/test/msw/seriesAnalysisOutlookFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();
beforeEach(() => setDevUser());

const memberIds = ["member_eu", "member_ponta"] as const;
const names = ["いーゆー", "ぽんた"] as const;
type RankCounts = SeriesAnalysisOutlookExamples["examples"]["types"][number]["rankCounts"];

async function historicalExamples(memberId: string, counts: readonly RankCounts[]) {
  const base = await makeSeriesAnalysisOutlookExamples({ memberId });
  const window = base.examples.types[0]!.window;
  return makeSeriesAnalysisOutlookExamples({
    ...base,
    examples: {
      status: "available",
      types: counts.map((rankCounts) => {
        const rankSum = rankCounts.reduce((sum, count, index) => sum + count * (index + 1), 0);
        return { rankCounts, window: { ...window, rankSum, averageRank: rankSum / 20 } };
      }),
    },
  });
}

function pastExamples(name: string) {
  const trigger = screen.getByRole("button", { name: `${name}の過去の成績例` });
  const panelId = trigger.getAttribute("aria-controls");
  const panel = panelId ? document.getElementById(panelId) : null;
  if (!panel) throw new Error(`The historical examples for ${name} must be open.`);
  return within(panel);
}

function initialSession(response: SeriesAnalysisOutlookSummary) {
  return adoptOutlookSummary(undefined, response, "scope", [...memberIds])!;
}

function renderGoal(response: SeriesAnalysisOutlookSummary, initial = initialSession(response)) {
  const onUsePerformance = vi.fn();
  const queryClient = createTestQueryClient();
  let readSession = () => initial;
  const cumulative = {
    games: response.scope.matchCount,
    focusRankSum: outlookPlayer(response.players, memberIds[0]).rankSum,
    rivalRankSum: outlookPlayer(response.players, memberIds[1]).rankSum,
  };
  const recent = [
    distributionFromCounts(outlookPlayer(response.recent.players, memberIds[0]).rankCounts),
    distributionFromCounts(outlookPlayer(response.recent.players, memberIds[1]).rankCounts),
  ] as const;
  function Workspace() {
    const { store, session: stored } = useOutlookSession();
    const session = stored ?? initial;
    useLayoutEffect(() => {
      readSession = () => store.getSnapshot() ?? initial;
    }, [store]);
    const change = (update: (current: OutlookSession) => OutlookSession) =>
      store.update((current) => update(current ?? initial));
    return (
      <OutlookGoalPanel
        response={response}
        cumulative={cumulative}
        session={session}
        names={names}
        memberIds={memberIds}
        recent={recent}
        change={change}
        horizonControl={
          <OutlookHorizonControl
            horizon={session.goalHorizon}
            horizonText={session.goalHorizonText}
            label="目標の戦数"
            onChange={({ horizon, horizonText }) =>
              change((current) => ({
                ...current,
                goalHorizon: horizon,
                goalHorizonText: horizonText,
              }))
            }
          />
        }
        opponentEditor={
          <OutlookEditor session={session} role={1} method="mean" name={names[1]} change={change} />
        }
        onUsePerformance={onUsePerformance}
      />
    );
  }
  render(
    <QueryClientProvider client={queryClient}>
      <OutlookSessionOwner>
        <Workspace />
      </OutlookSessionOwner>
    </QueryClientProvider>,
  );
  return { readSession: () => readSession(), onUsePerformance };
}

describe("OutlookGoalPanel", () => {
  it.each(["cancel", "reflect", "cancel-error"] as const)(
    "waits for the rival draft to %s before applying the goal mean to the focus",
    async (resolution) => {
      const user = userEvent.setup();
      const response = await makeSeriesAnalysisOutlookSummary();
      const initial = initialSession(response);
      initial.entries[0].meanDraft = "2.60";
      if (resolution === "cancel-error") initial.entries[1].error = "相手と両立しない内訳です。";
      else initial.entries[1].meanDraft = "2.30";
      const view = renderGoal(response, initial);
      expect(
        screen.getByRole("heading", { name: "100戦後もいーゆーが先行を維持するには" }),
      ).toBeVisible();
      expect(screen.getByText("平均2.48位以下")).toBeVisible();
      expect(screen.getByText("作品内の連続100戦の自己ベスト")).toBeVisible();
      expect(screen.getByText("作品の実績32戦では不足")).toBeVisible();
      const pendingAction = screen.getByRole("button", { name: "平均2.48位で推移を見る" });
      expect(pendingAction).toBeDisabled();
      await user.click(pendingAction);
      expect(view.readSession()).toBe(initial);
      expect(view.onUsePerformance).not.toHaveBeenCalled();
      await user.click(
        screen.getByRole("button", {
          name: resolution === "reflect" ? "ぽんたの平均順位を反映" : "ぽんたの入力を取り消す",
        }),
      );
      const ready = view.readSession();
      if (resolution === "reflect") {
        expect(distributionMean(ready.entries[1].distribution)).toEqual({
          numerator: 23n,
          denominator: 10n,
        });
      } else {
        expect(ready.entries[1]).toEqual({
          ...initial.entries[1],
          meanDraft: undefined,
          error: undefined,
        });
        expect(ready.history).toEqual(initial.history);
        expect(screen.getByRole("textbox", { name: "ぽんたのこれからの平均順位" })).toHaveFocus();
      }
      // A mean of rival + 0.04 ties at 100 games; the selected hundredth must be lower.
      const appliedMean = resolution === "reflect" ? "2.33" : "2.48";
      const apply = screen.getByRole("button", { name: `平均${appliedMean}位で推移を見る` });
      expect(apply).toBeEnabled();
      await user.click(apply);
      const result = view.readSession();
      expect(distributionMean(result.entries[0].distribution)).toEqual(
        resolution === "reflect"
          ? { numerator: 233n, denominator: 100n }
          : { numerator: 62n, denominator: 25n },
      );
      expect(result.entries[0].source.kind).toBe("average");
      expect(result.entries[0].meanDraft).toBeUndefined();
      expect(result.entries[1]).toEqual(ready.entries[1]);
      expect(result.history).toHaveLength(ready.history.length + 1);
      expect(undoOutlook(result).entries.map((entry) => entry.distribution)).toEqual(
        ready.entries.map((entry) => entry.distribution),
      );
      expect(result.horizon).toBe(20);
      expect(view.onUsePerformance).toHaveBeenCalledOnce();
    },
  );

  it("waits for the rival slider gesture to finish before applying the goal", async () => {
    const user = userEvent.setup();
    const view = renderGoal(await makeSeriesAnalysisOutlookSummary());
    await user.click(screen.getByRole("textbox", { name: "ぽんたのこれからの平均順位" }));
    await user.tab();
    const slider = screen.getByRole("slider", { name: "ぽんたの平均順位を動かす" });
    expect(slider).toHaveFocus();
    await user.keyboard("{ArrowLeft>}");
    const apply = screen.getByRole("button", { name: "平均2.47位で推移を見る" });
    expect(apply).toBeDisabled();
    fireEvent.click(apply);
    expect(view.onUsePerformance).not.toHaveBeenCalled();
    await user.keyboard("{/ArrowLeft}");
    expect(apply).toBeEnabled();
    await user.click(apply);
    const result = view.readSession();
    expect(distributionMean(result.entries[0].distribution)).toEqual({
      numerator: 247n,
      denominator: 100n,
    });
    expect(distributionMean(result.entries[1].distribution)).toEqual({
      numerator: 61n,
      denominator: 25n,
    });
    expect(result.history).toHaveLength(2);
    expect(view.onUsePerformance).toHaveBeenCalledOnce();
  });

  it("keeps a stronger performance while clearing only its own pending input when applying the goal", async () => {
    const user = userEvent.setup();
    const response = await makeSeriesAnalysisOutlookSummary();
    const initial = initialSession(response);
    initial.entries[0] = {
      distribution: distributionFromCounts([7, 6, 4, 3]),
      source: { kind: "counts" },
      meanDraft: "2.11",
      error: "入力を見直してください。",
    };
    const view = renderGoal(response, initial);
    expect(screen.getByText("今の平均2.15位で維持できます")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "平均2.15位で推移を見る" }));
    const result = view.readSession();
    expect(result.entries[0]).toEqual({
      distribution: initial.entries[0].distribution,
      source: initial.entries[0].source,
      meanDraft: undefined,
      error: undefined,
    });
    expect(result.entries[1]).toEqual(initial.entries[1]);
    expect(result.history).toEqual(initial.history);
    expect(view.onUsePerformance).toHaveBeenCalledOnce();
  });

  it("keeps the last goal result while its input is incomplete and does not change chart observation", async () => {
    const user = userEvent.setup();
    const view = renderGoal(await makeSeriesAnalysisOutlookSummary());
    const horizon = screen.getByRole("textbox", { name: "目標の戦数" });
    const usePerformance = screen.getByRole("button", { name: "平均2.48位で推移を見る" });
    await user.clear(horizon);
    expect(usePerformance).toBeDisabled();
    expect(screen.getByText("平均2.48位以下")).toBeVisible();
    await user.click(usePerformance);
    expect(view.onUsePerformance).not.toHaveBeenCalled();
    await user.type(horizon, "50");
    expect(screen.getByText("平均2.52位以下")).toBeVisible();
    expect(usePerformance).toBeEnabled();
    expect(view.readSession().goalHorizon).toBe(50);
    expect(view.readSession().horizon).toBe(20);
    expect(view.readSession().history).toHaveLength(0);
    await user.clear(horizon);
    await user.paste("1001");
    expect(horizon).toHaveAccessibleDescription(
      "1〜1000の整数で入力してください（現在は50戦後を表示）。",
    );
    expect(usePerformance).toBeDisabled();
    expect(screen.getByText("平均2.52位以下")).toBeVisible();
    expect(view.readSession().goalHorizon).toBe(50);
    expect(view.readSession().horizon).toBe(20);
  });

  it("does not recommend a recent distribution that conflicts with the rival", async () => {
    const response = await makeSeriesAnalysisOutlookSummary();
    const initial = initialSession(response);
    initial.entries[0].distribution = distributionFromCounts([8, 7, 5, 0]);
    initial.entries[1].distribution = distributionFromCounts([0, 0, 5, 15]);
    renderGoal(response, initial);
    expect(screen.getByText("平均は条件内・内訳の変更が必要")).toBeVisible();
    expect(screen.queryByText("直近の成績で維持できる")).not.toBeInTheDocument();
  });

  it("does not offer an application when no compatible performance can meet the goal", async () => {
    const user = userEvent.setup();
    const response = await makeSeriesAnalysisOutlookSummary();
    const initial = initialSession(response);
    initial.entries[0].distribution = distributionFromCounts([0, 20, 0, 0]);
    initial.entries[1].distribution = distributionFromCounts([20, 0, 0, 0]);
    const view = renderGoal(response, initial);
    expect(screen.getByText("相手がこの成績なら届きません")).toBeVisible();
    const usePerformance = screen.getByRole("button", { name: "推移を見る" });
    expect(usePerformance).toBeDisabled();
    await user.click(usePerformance);
    expect(view.readSession()).toBe(initial);
    expect(view.onUsePerformance).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "distinguishes input precision from mathematical reachability (existing exact performance: %s)",
    async (alreadyReaches) => {
      const user = userEvent.setup();
      const response = await makeSeriesAnalysisOutlookSummary();
      const initial = {
        ...initialSession(response),
        goalHorizon: 1000,
        goalHorizonText: "1000",
      };
      // The rival's 1.499 mean needs a focus mean below 1.503. Its compatible minimum is 1.501.
      initial.entries[1].distribution = distributionFromCounts([501, 499, 0, 0]);
      initial.entries[0].distribution = distributionFromCounts(
        alreadyReaches ? [499, 501, 0, 0] : [0, 0, 20, 0],
      );
      const view = renderGoal(response, initial);
      const usePerformance = screen.getByRole("button", {
        name: alreadyReaches ? "平均1.5010位で推移を見る" : "推移を見る",
      });
      expect(screen.queryByText("相手がこの成績なら届きません")).not.toBeInTheDocument();
      if (alreadyReaches) {
        expect(screen.getByText("今の平均1.5010位で維持できます")).toBeVisible();
        expect(usePerformance).toBeEnabled();
      } else {
        expect(screen.getByText("入力できる細かさでは指定できません")).toBeVisible();
        expect(usePerformance).toBeDisabled();
      }
      await user.click(usePerformance);
      expect(view.readSession()).toEqual(initial);
      expect(view.onUsePerformance).toHaveBeenCalledTimes(alreadyReaches ? 1 : 0);
    },
  );

  it("retries a failed same-length historical read without blocking the goal calculation", async () => {
    const user = userEvent.setup();
    const response = await makeSeriesAnalysisOutlookSummary();
    const available = await makeSeriesAnalysisOutlookWindow(10, { memberId: memberIds[0] });
    const requested: number[] = [];
    let failed = true;
    server.use(
      http.get("/api/analytics/series-comparison/v1/outlook-window", ({ request }) => {
        requested.push(Number(new URL(request.url).searchParams.get("windowSize")));
        return failed
          ? HttpResponse.json({ title: "Unavailable" }, { status: 503 })
          : HttpResponse.json(available);
      }),
    );
    renderGoal(response, { ...initialSession(response), goalHorizon: 10, goalHorizonText: "10" });
    const retry = await screen.findByRole("button", { name: "過去実績を再読み込み" });
    expect(screen.getByText("平均2.84位以下")).toBeVisible();
    failed = false;
    await user.click(retry);
    const facts = screen.getByLabelText("いーゆーの目標と過去の成績");
    expect(
      await within(facts).findByText(`${available.window!.averageRank.toFixed(2)}位`),
    ).toBeVisible();
    expect(requested).toEqual([10, 10]);
  });

  it("uses the goal condition for historical examples and opens the performance after applying one", async () => {
    const user = userEvent.setup();
    const response = await makeSeriesAnalysisOutlookSummary();
    const initial = { ...initialSession(response), horizon: 1, horizonText: "1" };
    initial.entries[1].meanDraft = "2.30";
    const view = renderGoal(response, initial);
    await user.click(screen.getByRole("button", { name: "いーゆーの過去の成績例" }));
    const examples = await pastExamples(names[0]).findAllByRole("button", {
      name: "この成績を試す",
    });
    expect(examples).toHaveLength(3);
    expect(screen.getByText(/100戦続けると上回れる例/u)).toBeVisible();
    expect(examples[0]).toBeDisabled();
    expect(examples[0]).toHaveAccessibleDescription(
      "ぽんたの入力を反映するか、取り消してください。",
    );
    await user.click(examples[0]!);
    expect(distributionMean(view.readSession().entries[0].distribution)).toEqual({
      numerator: 57n,
      denominator: 20n,
    });
    expect(view.readSession().entries[1].meanDraft).toBe("2.30");
    expect(view.onUsePerformance).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "ぽんたの入力を取り消す" }));
    const ready = view.readSession();
    expect(examples[0]).toBeEnabled();
    await user.click(examples[0]!);
    const result = view.readSession();
    expect(result.entries[0].distribution).toEqual(distributionFromCounts([4, 7, 7, 2]));
    expect(result.entries[0].source).toMatchObject({ kind: "example", matchCount: 20 });
    expect(result.entries[1]).toEqual(ready.entries[1]);
    expect(result.history).toHaveLength(1);
    expect(result.horizon).toBe(1);
    expect(view.onUsePerformance).toHaveBeenCalledOnce();
  });

  it("includes an equal rival mean without rounding an exceeding example down or weakening the focus goal", async () => {
    const user = userEvent.setup();
    const response = await makeSeriesAnalysisOutlookSummary();
    const initial = {
      ...initialSession(response),
      task: "goal" as const,
      goalHorizon: 80,
      goalHorizonText: "80",
    };
    initial.entries[1] = {
      distribution: distributionFromCounts([0, 551, 449, 0]),
      source: { kind: "counts" },
    };
    const focusExamples = await historicalExamples(memberIds[0], [
      [4, 6, 6, 4],
      [6, 4, 6, 4],
    ]);
    const rivalExamples = await historicalExamples(memberIds[1], [
      [5, 5, 6, 4],
      [6, 4, 6, 4],
    ]);
    server.use(
      http.get("/api/analytics/series-comparison/v1/outlook-examples", ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.get("memberId") === memberIds[1]
            ? rivalExamples
            : focusExamples,
        ),
      ),
    );
    const view = renderGoal(response, initial);
    await user.click(screen.getByRole("button", { name: "ぽんたの過去の成績例" }));
    const rival = pastExamples(names[1]);
    expect(await rival.findByText("2.40位")).toBeVisible();
    // 2.449 rounds to 2.45, but the historical mean 2.45 still exceeds the exact condition.
    expect(rival.queryByText("2.45位")).not.toBeInTheDocument();
    expect(rival.getAllByRole("button", { name: "この成績を試す" })).toHaveLength(1);
    const mean = screen.getByRole("textbox", { name: "ぽんたのこれからの平均順位" });
    await user.clear(mean);
    await user.type(mean, "2.45{Enter}");
    expect(rival.getByText("2.45位")).toBeVisible();
    expect(rival.getAllByRole("button", { name: "この成績を試す" })).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "いーゆーの過去の成績例" }));
    const focus = pastExamples(names[0]);
    expect(await focus.findByText("2.40位")).toBeVisible();
    // At 80 games, 2.50 ties the rival; the focus goal still requires a strictly lower mean.
    expect(focus.queryByText("2.50位")).not.toBeInTheDocument();
    expect(focus.getAllByRole("button", { name: "この成績を試す" })).toHaveLength(1);
    expect(view.onUsePerformance).not.toHaveBeenCalled();
  });

  it.each([
    { counts: [0, 0, 0, 20], message: "指定した平均を満たす20戦の実績例がありません。" },
    {
      counts: [20, 0, 0, 0],
      message: "指定した平均を満たす実績はありますが、注目する人の成績と両立する例がありません。",
    },
  ] satisfies Array<{ counts: RankCounts; message: string }>)(
    "does not offer a rival application when $message",
    async ({ counts, message }) => {
      const user = userEvent.setup();
      const response = await makeSeriesAnalysisOutlookSummary();
      const initial = initialSession(response);
      const examples = await historicalExamples(memberIds[1], [counts]);
      server.use(
        http.get("/api/analytics/series-comparison/v1/outlook-examples", () =>
          HttpResponse.json(examples),
        ),
      );
      const view = renderGoal(response, initial);
      await user.click(screen.getByRole("button", { name: "ぽんたの過去の成績例" }));
      const panel = pastExamples(names[1]);
      expect(await panel.findByText(message)).toBeVisible();
      expect(panel.queryByRole("button", { name: "この成績を試す" })).not.toBeInTheDocument();
      expect(view.readSession().entries).toEqual(initial.entries);
      expect(view.readSession().history).toEqual(initial.history);
      expect(view.onUsePerformance).not.toHaveBeenCalled();
    },
  );
});

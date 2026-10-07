import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useLayoutEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  distributionFromCounts,
  distributionMean,
} from "@/features/seriesComparison/model/outlook";
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
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { setDevUser } from "@/test/auth";
import { setupMsw } from "@/test/msw/lifecycle";
import {
  makeSeriesAnalysisOutlookSummary,
  makeSeriesAnalysisOutlookWindow,
} from "@/test/msw/seriesAnalysisOutlookFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();
beforeEach(() => setDevUser());

const memberIds = ["member_eu", "member_ponta"] as const;
const names = ["いーゆー", "ぽんた"] as const;

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
        opponentEditor={<p>相手の成績入力</p>}
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
  it("uses the goal horizon, applies the strict mean to the focus only, and retains the rival draft", async () => {
    const user = userEvent.setup();
    const response = await makeSeriesAnalysisOutlookSummary();
    const initial = initialSession(response);
    initial.entries[0].meanDraft = "2.60";
    initial.entries[1].meanDraft = "2.30";
    const view = renderGoal(response, initial);
    expect(
      screen.getByRole("heading", { name: "100戦後もいーゆーが先行を維持するには" }),
    ).toBeVisible();
    expect(screen.getByText("平均2.48位以下")).toBeVisible();
    expect(screen.getByText("作品内の連続100戦の自己ベスト")).toBeVisible();
    expect(screen.getByText("作品の実績32戦では不足")).toBeVisible();
    // 2.49 ties at 100 games: 74 + 100 * 2.49 = 78 + 100 * 2.45.
    await user.click(screen.getByRole("button", { name: "この成績で推移を見る" }));
    const result = view.readSession();
    expect(distributionMean(result.entries[0].distribution)).toEqual({
      numerator: 62n,
      denominator: 25n,
    });
    expect(result.entries[0].source.kind).toBe("average");
    expect(result.entries[0].meanDraft).toBeUndefined();
    expect(result.entries[1]).toEqual(initial.entries[1]);
    expect(result.history).toHaveLength(1);
    expect(undoOutlook(result).entries.map((entry) => entry.distribution)).toEqual(
      initial.entries.map((entry) => entry.distribution),
    );
    expect(result.horizon).toBe(20);
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
    initial.entries[1].meanDraft = "2.30";
    const view = renderGoal(response, initial);
    expect(screen.getByText("今の平均2.15位で条件を満たしています。")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "今の成績で推移を見る" }));
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
    const usePerformance = screen.getByRole("button", { name: "この成績で推移を見る" });
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
    const usePerformance = screen.getByRole("button", { name: "この成績で推移を見る" });
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
        name: alreadyReaches ? "今の成績で推移を見る" : "この成績で推移を見る",
      });
      expect(screen.queryByText("相手がこの成績なら届きません")).not.toBeInTheDocument();
      if (alreadyReaches) {
        expect(screen.getByText("今の成績で先行を維持できます")).toBeVisible();
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
    const view = renderGoal(response, initial);
    await user.click(screen.getByRole("button", { name: "いーゆーの過去の成績例" }));
    const examples = await screen.findAllByRole("button", { name: "この成績を試す" });
    expect(examples).toHaveLength(3);
    expect(screen.getByText(/100戦続けると上回れる例/u)).toBeVisible();
    await user.click(examples[0]!);
    const result = view.readSession();
    expect(result.entries[0].distribution).toEqual(distributionFromCounts([4, 7, 7, 2]));
    expect(result.entries[0].source).toMatchObject({ kind: "example", matchCount: 20 });
    expect(result.entries[1]).toEqual(initial.entries[1]);
    expect(result.history).toHaveLength(1);
    expect(result.horizon).toBe(1);
    expect(view.onUsePerformance).toHaveBeenCalledOnce();
  });
});

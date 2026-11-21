import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { OutlookWorkspaceProvider } from "@/features/seriesComparison/outlook/OutlookWorkspaceProvider";
import { OutlookWorkspaceView } from "@/features/seriesComparison/outlook/workspace/OutlookWorkspaceView";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { setDevUser } from "@/test/auth";
import { setupMsw } from "@/test/msw/lifecycle";
import {
  makeCorrectedOutlookSummary,
  makeSeriesAnalysisOutlookExamples,
  makeSeriesAnalysisOutlookSummary,
  makeSeriesAnalysisOutlookWindow,
} from "@/test/msw/seriesAnalysisOutlookFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();
beforeEach(() => setDevUser());

const focusName = "いーゆー";
const rivalName = "ぽんた";

function renderWorkspace(
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
        <OutlookWorkspaceProvider>
          <OutlookWorkspaceView
            summary={summary}
            selection={{
              gameTitleId: summary.artifact.gameTitleId,
              ...(summary.scope.kind === "season"
                ? { seasonMasterId: summary.scope.seasonMasterId }
                : {}),
              view: "outlook",
              focusMemberId: people[0],
              rivalMemberId: people[1],
            }}
          />
        </OutlookWorkspaceProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const result = render(tree(response));
  return {
    updateSummary: (summary: SeriesAnalysisOutlookSummary) => result.rerender(tree(summary)),
    updateMembers: (people: readonly [string, string]) => result.rerender(tree(response, people)),
  };
}

/** A comparison whose URL pair follows the swap button, as the page does. */
function SwappableWorkspace({ summary }: { summary: SeriesAnalysisOutlookSummary }) {
  const [people, setPeople] = useState<readonly [string, string]>(["member_eu", "member_ponta"]);
  return (
    <OutlookWorkspaceView
      summary={summary}
      selection={{
        gameTitleId: summary.artifact.gameTitleId,
        view: "outlook",
        focusMemberId: people[0],
        rivalMemberId: people[1],
      }}
      onPairChange={(focus, rival) => setPeople([focus, rival])}
    />
  );
}

const meanField = (name = focusName) =>
  screen.getByRole("textbox", { name: `${name}のこれからの平均順位` });
const trend = () => within(screen.getByRole("region", { name: "この平均が続くと" }));
/** The visible answer; a screen-reader copy announces it once a gesture settles. */
const visible = { ignore: ".sr-only, script, style" };
const goal = (name = focusName) =>
  within(screen.getByRole("region", { name: `目標の戦数で${name}が上にいるには` }));

async function typeMean(user: ReturnType<typeof userEvent.setup>, value: string, name = focusName) {
  const input = meanField(name);
  await user.clear(input);
  await user.type(input, value);
}

describe("OutlookWorkspace", () => {
  it("answers both questions before any edit", async () => {
    renderWorkspace(await makeSeriesAnalysisOutlookSummary());
    expect(meanField()).toHaveValue("2.85");
    expect(meanField(rivalName)).toHaveValue("2.45");
    expect(trend().getByText("11戦後にぽんたが上回ります", visible)).toBeVisible();
    expect(goal().getByText("平均 2.48位以下")).toBeVisible();
  });

  it("commits a mean only with Enter or its button, keeps it on blur, and cancels with Escape", async () => {
    const user = userEvent.setup();
    renderWorkspace(await makeSeriesAnalysisOutlookSummary());
    await typeMean(user, "2.60");
    await user.click(meanField(rivalName));
    expect(meanField()).toHaveValue("2.60");
    expect(trend().getByText("11戦後にぽんたが上回ります", visible)).toBeVisible();
    await user.click(screen.getByRole("button", { name: `${focusName}の平均順位を反映` }));
    expect(trend().getByText("27戦後にぽんたが上回ります", visible)).toBeVisible();

    await typeMean(user, "2.40");
    await user.keyboard("{Escape}");
    expect(meanField()).toHaveValue("2.60");
    await typeMean(user, "2.70{Enter}");
    expect(meanField()).toHaveValue("2.70");
    expect(trend().queryByText("27戦後にぽんたが上回ります", visible)).not.toBeInTheDocument();
  });

  it("ignores Enter and Escape while an IME composition is active", async () => {
    const user = userEvent.setup();
    renderWorkspace(await makeSeriesAnalysisOutlookSummary());
    await typeMean(user, "2.60");
    const input = meanField();
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Escape", isComposing: true });
    expect(input).toHaveValue("2.60");
    expect(trend().getByText("11戦後にぽんたが上回ります", visible)).toBeVisible();
    fireEvent.compositionEnd(input);
    await user.keyboard("{Enter}");
    expect(trend().getByText("27戦後にぽんたが上回ります", visible)).toBeVisible();
  });

  it("returns one person to the recent results and keeps focus on that person's input", async () => {
    const user = userEvent.setup();
    renderWorkspace(await makeSeriesAnalysisOutlookSummary());
    await typeMean(user, "2.60{Enter}");
    await user.click(screen.getByRole("button", { name: `${focusName}を直近の成績に戻す` }));
    expect(meanField()).toHaveValue("2.85");
    expect(meanField()).toHaveFocus();
    expect(
      screen.queryByRole("button", { name: `${focusName}を直近の成績に戻す` }),
    ).not.toBeInTheDocument();
  });

  it("applies the goal's required mean to the focus person only and waits for the rival's pending input", async () => {
    const user = userEvent.setup();
    renderWorkspace(await makeSeriesAnalysisOutlookSummary());
    await typeMean(user, "2.30", rivalName);
    const apply = goal().getByRole("button", { name: `${focusName}を 2.48位で試す` });
    expect(apply).toBeDisabled();
    await user.click(screen.getByRole("button", { name: `${rivalName}の入力を取り消す` }));
    expect(meanField(rivalName)).toHaveValue("2.45");
    await user.click(apply);
    expect(meanField()).toHaveValue("2.48");
    expect(meanField(rivalName)).toHaveValue("2.45");
  });

  it("keeps the last goal answer while the goal input is incomplete or out of range", async () => {
    const user = userEvent.setup();
    renderWorkspace(await makeSeriesAnalysisOutlookSummary());
    const horizon = goal().getByRole("textbox", { name: "目標の戦数" });
    await user.clear(horizon);
    expect(goal().getByText("平均 2.48位以下")).toBeVisible();
    await user.type(horizon, "1001");
    await user.tab();
    expect(goal().getByText("平均 2.48位以下")).toBeVisible();
    expect(goal().getByRole("alert")).toHaveTextContent("100戦後で表示中");
  });

  it("retries a failed same-length record without blocking the goal answer", async () => {
    const user = userEvent.setup();
    const response = await makeSeriesAnalysisOutlookSummary();
    const available = await makeSeriesAnalysisOutlookWindow(10, { memberId: "member_eu" });
    let failed = true;
    const requested: number[] = [];
    server.use(
      http.get("/api/analytics/series-comparison/v1/outlook-window", ({ request }) => {
        requested.push(Number(new URL(request.url).searchParams.get("windowSize")));
        return failed
          ? HttpResponse.json({ title: "Unavailable" }, { status: 503 })
          : HttpResponse.json(available);
      }),
    );
    renderWorkspace(response);
    const horizon = goal().getByRole("textbox", { name: "目標の戦数" });
    await user.clear(horizon);
    await user.type(horizon, "10");
    const retry = await goal().findByRole("button", { name: "再読み込み" });
    expect(goal().getByText("平均 2.84位以下")).toBeVisible();
    failed = false;
    await user.click(retry);
    expect(
      await goal().findByText(
        new RegExp(`自己ベスト ${available.window!.averageRank.toFixed(2)}位`, "u"),
      ),
    ).toBeVisible();
    expect(requested).toEqual([10, 10]);
  });

  it("follows a refreshed artifact while keeping a pending mean until it is cancelled", async () => {
    const user = userEvent.setup();
    const initial = await makeSeriesAnalysisOutlookSummary();
    const view = renderWorkspace(initial);
    await typeMean(user, "2.60");
    view.updateSummary(await makeCorrectedOutlookSummary(initial));
    expect(meanField()).toHaveValue("2.60");
    expect(meanField(rivalName)).toHaveValue("2.05");
    await user.click(meanField());
    await user.keyboard("{Escape}");
    expect(meanField()).toHaveValue("2.45");
  });

  it("starts a new comparison from the recent results when the people change", async () => {
    const user = userEvent.setup();
    const view = renderWorkspace(await makeSeriesAnalysisOutlookSummary());
    await typeMean(user, "2.60{Enter}");
    view.updateMembers(["member_ponta", "member_eu"]);
    expect(meanField()).toHaveValue("2.85");
    expect(meanField(rivalName)).toHaveValue("2.45");
    expect(
      screen.queryByRole("button", { name: `${focusName}を直近の成績に戻す` }),
    ).not.toBeInTheDocument();
  });

  it("keeps focus on the swap control and member order in the table when the people swap", async () => {
    const user = userEvent.setup();
    const summary = await makeSeriesAnalysisOutlookSummary();
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter>
          <OutlookWorkspaceProvider>
            <SwappableWorkspace summary={summary} />
          </OutlookWorkspaceProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await typeMean(user, "2.60{Enter}");
    const swap = screen.getByRole("button", { name: "注目する人と比較する相手を入れ替える" });
    await user.click(swap);
    expect(swap).toHaveFocus();
    expect(meanField()).toHaveValue("2.85");
    expect(
      screen.getByRole("region", { name: `目標の戦数で${rivalName}が上にいるには` }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "詳しい数値と計算の前提" }));
    const headers = within(screen.getByRole("table")).getAllByRole("columnheader");
    expect(headers.slice(1, 3).map((cell) => cell.textContent)).toEqual([focusName, rivalName]);
  });

  it("moves focus to the goal's answer after trying its required mean", async () => {
    const user = userEvent.setup();
    renderWorkspace(await makeSeriesAnalysisOutlookSummary());
    await user.click(goal().getByRole("button", { name: `${focusName}を 2.48位で試す` }));
    expect(goal().getByText("今の平均 2.48位で先行を保てます")).toHaveFocus();
  });

  it("lists past records strictly below the goal and applies one only while no input is pending", async () => {
    const user = userEvent.setup();
    const examples = await makeSeriesAnalysisOutlookExamples({ memberId: "member_eu" });
    const requested: string[] = [];
    server.use(
      http.get("/api/analytics/series-comparison/v1/outlook-examples", ({ request }) => {
        requested.push(new URL(request.url).searchParams.get("memberId") ?? "");
        return HttpResponse.json(examples);
      }),
    );
    renderWorkspace(await makeSeriesAnalysisOutlookSummary());
    expect(requested).toEqual([]);
    await user.click(goal().getByRole("button", { name: "目標に届く実績" }));
    const tries = await goal().findAllByRole("button", {
      name: /^いーゆーに平均.+位の実績を試す$/u,
    });
    expect(requested).toEqual(["member_eu"]);
    expect(tries.length).toBeGreaterThan(0);
    expect(tries.length).toBeLessThanOrEqual(3);
    for (const button of tries)
      expect(Number(/平均(.+)位/u.exec(button.getAttribute("aria-label") ?? "")?.[1])).toBeLessThan(
        2.4835,
      );

    await typeMean(user, "2.90");
    expect(tries[0]).toBeDisabled();
    expect(tries[0]).toHaveAccessibleDescription("2人の入力を反映するか、取り消すと試せます。");
    await user.click(screen.getByRole("button", { name: `${focusName}の入力を取り消す` }));
    await user.click(tries[0]!);
    expect(meanField()).not.toHaveValue("2.85");
    expect(meanField(rivalName)).toHaveValue("2.45");
    expect(goal().getByRole("textbox", { name: "目標の戦数" })).toHaveValue("100");
    expect(screen.getByText(/の実績例$/u)).toBeVisible();
  });

  it("says that a newer artifact replaced the results until the notice is closed", async () => {
    const user = userEvent.setup();
    const initial = await makeSeriesAnalysisOutlookSummary();
    const view = renderWorkspace(initial);
    await typeMean(user, "2.60{Enter}");
    view.updateSummary(await makeCorrectedOutlookSummary(initial));
    expect(screen.getByText("試している成績を残して実績を更新しました。")).toBeVisible();
    expect(meanField()).toHaveValue("2.60");
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    expect(
      screen.queryByText("試している成績を残して実績を更新しました。"),
    ).not.toBeInTheDocument();
  });
});

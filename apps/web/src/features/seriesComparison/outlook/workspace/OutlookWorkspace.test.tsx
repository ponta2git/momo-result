import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { OutlookWorkspaceProvider } from "@/features/seriesComparison/outlook/OutlookWorkspaceProvider";
import { OutlookWorkspaceView } from "@/features/seriesComparison/outlook/workspace/OutlookWorkspaceView";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { setDevUser } from "@/test/auth";
import { setupMsw } from "@/test/msw/lifecycle";
import {
  makeCorrectedOutlookSummary,
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

const meanField = (name = focusName) =>
  screen.getByRole("textbox", { name: `${name}のこれからの平均順位` });
const trend = () => within(screen.getByRole("region", { name: "この平均が続くと" }));
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
    expect(trend().getByText("11戦後にぽんたが上回ります")).toBeVisible();
    expect(goal().getByText("平均 2.48位以下")).toBeVisible();
  });

  it("commits a mean only with Enter or its button, keeps it on blur, and cancels with Escape", async () => {
    const user = userEvent.setup();
    renderWorkspace(await makeSeriesAnalysisOutlookSummary());
    await typeMean(user, "2.60");
    await user.click(meanField(rivalName));
    expect(meanField()).toHaveValue("2.60");
    expect(trend().getByText("11戦後にぽんたが上回ります")).toBeVisible();
    await user.click(screen.getByRole("button", { name: `${focusName}の平均順位を反映` }));
    expect(trend().getByText("27戦後にぽんたが上回ります")).toBeVisible();

    await typeMean(user, "2.40");
    await user.keyboard("{Escape}");
    expect(meanField()).toHaveValue("2.60");
    await typeMean(user, "2.70{Enter}");
    expect(meanField()).toHaveValue("2.70");
    expect(trend().queryByText("27戦後にぽんたが上回ります")).not.toBeInTheDocument();
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
    expect(trend().getByText("11戦後にぽんたが上回ります")).toBeVisible();
    fireEvent.compositionEnd(input);
    await user.keyboard("{Enter}");
    expect(trend().getByText("27戦後にぽんたが上回ります")).toBeVisible();
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
});

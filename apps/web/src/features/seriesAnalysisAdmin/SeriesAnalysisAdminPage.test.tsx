import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { SeriesAnalysisAdminPage } from "@/features/seriesAnalysisAdmin/SeriesAnalysisAdminPage";
import { createDeferred } from "@/test/deferred";
import { setupMsw } from "@/test/msw/lifecycle";
import { makeSeriesAnalysisAdminOverview } from "@/test/msw/seriesAnalysisFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

function renderPage() {
  const queryClient = createTestQueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/series-analysis?gameTitleId=gt_momotetsu_2"]}>
        <SeriesAnalysisAdminPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

function rejectedCommand() {
  return HttpResponse.json(
    {
      type: "about:blank",
      title: "Unavailable",
      detail: "Do not display provider detail",
      status: 503,
      code: "SERVICE_UNAVAILABLE",
    },
    { status: 503 },
  );
}

describe("SeriesAnalysisAdminPage", () => {
  it("handles a title-command rejection and clears it when another command succeeds", async () => {
    const user = userEvent.setup();
    server.use(http.post("/api/admin/series-analysis/recalculations", rejectedCommand));
    renderPage();

    await user.click(await screen.findByRole("button", { name: "この作品を再計算" }));
    expect(
      await screen.findByText(
        "現在処理を完了できません。少し待ってから、もう一度実行してください。",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Do not display provider detail")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "この作品を再計算" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "全作品を再計算" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "全作品の再計算を予約しますか？",
    });
    await user.click(within(dialog).getByRole("button", { name: "全作品を再計算" }));
    expect(await screen.findByText("1作品の再計算を受け付けました")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.queryByText("操作を完了できませんでした")).not.toBeInTheDocument();
  });

  it("shows an all-title failure in its confirmation dialog and supports an explicit retry", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("/api/admin/series-analysis/recalculations/all", rejectedCommand, { once: true }),
    );
    renderPage();
    await user.click(await screen.findByRole("button", { name: "全作品を再計算" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "全作品の再計算を予約しますか？",
    });
    await user.click(within(dialog).getByRole("button", { name: "全作品を再計算" }));
    expect(
      await within(dialog).findByText(
        "現在処理を完了できません。少し待ってから、もう一度実行してください。",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Do not display provider detail")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "全作品を再計算" }));
    expect(await screen.findByText("1作品の再計算を受け付けました")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("keeps the submitted title explicit while selection changes and prevents overlapping commands", async () => {
    const user = userEvent.setup();
    const commandGate = createDeferred();
    const submitted: unknown[] = [];
    const overview = makeSeriesAnalysisAdminOverview();
    const selectedTitle = overview.selectedTitle;
    if (!selectedTitle) throw new Error("Expected a selected title fixture");
    server.use(
      http.get("/api/admin/series-analysis/overview", ({ request }) => {
        const isNext = new URL(request.url).searchParams.get("gameTitleId") === "title-next";
        return HttpResponse.json({
          ...overview,
          titleOptions: [
            ...overview.titleOptions,
            { gameTitleId: "title-next", gameTitleName: "次の作品", confirmedMatchCount: 0 },
          ],
          selectedTitle: isNext
            ? { ...selectedTitle, gameTitleId: "title-next", gameTitleName: "次の作品" }
            : selectedTitle,
        });
      }),
      http.post("/api/admin/series-analysis/recalculations", async ({ request }) => {
        submitted.push(await request.json());
        await commandGate.promise;
        return HttpResponse.json(
          {
            acceptedAt: "2026-08-09T02:00:00.000Z",
            campaign: null,
            requestId: "request-title",
            schemaVersion: 1,
            target: {
              gameTitleId: "gt_momotetsu_2",
              jobId: "job-2",
              requestDisposition: "created_job",
            },
            targetCount: 1,
          },
          { status: 202 },
        );
      }),
    );
    renderPage();
    await user.click(await screen.findByRole("button", { name: "この作品を再計算" }));
    await waitFor(() => expect(submitted).toEqual([{ gameTitleId: "gt_momotetsu_2" }]));
    expect(screen.getByRole("button", { name: "桃太郎電鉄2を受け付け中" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "全作品を再計算" })).toBeDisabled();

    await user.click(screen.getByRole("combobox", { name: "対象作品" }));
    await user.click(screen.getByRole("option", { name: "次の作品 (0戦)" }));
    expect(await screen.findByRole("heading", { name: "次の作品" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "桃太郎電鉄2を受け付け中" })).toBeDisabled();
    commandGate.resolve();

    expect(await screen.findByText("桃太郎電鉄2の再計算を受け付けました")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "この作品を再計算" })).toBeEnabled(),
    );
    expect(screen.getByRole("heading", { name: "次の作品" })).toBeInTheDocument();
    expect(submitted).toHaveLength(1);
  });

  it("announces initial loading and preserves successful content through a failed refresh and retry", async () => {
    const user = userEvent.setup();
    const initialGate = createDeferred();
    let requests = 0;
    server.use(
      http.get("/api/admin/series-analysis/overview", async () => {
        requests += 1;
        if (requests === 1) await initialGate.promise;
        return requests === 2
          ? rejectedCommand()
          : HttpResponse.json(makeSeriesAnalysisAdminOverview());
      }),
    );
    renderPage();
    expect(screen.getByRole("status", { name: "戦績分析管理を読み込み中" })).toHaveTextContent(
      "読み込み中",
    );
    initialGate.resolve();
    await user.click(await screen.findByRole("button", { name: "状態を更新" }));
    const retry = await screen.findByRole("button", { name: "状態を再読み込み" });
    expect(screen.getByRole("table", { name: "全作品の直近10件の実行履歴" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "この作品を再計算" })).toBeEnabled();
    await user.click(retry);
    expect(await screen.findByRole("button", { name: "状態を更新" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "状態を再読み込み" })).not.toBeInTheDocument();
    expect(requests).toBe(3);
  });
});

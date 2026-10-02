import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { SeriesAnalysisAdminPage } from "@/features/seriesAnalysisAdmin/SeriesAnalysisAdminPage";
import { ToastHost } from "@/shared/ui/feedback/ToastHost";
import { AppMotionProvider } from "@/shared/ui/motion/AppMotionProvider";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { setupMsw } from "@/test/msw/lifecycle";
import {
  makePlayerRadarOperation,
  makePlayerRadarPreview,
  makeReadyPlayerRadarState,
} from "@/test/msw/playerRadarFixtures";
import { makeSeriesAnalysisAdminOverview } from "@/test/msw/seriesAnalysisFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";
import { selectOption } from "@/test/selectOption";

setupMsw();

function renderPage() {
  const queryClient = createTestQueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/series-analysis?gameTitleId=gt_momotetsu_2"]}>
        <AppMotionProvider>
          <SeriesAnalysisAdminPage />
          <ToastHost />
        </AppMotionProvider>
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
  it("opens the recalculation tab on accepted application and announces acceptance once before refresh completes", async () => {
    const user = userEvent.setup();
    setDevUser();
    const refreshGate = createDeferred();
    let accepted = false;
    const overview = makeSeriesAnalysisAdminOverview();
    const newestJob = {
      ...overview.recentJobs[0]!,
      jobId: "radar-application-job",
      status: "running" as const,
      finishedAt: null,
      elapsedMilliseconds: null,
      resultDisposition: "none" as const,
    };
    server.use(
      http.get("/api/admin/series-analysis/overview", async () => {
        if (accepted) await refreshGate.promise;
        return HttpResponse.json(
          accepted
            ? {
                ...overview,
                globalExecution: { ...overview.globalExecution, runningCount: 1 },
                recentJobs: [newestJob],
              }
            : overview,
        );
      }),
      http.get("/api/admin/series-analysis/radar", () =>
        HttpResponse.json(makeReadyPlayerRadarState()),
      ),
      http.get("/api/admin/series-analysis/radar/preview", () =>
        HttpResponse.json(makePlayerRadarPreview()),
      ),
      http.post("/api/admin/series-analysis/radar/operations", () => {
        accepted = true;
        return HttpResponse.json(makePlayerRadarOperation(), { status: 202 });
      }),
    );
    renderPage();
    await user.click(await screen.findByRole("tab", { name: "レーダーの採点基準" }));
    await user.click(await screen.findByRole("button", { name: "この変更案を適用する" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "作品全体に適用する" }),
    );
    const recalculationTab = screen.getByRole("tab", { name: "分析の再計算" });
    await waitFor(() => expect(recalculationTab).toHaveAttribute("aria-selected", "true"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await waitFor(() => expect(recalculationTab).toHaveFocus());
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "採点基準の適用を受け付けました" })).toBeVisible(),
    );
    expect(screen.getByRole("button", { name: "状態を更新中" })).toBeDisabled();
    expect(screen.queryByText("基準の適用が完了しました")).not.toBeInTheDocument();
    refreshGate.resolve();
    const jobs = screen.getByRole("table", { name: "全作品の直近10件の実行履歴" });
    expect(await within(jobs).findByText("計算中")).toBeVisible();
    await user.click(await screen.findByRole("button", { name: "状態を更新" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "状態を更新" })).toBeEnabled());
    expect(screen.getAllByRole("dialog", { name: "採点基準の適用を受け付けました" })).toHaveLength(
      1,
    );
  });

  it("keeps an uncertain application on the radar tab until the same request is confirmed", async () => {
    const user = userEvent.setup();
    setDevUser();
    const keys: Array<string | null> = [];
    server.use(
      http.get("/api/admin/series-analysis/radar", () =>
        HttpResponse.json(makeReadyPlayerRadarState()),
      ),
      http.get("/api/admin/series-analysis/radar/preview", () =>
        HttpResponse.json(makePlayerRadarPreview()),
      ),
      http.post("/api/admin/series-analysis/radar/operations", ({ request }) => {
        keys.push(request.headers.get("Idempotency-Key"));
        return keys.length === 1
          ? HttpResponse.error()
          : HttpResponse.json(
              { ...makePlayerRadarOperation(), operationId: "recovered-application" },
              { status: 202 },
            );
      }),
    );
    renderPage();
    const radarTab = await screen.findByRole("tab", { name: "レーダーの採点基準" });
    await user.click(radarTab);
    await user.click(await screen.findByRole("button", { name: "この変更案を適用する" }));
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "作品全体に適用する" }));
    expect(await within(dialog).findByText(/操作の受付結果はまだ不明/u)).toBeVisible();
    expect(radarTab).toHaveAttribute("aria-selected", "true");
    expect(
      screen.queryByRole("dialog", { name: "採点基準の適用を受け付けました" }),
    ).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "キャンセル" }));
    await user.click(await screen.findByRole("button", { name: "操作の状態を確認する" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "採点基準の適用を受け付けました" })).toBeVisible(),
    );
    expect(screen.getByRole("tab", { name: "分析の再計算" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "分析の再計算" })).toHaveFocus();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  it("separates radar administration and retains its comparison scope when switching tabs", async () => {
    const user = userEvent.setup();
    setDevUser();
    server.use(
      http.get("/api/admin/series-analysis/radar", () =>
        HttpResponse.json(makeReadyPlayerRadarState()),
      ),
      http.get("/api/admin/series-analysis/radar/preview", ({ request }) => {
        const preview = makePlayerRadarPreview();
        return HttpResponse.json(
          new URL(request.url).searchParams.has("mapMasterId")
            ? {
                ...preview,
                scope: {
                  ...preview.scope,
                  kind: "map",
                  key: "map:map_east",
                  mapMasterId: "map_east",
                  state: "empty",
                },
                before: null,
                after: null,
              }
            : preview,
        );
      }),
    );
    renderPage();
    expect(await screen.findByRole("button", { name: "この作品を再計算" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "この変更案を適用する" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "レーダーの採点基準" }));
    await screen.findByRole("table", { name: "採点基準変更前後の比較" });
    expect(screen.queryByRole("button", { name: "この作品を再計算" })).not.toBeInTheDocument();

    await selectOption(user, screen.getByRole("combobox", { name: "比較するマップ" }), "map_east");
    expect(await screen.findByText("この条件に対象試合はありません")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "分析の再計算" }));
    expect(screen.getByRole("button", { name: "この作品を再計算" })).toBeEnabled();
    await user.click(screen.getByRole("tab", { name: "レーダーの採点基準" }));
    expect(screen.getByRole("combobox", { name: "比較するマップ" })).toHaveTextContent("東日本編");
    expect(screen.getByText("この条件に対象試合はありません")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "対象作品" })).toHaveTextContent("桃太郎電鉄2");
  });

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

  it.each([
    ["created_job", "桃太郎電鉄2の再計算を受け付けました"],
    ["forced_run_reserved", "桃太郎電鉄2は現在の計算後に再計算します"],
  ] as const)(
    "keeps the submitted title explicit for %s while selection changes and prevents overlapping commands",
    async (requestDisposition, acceptanceTitle) => {
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
                jobId: requestDisposition === "created_job" ? "job-2" : null,
                requestDisposition,
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

      await selectOption(user, screen.getByRole("combobox", { name: "対象作品" }), "title-next");
      expect(await screen.findByRole("heading", { name: "次の作品" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "桃太郎電鉄2を受け付け中" })).toBeDisabled();
      commandGate.resolve();

      expect(await screen.findByRole("heading", { name: acceptanceTitle })).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "この作品を再計算" })).toBeEnabled(),
      );
      expect(screen.getByRole("heading", { name: "次の作品" })).toBeInTheDocument();
      expect(submitted).toHaveLength(1);
    },
  );

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

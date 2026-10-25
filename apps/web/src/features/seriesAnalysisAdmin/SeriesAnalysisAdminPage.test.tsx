import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeAll, describe, expect, it } from "vitest";

import { OperationsRoute } from "@/app/routeGuards";
import { SeriesAnalysisAdminPage } from "@/features/seriesAnalysisAdmin/SeriesAnalysisAdminPage";
import { seriesPlayerRadarKeys } from "@/shared/api/queryKeys";
import { decodeSeriesAnalysisAdminOverview } from "@/shared/api/seriesAnalysisEnvelopeSchemas";
import { getAuthorization } from "@/shared/auth/authorizationQueryAdapter";
import { ToastHost } from "@/shared/ui/feedback/ToastHost";
import { AppMotionProvider } from "@/shared/ui/motion/AppMotionProvider";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { mswState } from "@/test/msw/fixtures";
import { setupMsw } from "@/test/msw/lifecycle";
import {
  makePlayerRadarOperation,
  makePlayerRadarPreview,
  makeReadyPlayerRadarState,
} from "@/test/msw/playerRadarFixtures";
import {
  makeSeriesAnalysisAdminOverview,
  makeSeriesAnalysisScopeStatus,
} from "@/test/msw/seriesAnalysisFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";
import { selectOption } from "@/test/selectOption";

setupMsw();
// The timed assertions exercise operation lifecycle after the real wire validators load.
beforeAll(() =>
  Promise.all([
    import("@/shared/api/generatedContracts/series-analysis-radar-validators.generated"),
    decodeSeriesAnalysisAdminOverview(makeSeriesAnalysisAdminOverview()),
  ]),
);

const pointCurve: NonNullable<
  ReturnType<typeof makePlayerRadarPreview>["afterAchievements"]
>["achievementCurve"] = {
  pointThresholds: [5, 10, 20, 30, 50, 75, 100, 150, 200],
};

function makePointReadyState() {
  const state = makeReadyPlayerRadarState();
  state.candidate!.achievementCurve = pointCurve;
  state.candidate!.result!.basis!.achievementCurve = pointCurve;
  return state;
}

function makePointPreview() {
  const preview = makePlayerRadarPreview();
  preview.afterAchievements!.achievementCurve = pointCurve;
  preview.afterAchievements!.summary.players.forEach((player, index) => {
    player.score = [6, 4, 3, 1][index]!;
  });
  return preview;
}

function renderPage(guarded = false) {
  setDevUser();
  const queryClient = createTestQueryClient();
  const router = createMemoryRouter(
    [
      {
        path: "/admin/series-analysis",
        element: (
          <AppMotionProvider>
            {guarded ? (
              <OperationsRoute>
                <SeriesAnalysisAdminPage />
              </OperationsRoute>
            ) : (
              <SeriesAnalysisAdminPage />
            )}
            <ToastHost />
          </AppMotionProvider>
        ),
      },
    ],
    { initialEntries: ["/admin/series-analysis?gameTitleId=gt_momotetsu_2"] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
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
  it("lets an unlinked operator recalculate the selected title without offering all-title commands", async () => {
    const user = userEvent.setup();
    const account = mswState.loginAccounts.find((entry) => entry.accountId === "account_ponta")!;
    account.role = "operator";
    delete account.playerMemberId;
    const submitted: unknown[] = [];
    server.use(
      http.post("/api/admin/series-analysis/recalculations", async ({ request }) => {
        submitted.push(await request.json());
        expect(request.headers.get("X-Momo-Account-Id")).toBe("account_ponta");
        expect(request.headers.get("Idempotency-Key")).toBeTruthy();
        return HttpResponse.json(
          {
            acceptedAt: "2026-08-09T02:00:00.000Z",
            campaign: null,
            requestId: "operator-recalculation",
            schemaVersion: 1,
            target: {
              gameTitleId: "gt_momotetsu_2",
              jobId: "operator-job",
              requestDisposition: "created_job",
            },
            targetCount: 1,
          },
          { status: 202 },
        );
      }),
    );
    renderPage(true);
    const recalculate = await screen.findByRole("button", { name: "この作品を再計算" });
    expect(recalculate).toBeEnabled();
    expect(screen.queryByRole("button", { name: "全作品を再計算" })).not.toBeInTheDocument();
    await user.click(recalculate);
    expect(await screen.findByText("桃太郎電鉄2の再計算を受け付けました")).toBeVisible();
    expect(submitted).toEqual([{ gameTitleId: "gt_momotetsu_2" }]);
  });

  // This scenario crosses both tabs and authorization changes; allow for CI coverage overhead.
  it("closes the all-title confirmation on demotion while keeping the operator's radar scope", async () => {
    const user = userEvent.setup();
    const account = mswState.loginAccounts.find((entry) => entry.accountId === "account_ponta")!;
    server.use(
      http.get("/api/admin/series-analysis/radar", () => HttpResponse.json(makePointReadyState())),
      http.get("/api/admin/series-analysis/radar/preview", () =>
        HttpResponse.json(makePointPreview()),
      ),
    );
    const client = renderPage(true);
    await screen.findByRole("button", { name: "この作品を再計算" });
    await user.click(screen.getByRole("tab", { name: "レーダーの採点基準" }));
    await user.click(await screen.findByRole("button", { name: "変更案を編集" }));
    await screen.findByRole("table", { name: "採点基準変更前後の比較" });
    await selectOption(user, screen.getByRole("combobox", { name: "比較するマップ" }), "map_east");
    await user.click(screen.getByRole("tab", { name: "分析の再計算" }));
    await user.click(
      within(
        await screen.findByRole("alertdialog", { name: "未保存の変更を破棄しますか？" }),
      ).getByRole("button", { name: "破棄して移動" }),
    );
    await user.click(await screen.findByRole("button", { name: "全作品を再計算" }));
    expect(screen.getByRole("alertdialog")).toBeVisible();

    account.role = "operator";
    await act(() => getAuthorization(client, "account_ponta").recheck());
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "全作品を再計算" })).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "この作品を再計算" })).toBeEnabled();
    await user.click(screen.getByRole("tab", { name: "レーダーの採点基準" }));
    await user.click(await screen.findByRole("button", { name: "変更案を編集" }));
    expect(screen.getByRole("combobox", { name: "比較するマップ" })).toHaveTextContent("東日本編");

    account.role = "admin";
    await act(() => getAuthorization(client, "account_ponta").recheck());
    await user.click(screen.getByRole("tab", { name: "分析の再計算" }));
    await user.click(
      within(
        await screen.findByRole("alertdialog", { name: "未保存の変更を破棄しますか？" }),
      ).getByRole("button", { name: "破棄して移動" }),
    );
    expect(await screen.findByRole("button", { name: "全作品を再計算" })).toBeEnabled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  }, 10_000);

  it("allows an operator command while an obsolete all-title command settles without clearing the new pending state", async () => {
    const user = userEvent.setup();
    const account = mswState.loginAccounts.find((entry) => entry.accountId === "account_ponta")!;
    const oldCommandGate = createDeferred();
    const titleCommandGate = createDeferred();
    const submitted: unknown[] = [];
    let allRequests = 0;
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
      http.post("/api/admin/series-analysis/recalculations/all", async () => {
        allRequests += 1;
        await oldCommandGate.promise;
        return HttpResponse.json(
          {
            acceptedAt: "2026-08-09T02:00:00.000Z",
            campaign: { campaignId: "old-campaign", status: "expanding" },
            requestId: "obsolete-admin-command",
            schemaVersion: 1,
            target: null,
            targetCount: 2,
          },
          { status: 202 },
        );
      }),
      http.post("/api/admin/series-analysis/recalculations", async ({ request }) => {
        submitted.push(await request.json());
        await titleCommandGate.promise;
        return HttpResponse.json(
          {
            acceptedAt: "2026-08-09T02:00:00.000Z",
            campaign: null,
            requestId: "current-operator-command",
            schemaVersion: 1,
            target: {
              gameTitleId: "gt_momotetsu_2",
              jobId: "operator-job",
              requestDisposition: "created_job",
            },
            targetCount: 1,
          },
          { status: 202 },
        );
      }),
    );
    const client = renderPage(true);
    await user.click(await screen.findByRole("button", { name: "全作品を再計算" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "全作品を再計算" }),
    );
    await waitFor(() => expect(allRequests).toBe(1));

    account.role = "operator";
    await act(() => getAuthorization(client, "account_ponta").recheck());
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    const recalculate = screen.getByRole("button", { name: "この作品を再計算" });
    expect(recalculate).toBeEnabled();
    expect(screen.getByRole("button", { name: "状態を更新" })).toBeEnabled();
    await user.click(recalculate);
    await waitFor(() => expect(submitted).toEqual([{ gameTitleId: "gt_momotetsu_2" }]));

    await act(async () => oldCommandGate.resolve());
    await waitFor(() =>
      expect(
        client
          .getMutationCache()
          .getAll()
          .some(
            (mutation) =>
              (mutation.state.data as { requestId?: string } | undefined)?.requestId ===
              "obsolete-admin-command",
          ),
      ).toBe(true),
    );
    await selectOption(user, screen.getByRole("combobox", { name: "対象作品" }), "title-next");
    expect(await screen.findByRole("heading", { name: "次の作品" })).toBeInTheDocument();
    const pending = screen.getByRole("button", { name: "桃太郎電鉄2を受け付け中" });
    expect(pending).toBeDisabled();
    expect(screen.getByRole("button", { name: "状態を更新" })).toBeDisabled();
    await user.click(pending);
    expect(submitted).toHaveLength(1);

    titleCommandGate.resolve();
    expect(await screen.findByText("桃太郎電鉄2の再計算を受け付けました")).toBeVisible();
    expect(screen.queryByText("2作品の再計算を受け付けました")).not.toBeInTheDocument();
    expect(allRequests).toBe(1);
    expect(submitted).toHaveLength(1);
  });

  it("retains a late radar acceptance during auth rechecking and resumes without another POST", async () => {
    const user = userEvent.setup();
    const commandGate = createDeferred();
    const authGate = createDeferred();
    const authStarted = createDeferred();
    const submitted: unknown[] = [];
    const operation = { ...makePlayerRadarOperation(), operationId: "accepted-while-checking" };
    server.use(
      http.get("/api/admin/series-analysis/radar", () => HttpResponse.json(makePointReadyState())),
      http.get("/api/admin/series-analysis/radar/preview", () =>
        HttpResponse.json(makePointPreview()),
      ),
      http.post("/api/admin/series-analysis/radar/operations", async ({ request }) => {
        submitted.push(await request.json());
        await commandGate.promise;
        return HttpResponse.json(operation, { status: 202 });
      }),
    );
    const client = renderPage(true);
    await user.click(await screen.findByRole("tab", { name: "レーダーの採点基準" }));
    await user.click(await screen.findByRole("button", { name: "変更案を編集" }));
    const apply = screen.getByRole("button", { name: "変更を適用" });
    await waitFor(() => expect(apply).toBeEnabled());
    await user.click(apply);
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "作品全体に適用する" }),
    );
    await waitFor(() => expect(submitted).toHaveLength(1));
    server.use(
      http.get("/api/auth/me", async () => {
        authStarted.resolve();
        await authGate.promise;
        return HttpResponse.json({
          accountId: "account_ponta",
          displayName: "ぽんた",
          role: "admin",
        });
      }),
    );
    let recheck: Promise<void> | undefined;
    await act(async () => {
      recheck = getAuthorization(client, "account_ponta").recheck();
      await authStarted.promise;
    });
    expect(screen.queryByRole("table", { name: "採点基準変更前後の比較" })).not.toBeInTheDocument();
    await act(async () => commandGate.resolve());
    await waitFor(() =>
      expect(
        client
          .getMutationCache()
          .getAll()
          .some(
            (mutation) =>
              (mutation.state.data as { operationId?: string } | undefined)?.operationId ===
              operation.operationId,
          ),
      ).toBe(true),
    );
    expect(
      client.getQueryData(seriesPlayerRadarKeys.operation("gt_momotetsu_2", operation.operationId)),
    ).toBeUndefined();
    expect(submitted).toHaveLength(1);

    await act(async () => {
      authGate.resolve();
      await recheck;
    });
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "採点基準の適用を受け付けました" })).toBeVisible(),
    );
    expect(screen.getByRole("tab", { name: "分析の再計算" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(
      client.getQueryData(seriesPlayerRadarKeys.operation("gt_momotetsu_2", operation.operationId)),
    ).toEqual(operation);
    expect(submitted).toHaveLength(1);
  });

  it("waits for the default title route to commit before accepting a manual refresh", async () => {
    setDevUser();
    const user = userEvent.setup();
    const routeStarted = createDeferred();
    const routeGate = createDeferred();
    const requestedTitles: Array<string | null> = [];
    server.use(
      http.get("/api/admin/series-analysis/overview", ({ request }) => {
        requestedTitles.push(new URL(request.url).searchParams.get("gameTitleId"));
        const overview = makeSeriesAnalysisAdminOverview();
        for (const job of overview.recentJobs) {
          job.gameTitleName =
            requestedTitles.length === 1 ? "初回の処理履歴" : "更新済みの処理履歴";
        }
        return HttpResponse.json(overview);
      }),
    );
    const router = createMemoryRouter(
      [
        {
          path: "/admin/analysis",
          loader: async ({ request }) => {
            if (new URL(request.url).searchParams.has("gameTitleId")) {
              routeStarted.resolve();
              await routeGate.promise;
            }
            return null;
          },
          hydrateFallbackElement: <p>読み込み中</p>,
          element: <SeriesAnalysisAdminPage />,
        },
      ],
      { initialEntries: ["/admin/analysis"] },
    );
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("初回の処理履歴")).toBeVisible();
    await routeStarted.promise;
    const refresh = screen.getByRole("button", { name: "状態を更新" });
    expect(refresh).toBeDisabled();
    await user.click(refresh);
    expect(requestedTitles).toEqual([null]);

    await act(async () => routeGate.resolve());
    await waitFor(() => expect(screen.getByRole("button", { name: "状態を更新" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "状態を更新" }));
    expect(await screen.findByText("更新済みの処理履歴")).toBeVisible();
    expect(requestedTitles).toEqual([null, "gt_momotetsu_2"]);
  });

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
      http.get("/api/admin/series-analysis/radar", () => HttpResponse.json(makePointReadyState())),
      http.get("/api/admin/series-analysis/radar/preview", () =>
        HttpResponse.json(makePointPreview()),
      ),
      http.post("/api/admin/series-analysis/radar/operations", () => {
        accepted = true;
        return HttpResponse.json(makePlayerRadarOperation(), { status: 202 });
      }),
    );
    renderPage();
    await user.click(await screen.findByRole("tab", { name: "レーダーの採点基準" }));
    await user.click(await screen.findByRole("button", { name: "変更案を編集" }));
    const applyButton = screen.getByRole("button", { name: "変更を適用" });
    await waitFor(() => expect(applyButton).toBeEnabled());
    await user.click(applyButton);
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

  it("blocks back navigation during apply and moves to recalculation only after acceptance", async () => {
    const user = userEvent.setup();
    setDevUser();
    const applyGate = createDeferred();
    const submitted: Array<{ kind: string }> = [];
    server.use(
      http.get("/api/admin/series-analysis/radar", () => HttpResponse.json(makePointReadyState())),
      http.get("/api/admin/series-analysis/radar/preview", () =>
        HttpResponse.json(makePointPreview()),
      ),
      http.post("/api/admin/series-analysis/radar/operations", async ({ request }) => {
        submitted.push((await request.json()) as { kind: string });
        await applyGate.promise;
        return HttpResponse.json(makePlayerRadarOperation(), { status: 202 });
      }),
    );
    const client = createTestQueryClient();
    const router = createMemoryRouter(
      [
        { path: "/previous", element: <p>移動前のページ</p> },
        {
          path: "/admin/series-analysis",
          element: (
            <AppMotionProvider>
              <SeriesAnalysisAdminPage />
              <ToastHost />
            </AppMotionProvider>
          ),
        },
      ],
      {
        initialEntries: [
          "/previous",
          "/admin/series-analysis?gameTitleId=gt_momotetsu_2&tab=radar",
        ],
      },
    );
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await user.click(await screen.findByRole("button", { name: "変更案を編集" }));
    await user.click(screen.getByRole("button", { name: "変更を適用" }));
    const confirm = within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "作品全体に適用する",
    });
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);
    await waitFor(() => expect(submitted.map(({ kind }) => kind)).toEqual(["apply"]));

    await act(async () => router.navigate(-1));
    expect(await screen.findByRole("dialog", { name: "処理結果を確認しています" })).toBeVisible();
    expect(router.state.location.pathname).toBe("/admin/series-analysis");
    expect(new URLSearchParams(router.state.location.search).get("tab")).toBe("radar");
    expect(screen.queryByRole("button", { name: "破棄して移動" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "平均順位 2点の境界（位以下）", hidden: true }),
    ).toBeInTheDocument();
    expect(submitted.map(({ kind }) => kind)).toEqual(["apply"]);

    await act(async () => applyGate.resolve());
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "分析の再計算" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(router.state.location.pathname).toBe("/admin/series-analysis");
    expect(screen.queryByText("移動前のページ")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "平均順位 2点の境界（位以下）", hidden: true }),
    ).not.toBeInTheDocument();
    expect(submitted.map(({ kind }) => kind)).toEqual(["apply"]);
  });

  it("keeps an uncertain application on the radar tab until the same request is confirmed", async () => {
    const user = userEvent.setup();
    setDevUser();
    const keys: Array<string | null> = [];
    server.use(
      http.get("/api/admin/series-analysis/radar", () => HttpResponse.json(makePointReadyState())),
      http.get("/api/admin/series-analysis/radar/preview", () =>
        HttpResponse.json(makePointPreview()),
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
    await user.click(await screen.findByRole("button", { name: "変更案を編集" }));
    const applyButton = screen.getByRole("button", { name: "変更を適用" });
    await waitFor(() => expect(applyButton).toBeEnabled());
    await user.click(applyButton);
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
    const recalculationTab = screen.getByRole("tab", { name: "分析の再計算" });
    await waitFor(() => expect(recalculationTab).toHaveAttribute("aria-selected", "true"));
    await waitFor(() => expect(recalculationTab).toHaveFocus());
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  it("closes the accepted manual editor and refreshes the applied basis before returning from recalculation", async () => {
    const user = userEvent.setup();
    const state = makePointReadyState();
    const current = state.currentBasis;
    const candidate = state.candidate;
    if (!current || !candidate?.result?.basis) throw new Error("Expected complete radar fixtures");
    type ManualBasis = Extract<typeof candidate.result.basis, { manual: unknown }>;
    const basis: ManualBasis = {
      ...candidate.result.basis,
      manual: {
        sourceBasisId: current.basisId,
        sourceCandidateId: null,
        monitoringSource: current.basis.source,
      },
      axes: candidate.result.basis.axes.map((axis) => {
        const thresholds = structuredClone(axis.thresholds);
        if (axis.axisId === "averageRank") thresholds[0] = 5.25;
        return { ...axis, q10: null, median: null, q90: null, thresholds };
      }) as ManualBasis["axes"],
    };
    candidate.originKind = "manual";
    candidate.manualInput = {
      achievementCurve: pointCurve,
      axes: basis.axes.map(({ axisId, thresholds }) => ({ axisId, thresholds })),
    };
    candidate.sourceBasisId = current.basisId;
    candidate.sourceBasis = current;
    for (const axis of candidate.result.axes) {
      const entered = basis.axes.find((entry) => entry.axisId === axis.axisId);
      if (!entered) throw new Error("Missing manual axis fixture");
      Object.assign(axis, entered, { unavailableReasons: [] });
    }
    candidate.result = {
      ...candidate.result,
      basis,
      windowCount: 0,
      valuesPerAxis: 0,
    };
    const preview = makePointPreview();
    // Raising the first rank boundary from 4.9 to 5.25 changes no fixture scores:
    // every real average rank is already below both boundaries. All 54 values remain present.
    const operation = makePlayerRadarOperation();
    const overview = makeSeriesAnalysisAdminOverview();
    const job = overview.recentJobs[0];
    if (!job) throw new Error("Expected an analysis job fixture");
    let accepted = false;
    let completed = false;
    let radarReads = 0;
    const submitted: unknown[] = [];
    server.use(
      http.get("/api/admin/series-analysis/overview", () =>
        HttpResponse.json({
          ...overview,
          recentJobs:
            accepted && !completed
              ? [
                  {
                    ...job,
                    status: "running",
                    finishedAt: null,
                    elapsedMilliseconds: null,
                    resultDisposition: "none",
                  },
                ]
              : overview.recentJobs,
        }),
      ),
      http.get("/api/admin/series-analysis/radar", () => {
        radarReads += 1;
        return HttpResponse.json(
          completed
            ? {
                ...state,
                currentBasis: {
                  ...current,
                  basisId: candidate.basisId,
                  basis,
                  appliedAt: "2026-10-12T00:02:00Z",
                },
                previousBasis: current,
                candidate: { ...candidate, status: "applied" },
                operations: [
                  { ...operation, status: "succeeded", finishedAt: "2026-10-12T00:02:00Z" },
                ],
              }
            : { ...state, operations: accepted ? [operation] : [] },
        );
      }),
      http.get("/api/admin/series-analysis/radar/preview", () => HttpResponse.json(preview)),
      http.post("/api/admin/series-analysis/radar/operations", async ({ request }) => {
        submitted.push(await request.json());
        accepted = true;
        return HttpResponse.json(operation, { status: 202 });
      }),
    );
    setDevUser();
    const client = createTestQueryClient();
    const router = createMemoryRouter(
      [
        {
          path: "/admin/series-analysis",
          element: (
            <AppMotionProvider>
              <SeriesAnalysisAdminPage />
              <ToastHost />
            </AppMotionProvider>
          ),
        },
      ],
      { initialEntries: ["/admin/series-analysis?gameTitleId=gt_momotetsu_2"] },
    );
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await user.click(await screen.findByRole("tab", { name: "レーダーの採点基準" }));
    await user.click(await screen.findByRole("button", { name: "変更案を編集" }));
    expect(screen.getByRole("textbox", { name: "平均順位 2点の境界（位以下）" })).toHaveValue(
      "5.25",
    );
    await user.click(screen.getByRole("button", { name: "変更を適用" }));
    const confirm = within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "作品全体に適用する",
    });
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "分析の再計算" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(submitted).toEqual([
      {
        gameTitleId: state.gameTitleId,
        kind: "apply",
        candidateId: candidate.candidateId,
        previewId: preview.previewId,
        expectedCurrentBasisId: current.basisId,
      },
    ]);
    const jobs = screen.getByRole("table", { name: "全作品の直近10件の実行履歴" });
    expect(await within(jobs).findByText("計算中")).toBeVisible();
    expect(screen.queryByText("基準の適用が完了しました")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "状態を更新" })).toBeEnabled());

    completed = true;
    const readsBeforeRefresh = radarReads;
    await user.click(screen.getByRole("button", { name: "状態を更新" }));
    await waitFor(() =>
      expect(
        client.getQueryData<ReturnType<typeof makeReadyPlayerRadarState>>(
          seriesPlayerRadarKeys.state(state.gameTitleId),
        )?.currentBasis?.basisId,
      ).toBe(candidate.basisId),
    );
    expect(radarReads).toBeGreaterThan(readsBeforeRefresh);
    await waitFor(() => expect(screen.getByRole("button", { name: "状態を更新" })).toBeEnabled());
    const readsBeforeReturn = radarReads;
    await user.click(screen.getByRole("tab", { name: "レーダーの採点基準" }));
    await waitFor(() => expect(radarReads).toBeGreaterThan(readsBeforeReturn));
    const criteria = await screen.findByRole("table", { name: "適用中の採点境界" });
    expect(within(criteria).getByText("5.25位以下")).toBeVisible();
    expect(within(criteria).queryByText("4.9位以下")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "平均順位 2点の境界（位以下）" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "変更案を編集" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "採点境界の変更案" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "分析の再計算" }));
    const readsBeforeHistoryReturn = radarReads;
    await act(async () => {
      await router.navigate(-1);
    });
    await waitFor(() => expect(radarReads).toBeGreaterThan(readsBeforeHistoryReturn));
    expect(
      within(await screen.findByRole("table", { name: "適用中の採点境界" })).getByText(
        "5.25位以下",
      ),
    ).toBeVisible();
  });

  it("separates radar administration and retains its comparison scope when switching tabs", async () => {
    const user = userEvent.setup();
    setDevUser();
    server.use(
      http.get("/api/analytics/series-comparison/v2/scope-status", ({ request }) => {
        const params = new URL(request.url).searchParams;
        const mapMasterId = params.get("mapMasterId");
        return HttpResponse.json(
          makeSeriesAnalysisScopeStatus({
            artifactId: params.get("artifactId"),
            mapMasterId,
            mapName: mapMasterId ? "東日本編" : null,
            state: mapMasterId ? "empty" : "available",
            currentHasMatches: !mapMasterId,
            publishedHasMatches: !mapMasterId,
          }),
        );
      }),
      http.get("/api/admin/series-analysis/radar", () => HttpResponse.json(makePointReadyState())),
      http.get("/api/admin/series-analysis/radar/preview", ({ request }) => {
        const preview = makePointPreview();
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
    await user.click(await screen.findByRole("button", { name: "変更案を編集" }));
    await screen.findByRole("table", { name: "採点基準変更前後の比較" });
    expect(screen.queryByRole("button", { name: "この作品を再計算" })).not.toBeInTheDocument();

    await selectOption(user, screen.getByRole("combobox", { name: "比較するマップ" }), "map_east");
    expect(await screen.findByText(/この比較条件に対象試合はありません/u)).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "分析の再計算" }));
    await user.click(
      within(
        await screen.findByRole("alertdialog", { name: "未保存の変更を破棄しますか？" }),
      ).getByRole("button", { name: "破棄して移動" }),
    );
    expect(await screen.findByRole("button", { name: "この作品を再計算" })).toBeEnabled();
    await user.click(screen.getByRole("tab", { name: "レーダーの採点基準" }));
    await user.click(await screen.findByRole("button", { name: "変更案を編集" }));
    expect(screen.getByRole("combobox", { name: "比較するマップ" })).toHaveTextContent("東日本編");
    expect(screen.getByText(/この比較条件に対象試合はありません/u)).toBeVisible();
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
    expect(await screen.findByRole("button", { name: "この作品を再計算" })).toBeEnabled();

    await user.click(await screen.findByRole("button", { name: "全作品を再計算" }));
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
    expect(await screen.findByRole("button", { name: "この作品を再計算" })).toBeEnabled();
    await user.click(retry);
    expect(await screen.findByRole("button", { name: "状態を更新" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "状態を再読み込み" })).not.toBeInTheDocument();
    expect(requests).toBe(3);
  });
});

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { SeriesComparisonPage } from "@/features/seriesComparison/page/SeriesComparisonPage";
import type { ProblemDetails } from "@/shared/api/problemDetails";
import { setupMsw } from "@/test/msw/lifecycle";
import {
  analysisArtifact,
  makeSeriesAnalysisAggregate,
  makeSeriesAnalysisOptions,
  makeSeriesAnalysisReview,
  makeSeriesAnalysisStatus,
} from "@/test/msw/seriesAnalysisFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";
import { selectOption } from "@/test/selectOption";

setupMsw();

function renderPage(path = "/analytics/series") {
  const queryClient = createTestQueryClient();
  const router = createMemoryRouter(
    [{ path: "/analytics/series", element: <SeriesComparisonPage /> }],
    {
      initialEntries: [path],
    },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { queryClient, router };
}

describe("SeriesComparisonPage resource lifecycle", () => {
  it("keeps the prior same-scope review usable after a replacement publication fails", async () => {
    const user = userEvent.setup();
    const replacement = {
      ...analysisArtifact,
      artifactId: "replacement-unavailable",
      inputRevision: "13",
    };
    let nextPublication = false;
    server.use(
      http.get("/api/analytics/series-comparison/v2/status", () =>
        HttpResponse.json(
          makeSeriesAnalysisStatus({
            currentArtifact: nextPublication ? replacement : analysisArtifact,
          }),
        ),
      ),
      http.get("/api/analytics/series-comparison/v3/review", ({ request }) =>
        new URL(request.url).searchParams.get("artifactId") === replacement.artifactId
          ? HttpResponse.json({ title: "Unavailable" }, { status: 503 })
          : HttpResponse.json(makeSeriesAnalysisReview()),
      ),
    );
    const { queryClient } = renderPage();
    const hypothesis = await screen.findByText("収益先行時は目的地0回で終えない。");
    nextPublication = true;
    await user.click(screen.getByRole("button", { name: "表示を更新" }));
    expect(await screen.findByText("最新の戦績データを取得できません")).toBeInTheDocument();
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(hypothesis).toBeInTheDocument();
    expect(hypothesis.closest("[inert]")).toBeNull();
    expect(screen.getByRole("button", { name: "表示を更新" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "根拠・注意・試合後の確認" }));
    expect(
      within(screen.getByRole("dialog")).getByText(/収益上位時の勝率: 60%/u),
    ).toBeInTheDocument();
  });

  it("does not present the previous scope as results for a failed new selection", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("/api/analytics/series-comparison/v3/review", ({ request }) =>
        new URL(request.url).searchParams.has("seasonMasterId")
          ? HttpResponse.json({ title: "Unavailable" }, { status: 503 })
          : HttpResponse.json(makeSeriesAnalysisReview()),
      ),
    );
    const { queryClient, router } = renderPage();
    await screen.findByText("収益先行時は目的地0回で終えない。");
    await user.click(screen.getByRole("button", { name: "比較対象を変更" }));
    await selectOption(user, screen.getByRole("combobox", { name: "シーズン" }), "season_current");
    expect(await screen.findByText("戦績データを読み込めません")).toBeInTheDocument();
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(new URLSearchParams(router.state.location.search).get("seasonMasterId")).toBe(
      "season_current",
    );
    expect(screen.queryByText("収益先行時は目的地0回で終えない。")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "根拠・注意・試合後の確認" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "戦績データを再読み込み" })).toBeEnabled();
  });

  it("waits for the first publication without requesting unavailable review or aggregate data", async () => {
    const artifactRequests: string[] = [];
    server.use(
      http.get("/api/analytics/series-comparison/v2/status", () =>
        HttpResponse.json(
          makeSeriesAnalysisStatus({
            artifactFreshness: "unavailable",
            calculation: {
              finishedAt: null,
              requestedAt: "2026-08-09T02:00:00.000Z",
              startedAt: null,
              status: "queued",
              trigger: "initial_backfill",
            },
            currentArtifact: null,
          }),
        ),
      ),
      http.get("/api/analytics/series-comparison/v4/aggregate", ({ request }) => {
        artifactRequests.push(request.url);
        return HttpResponse.json(makeSeriesAnalysisAggregate());
      }),
      http.get("/api/analytics/series-comparison/v3/review", ({ request }) => {
        artifactRequests.push(request.url);
        return HttpResponse.json(makeSeriesAnalysisReview());
      }),
    );
    const { queryClient } = renderPage();
    expect(
      await screen.findByRole("heading", { name: "戦績データの計算を待っています" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(screen.getByRole("button", { name: "状態を再確認" })).toBeEnabled();
    expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
    expect(artifactRequests).toEqual([]);
  });

  it.each(["overview", "review"] as const)(
    "recovers an expired %s publication without fetching the inactive resource",
    async (view) => {
      const replacement = { ...analysisArtifact, artifactId: "replacement", inputRevision: "13" };
      let statusRequests = 0;
      const artifactRequests: Array<{ kind: string; artifactId: string | null }> = [];
      server.use(
        http.get("/api/analytics/series-comparison/v2/status", () => {
          statusRequests += 1;
          return HttpResponse.json(
            makeSeriesAnalysisStatus({
              currentArtifact: statusRequests === 1 ? analysisArtifact : replacement,
            }),
          );
        }),
        ...(["aggregate", "review"] as const).map((kind) =>
          http.get(
            `/api/analytics/series-comparison/${kind === "aggregate" ? "v4" : "v3"}/${kind}`,
            ({ request }) => {
              const artifactId = new URL(request.url).searchParams.get("artifactId");
              artifactRequests.push({ kind, artifactId });
              if (artifactId === analysisArtifact.artifactId)
                return HttpResponse.json(
                  {
                    code: "ANALYSIS_ARTIFACT_EXPIRED",
                    status: 410,
                    title: "Artifact expired",
                    detail: "The requested artifact is no longer retained.",
                    type: "about:blank",
                  } satisfies ProblemDetails,
                  { status: 410 },
                );
              return HttpResponse.json(
                kind === "aggregate"
                  ? makeSeriesAnalysisAggregate(replacement)
                  : { ...makeSeriesAnalysisReview(), artifact: replacement },
              );
            },
          ),
        ),
      );
      const { queryClient } = renderPage(`/analytics/series?view=${view}`);
      expect(
        await screen.findByRole("tabpanel", {
          name: view === "overview" ? "今の差" : "次戦に備える",
        }),
      ).toBeInTheDocument();
      await waitFor(() => expect(queryClient.isFetching()).toBe(0));
      expect(screen.queryByText("戦績データを読み込めません")).not.toBeInTheDocument();
      const kind = view === "overview" ? "aggregate" : "review";
      expect(artifactRequests).toEqual([
        { kind, artifactId: analysisArtifact.artifactId },
        { kind, artifactId: replacement.artifactId },
      ]);
      expect(statusRequests).toBe(2);
    },
  );

  it("retries a failed options request without presenting an empty title directory", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    server.use(
      http.get("/api/analytics/series-comparison/v2/options", () => {
        attempts += 1;
        return attempts === 1
          ? HttpResponse.json({ title: "Unavailable" }, { status: 503 })
          : HttpResponse.json(makeSeriesAnalysisOptions());
      }),
    );
    renderPage();
    expect(await screen.findByText("対象作品を読み込めません")).toBeInTheDocument();
    expect(screen.queryByText("登録されている作品がありません")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "比較対象を再読み込み" }));
    expect(await screen.findByText("収益先行時は目的地0回で終えない。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "比較対象を再読み込み" })).not.toBeInTheDocument();
    expect(attempts).toBe(2);
  });
});

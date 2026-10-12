import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeAll, describe, expect, it } from "vitest";

import { SeriesAnalysisAdminPage } from "@/features/seriesAnalysisAdmin/SeriesAnalysisAdminPage";
import type {
  PlayerRadarRevision,
  PlayerRadarRevisionDetail,
} from "@/shared/api/seriesPlayerRadarHistory";
import { getAuthorization } from "@/shared/auth/authorization";
import { AppMotionProvider } from "@/shared/ui/motion/AppMotionProvider";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { mswState } from "@/test/msw/fixtures";
import { setupMsw } from "@/test/msw/lifecycle";
import {
  makePlayerRadarBasis,
  makePlayerRadarPreview,
  makeReadyPlayerRadarState,
} from "@/test/msw/playerRadarFixtures";
import { makeSeriesAnalysisAdminOverview } from "@/test/msw/seriesAnalysisFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";
import { selectOption } from "@/test/selectOption";

setupMsw();
beforeAll(
  () => import("@/shared/api/generatedContracts/series-analysis-radar-validators.generated"),
);

function revision(id = "revision-1"): PlayerRadarRevision {
  return {
    revisionId: id,
    gameTitleId: "title-next",
    gameTitleName: "次の作品",
    kind: "manual",
    appliedAt: "2026-10-12T00:00:00Z",
    appliedBy: { accountId: "applying-operator", displayName: "適用時の名前" },
    savedBy: { accountId: "saving-operator", displayName: "保存時の名前" },
    beforeBasisId: "before-basis",
    afterBasisId: "after-basis",
    sourceBasisId: "source-basis",
    sourceCandidateId: null,
  };
}

function renderPage() {
  setDevUser();
  const client = createTestQueryClient();
  const overview = makeSeriesAnalysisAdminOverview();
  server.use(
    http.get("/api/admin/series-analysis/overview", () =>
      HttpResponse.json({
        ...overview,
        titleOptions: [
          ...overview.titleOptions,
          { gameTitleId: "title-next", gameTitleName: "次の作品", confirmedMatchCount: 40 },
        ],
      }),
    ),
  );
  const router = createMemoryRouter(
    [
      {
        path: "/admin/series-analysis",
        element: (
          <AppMotionProvider>
            <SeriesAnalysisAdminPage />
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
  return { router, client };
}

describe("radar revision history", () => {
  it("keeps unfinished input when navigation is canceled and leaves the editor after confirmed discard", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("/api/admin/series-analysis/radar", () =>
        HttpResponse.json(makeReadyPlayerRadarState()),
      ),
      http.get("/api/admin/series-analysis/radar/preview", () =>
        HttpResponse.json(makePlayerRadarPreview()),
      ),
      http.get("/api/admin/series-analysis/radar/revisions", () =>
        HttpResponse.json({ schemaVersion: 1, items: [revision()], nextCursor: null }),
      ),
    );
    const { router } = renderPage();
    await user.click(await screen.findByRole("tab", { name: "レーダーの採点基準" }));
    await user.click(await screen.findByRole("button", { name: "調整を始める" }));
    const threshold = await screen.findByRole("textbox", { name: "平均順位 2点の境界（位以下）" });
    await user.clear(threshold);
    await user.type(threshold, "-");
    await user.click(screen.getByRole("tab", { name: "改訂履歴" }));
    const confirmation = await screen.findByRole("alertdialog", {
      name: "未保存の変更を破棄しますか？",
    });
    expect(new URLSearchParams(router.state.location.search).get("tab")).toBe("radar");
    await user.click(within(confirmation).getByRole("button", { name: "キャンセル" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("tab", { name: "レーダーの採点基準" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("textbox", { name: "平均順位 2点の境界（位以下）" })).toHaveValue("-");

    await user.click(screen.getByRole("tab", { name: "改訂履歴" }));
    await user.click(
      within(
        await screen.findByRole("alertdialog", { name: "未保存の変更を破棄しますか？" }),
      ).getByRole("button", { name: "破棄して移動" }),
    );
    await screen.findByRole("table", { name: "採点基準の改訂一覧" });
    await selectOption(user, screen.getByRole("combobox", { name: "履歴の作品" }), "title-next");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(new URLSearchParams(router.state.location.search).get("gameTitleId")).toBe(
      "gt_momotetsu_2",
    );
    await user.click(screen.getByRole("tab", { name: "現在の採点境界" }));
    expect(screen.getByRole("combobox", { name: "対象作品" })).toHaveTextContent("桃太郎電鉄2");
    expect(
      screen.queryByRole("textbox", { name: "平均順位 2点の境界（位以下）" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("table", { name: "適用中の採点境界" })).toBeVisible();
    expect(screen.getByRole("button", { name: "調整を始める" })).toBeEnabled();
  });

  it("restores independent history filters and pagination without changing the editing title", async () => {
    const user = userEvent.setup();
    const requests: URLSearchParams[] = [];
    const beforeBasis = makePlayerRadarBasis().basis;
    const afterBasis = structuredClone(beforeBasis);
    afterBasis.axes[0].thresholds[0] = 4.123456789123;
    const detail: PlayerRadarRevisionDetail = {
      schemaVersion: 1,
      revision: revision(),
      beforeBasis,
      afterBasis,
    };
    server.use(
      http.get("/api/admin/series-analysis/radar/revisions", ({ request }) => {
        const params = new URL(request.url).searchParams;
        requests.push(params);
        return HttpResponse.json({
          schemaVersion: 1,
          items: [revision(params.has("cursor") ? "revision-2" : "revision-1")],
          nextCursor: params.has("cursor") ? null : "revision-1",
        });
      }),
      http.get("/api/admin/series-analysis/radar/revisions/revision-1", () =>
        HttpResponse.json(detail),
      ),
    );
    const { router } = renderPage();
    await screen.findByRole("combobox", { name: "対象作品" });
    await user.click(screen.getByRole("tab", { name: "レーダーの採点基準" }));
    const historyTab = screen.getByRole("tab", { name: "改訂履歴" });
    await user.click(screen.getByRole("tab", { name: "現在の採点境界" }));
    await user.keyboard("{ArrowRight}");
    expect(historyTab).toHaveFocus();
    expect(historyTab).toHaveAttribute("aria-selected", "false");
    expect(requests).toHaveLength(0);
    await user.keyboard("{Enter}");
    await screen.findByRole("table", { name: "採点基準の改訂一覧" });
    expect(new URLSearchParams(router.state.location.search).get("tab")).toBe("radar");
    expect(new URLSearchParams(router.state.location.search).get("radarView")).toBe("history");
    expect(screen.queryByRole("combobox", { name: "対象作品" })).not.toBeInTheDocument();
    await selectOption(user, screen.getByRole("combobox", { name: "履歴の作品" }), "title-next");
    await waitFor(() => expect(requests.at(-1)?.get("gameTitleId")).toBe("title-next"));
    expect(new URLSearchParams(router.state.location.search).get("gameTitleId")).toBe(
      "gt_momotetsu_2",
    );
    await user.click(await screen.findByRole("button", { name: /の改訂詳細$/u }));
    const detailRegion = await screen.findByRole("region", { name: "改訂詳細" });
    expect(within(detailRegion).getByText("適用者: 適用時の名前")).toBeVisible();
    expect(within(detailRegion).getByText("案の保存者: 保存時の名前")).toBeVisible();
    expect(within(detailRegion).getByText("4.123456789123")).toBeVisible();
    expect(within(detailRegion).getByText("変更あり")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "改訂一覧を表示" }));
    await user.click(await screen.findByRole("button", { name: "次の20件" }));
    await waitFor(() => expect(requests.at(-1)?.get("cursor")).toBe("revision-1"));
    await user.click(screen.getByRole("tab", { name: "分析の再計算" }));
    expect(screen.getByRole("combobox", { name: "対象作品" })).toHaveTextContent("桃太郎電鉄2");
    await act(() => router.navigate(-1));
    expect(historyTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("combobox", { name: "履歴の作品" })).toHaveTextContent("次の作品");
    expect(new URLSearchParams(router.state.location.search).get("historyCursor")).toBe(
      "revision-1",
    );
  });

  it("does not restore a delayed protected response after the operator role is lost", async () => {
    const user = userEvent.setup();
    const account = mswState.loginAccounts.find((entry) => entry.accountId === "account_ponta")!;
    account.role = "operator";
    const gate = createDeferred();
    let requested = false;
    server.use(
      http.get("/api/admin/series-analysis/radar/revisions", async () => {
        requested = true;
        await gate.promise;
        return HttpResponse.json({ schemaVersion: 1, items: [revision()], nextCursor: null });
      }),
    );
    const { client } = renderPage();
    await user.click(await screen.findByRole("tab", { name: "レーダーの採点基準" }));
    await user.click(await screen.findByRole("tab", { name: "改訂履歴" }));
    await waitFor(() => expect(requested).toBe(true));
    account.role = "user";
    await act(() => getAuthorization(client, "account_ponta").recheck());
    gate.resolve();
    await waitFor(() =>
      expect(screen.queryByRole("tab", { name: "改訂履歴" })).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("適用時の名前")).not.toBeInTheDocument();
  });
});

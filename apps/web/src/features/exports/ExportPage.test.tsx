import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import {
  createMemoryRouter,
  MemoryRouter,
  Route,
  RouterProvider,
  Routes,
  useLocation,
} from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { ExportPage } from "@/features/exports/ExportPage";
import type { ProblemDetails } from "@/shared/api/problemDetails";
import { heldEventKeys, matchKeys } from "@/shared/api/queryKeys";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { installAnchorClickMock } from "@/test/doubles/dom";
import { makeHeldEventDetailResponse, makeMatchDetail } from "@/test/factories";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

const notFoundProblem = {
  type: "about:blank",
  title: "Not Found",
  status: 404,
  detail: "The selected resource does not exist.",
  code: "NOT_FOUND",
} satisfies ProblemDetails;

type RenderOptions = {
  downloadTimeoutMs?: number;
  path?: string;
  slowThresholdMs?: number;
};

let queryClient: QueryClient;
let user: ReturnType<typeof userEvent.setup>;
let anchorClick: ReturnType<typeof installAnchorClickMock>;

function LocationProbe() {
  const location = useLocation();
  return (
    <output
      aria-label="current location"
      data-location={`${location.pathname}${location.search}`}
    />
  );
}

function renderPage({ downloadTimeoutMs, path = "/exports", slowThresholdMs }: RenderOptions = {}) {
  setDevUser();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            element={
              <ExportPage downloadTimeoutMs={downloadTimeoutMs} slowThresholdMs={slowThresholdMs} />
            }
            path="/exports"
          />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderExportHistory(previous: string) {
  setDevUser();
  const router = createMemoryRouter(
    [
      { path: "/exports", element: <ExportPage /> },
      { path: "/matches", element: <p>matches</p> },
    ],
    { initialEntries: [previous, "/exports?format=csv"] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe("ExportPage", () => {
  beforeEach(() => {
    queryClient = createTestQueryClient();
    user = userEvent.setup();
    anchorClick = installAnchorClickMock();
  });

  it("announces initial candidate loading before showing an empty directory", async () => {
    const gate = createDeferred();
    server.use(
      http.get("/api/held-events", async () => {
        await gate.promise;
        return HttpResponse.json({ items: [] });
      }),
    );
    renderPage({ path: "/exports?heldEventId=" });

    expect(screen.getByRole("status", { name: "開催候補を読み込み中" })).toHaveTextContent(
      "候補を読み込んでいます。",
    );
    expect(screen.queryByText("開催候補がありません")).not.toBeInTheDocument();
    await act(async () => gate.resolve());
    expect(await screen.findByText("開催候補がありません")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "開催候補を読み込み中" })).not.toBeInTheDocument();
  });

  it("downloads all matches as CSV by default", async () => {
    let captured: URL | undefined;
    server.use(
      http.get("/api/exports/matches", ({ request }) => {
        captured = new URL(request.url);
        return new HttpResponse("csv", {
          headers: {
            "Content-Disposition": 'attachment; filename="momo-results-all.csv"',
            "Content-Type": "text/csv; charset=utf-8",
          },
        });
      }),
    );

    renderPage();
    await screen.findByRole("region", { name: "出力条件" });
    await user.click(screen.getByRole("button", { name: "全試合をCSVでダウンロード" }));

    await waitFor(() => expect(captured?.searchParams.get("format")).toBe("csv"));
    expect(captured?.searchParams.has("matchId")).toBe(false);
    expect(await screen.findByText("ダウンロードを開始しました")).toBeInTheDocument();
    expect(screen.getByText("momo-results-all.csv")).toBeInTheDocument();
    expect(anchorClick.clickedAnchors[0]?.download).toBe("momo-results-all.csv");
  });

  it.each(["success", "failure"])(
    "does not show an earlier %s under conditions restored from browser history",
    async (outcome) => {
      server.use(
        http.get("/api/exports/matches", () =>
          outcome === "success"
            ? new HttpResponse("csv", {
                headers: {
                  "Content-Disposition": 'attachment; filename="earlier.csv"',
                  "Content-Type": "text/csv",
                },
              })
            : HttpResponse.json({ detail: "unavailable" }, { status: 500 }),
        ),
      );
      const router = renderExportHistory("/exports?format=tsv");
      await user.click(screen.getByRole("button", { name: "全試合をCSVでダウンロード" }));
      await screen.findByText(
        outcome === "success" ? "ダウンロードを開始しました" : "ダウンロードに失敗しました",
      );

      await act(async () => router.navigate(-1));
      expect(
        await screen.findByRole("button", { name: "全試合をTSVでダウンロード" }),
      ).toBeEnabled();
      expect(screen.queryByText("ダウンロードを開始しました")).not.toBeInTheDocument();
      expect(screen.queryByText("ダウンロードに失敗しました")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "もう一度試す" })).not.toBeInTheDocument();
    },
  );

  it.each([
    { destination: "/exports?format=tsv", action: "全試合をTSVでダウンロード" },
    { destination: "/exports?matchId=match-1&format=csv", action: "この試合をCSVでダウンロード" },
    { destination: "/matches", action: undefined },
  ])(
    "cancels a pending export when history moves to $destination",
    async ({ destination, action }) => {
      const gate = createDeferred();
      let exportSignal: AbortSignal | undefined;
      server.use(
        http.get("/api/exports/matches", async ({ request }) => {
          exportSignal = request.signal;
          await gate.promise;
          return new HttpResponse("csv", {
            headers: {
              "Content-Disposition": 'attachment; filename="abandoned.csv"',
              "Content-Type": "text/csv",
            },
          });
        }),
      );
      const router = renderExportHistory(destination);
      await user.click(screen.getByRole("button", { name: "全試合をCSVでダウンロード" }));
      await waitFor(() => expect(exportSignal).toBeDefined());
      expect(screen.getByRole("button", { name: "作成中…" })).toBeDisabled();

      await act(async () => router.navigate(-1));
      await waitFor(() => expect(exportSignal?.aborted).toBe(true));
      await act(async () => gate.resolve());
      await waitFor(() => expect(queryClient.isMutating()).toBe(0));
      expect(anchorClick.click).not.toHaveBeenCalled();
      expect(screen.queryByText("ダウンロードを開始しました")).not.toBeInTheDocument();
      expect(screen.queryByText("ダウンロードに失敗しました")).not.toBeInTheDocument();
      if (action) {
        expect(await screen.findByRole("button", { name: action })).toBeEnabled();
        await user.click(screen.getByRole("button", { name: action }));
        await screen.findByText("ダウンロードを開始しました");
        expect(anchorClick.click).toHaveBeenCalledTimes(1);
      } else {
        expect(router.state.location.pathname).toBe("/matches");
      }
    },
  );

  it("activates instant format tabs on focus and waits for confirmation before loading a scope", async () => {
    let seasonRequests = 0;
    server.use(
      http.get("/api/season-masters", () => {
        seasonRequests += 1;
        return HttpResponse.json({ items: [{ id: "season-1", name: "3年決戦" }] });
      }),
    );
    renderPage();

    await screen.findByRole("region", { name: "出力条件" });
    const formatTabs = screen.getByRole("tablist", { name: "ファイル形式" });
    await user.click(within(formatTabs).getByRole("tab", { name: "CSV" }));
    await user.keyboard("{ArrowRight}");

    await waitFor(() =>
      expect(within(formatTabs).getByRole("tab", { name: "TSV" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(screen.getByRole("tabpanel", { name: "TSV" })).toBeInTheDocument();
    expect(screen.getByText("すべての確定済み試合をTSVで書き出します。")).toBeInTheDocument();

    const scopeTabs = screen.getByRole("tablist", { name: "出力範囲" });
    await user.click(within(scopeTabs).getByRole("tab", { name: "全試合" }));
    await user.keyboard("{ArrowRight}");

    const seasonTab = within(scopeTabs).getByRole("tab", { name: "シーズン" });
    expect(seasonTab).toHaveFocus();
    expect(seasonTab).toHaveAttribute("aria-selected", "false");
    expect(within(scopeTabs).getByRole("tab", { name: "全試合" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(seasonRequests).toBe(0);

    await user.keyboard("{Enter}");

    expect(seasonTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "シーズン" })).toBeInTheDocument();
    await waitFor(() => expect(seasonRequests).toBe(1));
  });

  it("keeps the source-page return link while export conditions change", async () => {
    renderPage({
      path: "/exports?returnTo=%2Fmatches%3Fstatus%3Dconfirmed%26cursor%3Dcursor-2",
    });

    await screen.findByRole("region", { name: "出力条件" });
    const backLink = screen.getByRole("link", { name: "前の画面へ戻る" });
    expect(backLink).toHaveAttribute("href", "/matches?status=confirmed&cursor=cursor-2");

    await user.click(screen.getByRole("tab", { name: "TSV" }));
    expect(backLink).toHaveAttribute("href", "/matches?status=confirmed&cursor=cursor-2");
  });

  it("prefills match scope from deep link and downloads TSV for a single match", async () => {
    let capturedExport: URL | undefined;
    let capturedMatchList: URL | undefined;
    server.use(
      http.get("/api/matches", ({ request }) => {
        capturedMatchList = new URL(request.url);
        return HttpResponse.json({
          items: [
            {
              createdAt: "2026-01-01T09:00:00.000Z",
              heldEventId: "held-1",
              id: "match-1",
              kind: "match",
              matchId: "match-1",
              matchNoInEvent: 1,
              status: "confirmed",
              updatedAt: "2026-01-01T09:00:00.000Z",
            },
            {
              createdAt: "2026-01-01T09:00:00.000Z",
              heldEventId: "held-1",
              id: "draft-1",
              kind: "match_draft",
              matchDraftId: "draft-1",
              status: "needs_review",
              updatedAt: "2026-01-01T09:00:00.000Z",
            },
          ],
        });
      }),
      http.get("/api/exports/matches", ({ request }) => {
        capturedExport = new URL(request.url);
        return new HttpResponse("tsv", {
          headers: {
            "Content-Disposition": 'attachment; filename="momo-results-match-match-1.tsv"',
            "Content-Type": "text/tab-separated-values; charset=utf-8",
          },
        });
      }),
    );

    renderPage({ path: "/exports?matchId=match-1&format=tsv" });
    await screen.findByRole("region", { name: "出力条件" });
    expect(screen.getByRole("tab", { name: "試合" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "TSV" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "試合" })).toBeInTheDocument();
    expect(screen.getByRole("tabpanel", { name: "TSV" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "試合を変更" })).toBeInTheDocument();
    expect(screen.getAllByText(/第1試合/u)).not.toHaveLength(0);
    expect(screen.queryByText("draft-1")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "この試合をTSVでダウンロード" }));

    await waitFor(() => expect(capturedExport?.searchParams.get("format")).toBe("tsv"));
    expect(capturedExport?.searchParams.get("matchId")).toBe("match-1");
    expect(capturedMatchList?.searchParams.get("status")).toBe("confirmed");
    expect(capturedMatchList?.searchParams.get("kind")).toBe("match");
    expect(capturedMatchList?.searchParams.has("page")).toBe(false);
    expect(capturedMatchList?.searchParams.has("cursor")).toBe(false);
    expect(capturedMatchList?.searchParams.get("pageSize")).toBe("20");
    expect(capturedMatchList?.searchParams.get("sort")).toBe("held_desc");
    expect(anchorClick.clickedAnchors[0]?.download).toBe("momo-results-match-match-1.tsv");
  });

  it("keeps the selected export target available while paging and revalidating it", async () => {
    const requestedPages: number[] = [];
    const detailGate = createDeferred();
    const pageGate = createDeferred();
    let detailRequested = false;
    const allEvents = Array.from({ length: 21 }, (_, index) => ({
      draftCount: 0,
      heldAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      id: `held-${index + 1}`,
      matchCount: index + 1,
      nextMatchNo: index + 2,
    }));
    server.use(
      http.get("/api/held-events", async ({ request }) => {
        const url = new URL(request.url);
        const page = Number(url.searchParams.get("page") ?? "1");
        const pageSize = Number(url.searchParams.get("pageSize") ?? "20");
        const offset = (page - 1) * pageSize;
        requestedPages.push(page);
        if (page === 2) await pageGate.promise;
        return HttpResponse.json({
          items: allEvents.slice(offset, offset + pageSize),
          pagination: {
            hasNextPage: page * pageSize < allEvents.length,
            hasPreviousPage: page > 1,
            page,
            pageSize,
            totalItems: allEvents.length,
            totalPages: Math.ceil(allEvents.length / pageSize),
          },
          totalMatchCount: allEvents.reduce((sum, event) => sum + event.matchCount, 0),
        });
      }),
      http.get("/api/held-events/held-1/summary", async () => {
        detailRequested = true;
        await detailGate.promise;
        return HttpResponse.json(
          makeHeldEventDetailResponse({
            heldAt: "2026-01-01T00:00:00.000Z",
            id: "held-1",
            matchCount: 1,
          }),
        );
      }),
    );

    renderPage({ path: "/exports?heldEventId=held-1&format=csv" });

    await user.click(await screen.findByRole("button", { name: "開催を変更" }));
    expect(screen.getByRole("dialog", { name: "開催を選択" })).toBeInTheDocument();
    expect(screen.getByText("1〜20件／全21件")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "次のページへ" }));
    expect(await screen.findByRole("status")).toHaveTextContent("更新中");
    expect(screen.getByText("1〜20件／全21件")).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "開催候補のページネーション" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ダイアログを閉じる" })).toBeEnabled();
    expect(screen.queryByText("出力対象を確認しています。")).not.toBeInTheDocument();
    pageGate.resolve();

    const lastEvent = await screen.findByRole("radio", { name: /^2026-01-21 \d{2}:\d{2}$/u });
    expect(lastEvent).toHaveAccessibleDescription("21試合");
    expect(requestedPages).toEqual([1, 2]);
    expect(screen.getByText("21〜21件／全21件")).toBeInTheDocument();
    await waitFor(() => expect(detailRequested).toBe(true));
    expect(screen.getByText(/1試合をCSVで書き出します。/u)).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "この開催をCSVでダウンロード",
        hidden: true,
      }),
    ).toBeEnabled();
    expect(lastEvent).toBeEnabled();

    await user.click(lastEvent);
    expect(screen.queryByRole("dialog", { name: "開催を選択" })).not.toBeInTheDocument();
    expect(screen.getByText(/21試合をCSVで書き出します。/u)).toBeInTheDocument();
    detailGate.resolve();
  });

  it("resolves a match deep link outside the current candidate page", async () => {
    const requestedCursors: Array<string | null> = [];
    const pageGate = createDeferred();
    server.use(
      http.get("/api/matches", async ({ request }) => {
        const url = new URL(request.url);
        const cursor = url.searchParams.get("cursor");
        requestedCursors.push(cursor);
        const page = cursor === "candidate-last" ? 2 : 1;
        const pageSize = Number(url.searchParams.get("pageSize") ?? "20");
        if (page === 2) await pageGate.promise;
        const allMatches = Array.from({ length: 21 }, (_, index) => ({
          createdAt: "2026-01-01T00:00:00.000Z",
          heldEventId: "held-1",
          id: `match-${index + 1}`,
          kind: "match",
          matchId: `match-${index + 1}`,
          matchNoInEvent: index + 1,
          playedAt: "2026-01-01T00:00:00.000Z",
          seasonMasterId: "season_default",
          status: "confirmed",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }));
        const offset = (page - 1) * pageSize;
        return HttpResponse.json({
          items: allMatches.slice(offset, offset + pageSize),
          pagination: {
            hasNextPage: page * pageSize < allMatches.length,
            hasPreviousPage: page > 1,
            lastCursor: "candidate-last",
            nextCursor: page === 1 ? "candidate-last" : null,
            page,
            pageSize,
            previousCursor: page === 2 ? "candidate-first" : null,
            totalItems: allMatches.length,
            totalPages: Math.ceil(allMatches.length / pageSize),
          },
        });
      }),
      http.get("/api/matches/match-21/identity", () =>
        HttpResponse.json({
          createdAt: "2026-01-01T00:00:00.000Z",
          createdByAccountId: "account-1",
          gameTitleId: "gt_momotetsu_2",
          heldEventId: "held-1",
          layoutFamily: "momotetsu_2",
          mapMasterId: "map_east",
          matchId: "match-21",
          matchNoInEvent: 21,
          ownerMemberId: "member_ponta",
          playedAt: "2026-01-21T00:00:00.000Z",
          seasonMasterId: "season_default",
        }),
      ),
    );

    renderPage({ path: "/exports?matchId=match-21&format=tsv" });

    expect(await screen.findByText(/第21試合.*TSVで書き出します。/u)).toBeInTheDocument();
    expect(screen.queryByText("指定された対象: match-21")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "試合を変更" }));
    await user.click(screen.getByRole("button", { name: "次のページへ" }));
    expect(await screen.findByRole("status")).toHaveTextContent("更新中");
    expect(screen.getByText("1〜20件／全21件")).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "試合候補のページネーション" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ダイアログを閉じる" })).toBeEnabled();
    expect(screen.queryByText("出力対象を確認しています。")).not.toBeInTheDocument();
    pageGate.resolve();

    const selectedMatch = await screen.findByRole("radio", {
      name: /^2026-01-01 \d{2}:\d{2}・第21試合$/u,
    });
    expect(selectedMatch).toBeChecked();
    expect(selectedMatch).toHaveAccessibleDescription("作品名未取得・シーズン名未取得");
    expect(requestedCursors).toEqual([null, "candidate-last"]);
  });

  it("syncs scope changes to one URL scope and shows empty actions", async () => {
    server.use(http.get("/api/season-masters", () => HttpResponse.json({ items: [] })));

    renderPage();
    await screen.findByRole("region", { name: "出力条件" });
    await user.click(screen.getByRole("tab", { name: "シーズン" }));

    expect(await screen.findByText("シーズン候補がありません")).toBeInTheDocument();
    const fallbackAction = screen.getByRole("button", { name: "全試合へ切り替え" });
    expect(
      screen.queryByRole("button", { name: "このシーズンをCSVでダウンロード" }),
    ).not.toBeInTheDocument();

    await user.click(fallbackAction);

    expect(screen.getByRole("tab", { name: "全試合" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "全試合をCSVでダウンロード" })).toBeEnabled();
  });

  it("retries only the candidate area after a candidate request fails", async () => {
    let requests = 0;
    server.use(
      http.get("/api/season-masters", () => {
        requests += 1;
        if (requests === 1) {
          return HttpResponse.json({ title: "Unavailable" }, { status: 503 });
        }
        return HttpResponse.json({ items: [{ id: "season-1", name: "3年決戦" }] });
      }),
    );

    renderPage({ path: "/exports?seasonMasterId=season-1&format=csv" });

    expect(await screen.findByText("候補を読み込めませんでした。")).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "再読み込み" });
    await user.click(retry);

    expect(await screen.findByRole("combobox", { name: "シーズン" })).toHaveTextContent("3年決戦");
    expect(requests).toBe(2);
  });

  it.each([
    {
      detailPath: "/api/held-events/:heldEventId/summary",
      downloadName: "この開催をCSVでダウンロード",
      missingId: "opaque-held-event-id",
      path: "/exports?heldEventId=opaque-held-event-id&format=csv",
      recoveryName: "開催を選び直す",
      candidateName: /^2026-01-01 \d{2}:\d{2}$/u,
      recoveredQuery: "heldEventId=held-1",
      title: "指定された開催が見つかりません",
    },
    {
      detailPath: "/api/matches/:matchId/identity",
      downloadName: "この試合をCSVでダウンロード",
      missingId: "opaque-match-id",
      path: "/exports?matchId=opaque-match-id&format=csv",
      recoveryName: "試合を選び直す",
      candidateName: /^2026-01-01 \d{2}:\d{2}・第1試合$/u,
      recoveredQuery: "matchId=match-1",
      title: "指定された試合が見つかりません",
    },
  ])(
    "recovers a missing scoped deep link by choosing a confirmed candidate ($title)",
    async ({
      candidateName,
      detailPath,
      downloadName,
      missingId,
      path,
      recoveredQuery,
      recoveryName,
      title,
    }) => {
      server.use(
        http.get(detailPath, () => HttpResponse.json(notFoundProblem, { status: 404 }), {
          once: true,
        }),
      );

      renderPage({ path });

      expect(await screen.findByText(title)).toBeInTheDocument();
      expect(document.body).not.toHaveTextContent(missingId);
      expect(screen.queryByRole("button", { name: downloadName })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: recoveryName }));
      await user.click(await screen.findByRole("radio", { name: candidateName }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByText(title)).not.toBeInTheDocument();
      expect(screen.getByLabelText("current location")).toHaveAttribute(
        "data-location",
        expect.stringContaining(recoveredQuery),
      );
      await user.click(await screen.findByRole("button", { name: downloadName }));
      await screen.findByText("ダウンロードを開始しました");
      expect(anchorClick.click).toHaveBeenCalledOnce();
    },
  );

  it("retries a transient selected-match lookup failure in place", async () => {
    let attempts = 0;
    server.use(
      http.get("/api/matches/:matchId/identity", ({ params }) => {
        if (params["matchId"] !== "match-retry") {
          return HttpResponse.json(makeMatchDetail({ matchId: String(params["matchId"]) }));
        }
        attempts += 1;
        return attempts === 1
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 503 })
          : HttpResponse.json(makeMatchDetail({ matchId: "match-retry", matchNoInEvent: 7 }));
      }),
    );

    renderPage({ path: "/exports?matchId=match-retry&format=csv" });

    expect(await screen.findByText("指定された試合を確認できませんでした")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "この試合をCSVでダウンロード" }),
    ).not.toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "指定対象を再確認" });
    await user.click(retry);

    expect(await screen.findByText(/第7試合.*CSVで書き出します。/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "この試合をCSVでダウンロード" })).toBeEnabled();
    expect(attempts).toBe(2);
  });

  it.each([
    {
      scope: "match",
      directoryPath: "/api/matches",
      detailPath: "/api/matches/absent-target/identity",
      queryKey: matchKeys.resource("absent-target"),
      response: makeMatchDetail({ matchId: "absent-target", matchNoInEvent: 7 }),
      path: "/exports?matchId=absent-target",
      missingTitle: "指定された試合が見つかりません",
      action: "この試合をCSVでダウンロード",
    },
    {
      scope: "heldEvent",
      directoryPath: "/api/held-events",
      detailPath: "/api/held-events/absent-target/summary",
      queryKey: heldEventKeys.resource("absent-target"),
      response: makeHeldEventDetailResponse({ id: "absent-target" }),
      path: "/exports?heldEventId=absent-target",
      missingTitle: "指定された開催が見つかりません",
      action: "この開催をCSVでダウンロード",
    },
  ])(
    "keeps a confirmed missing $scope target absent during later failed revalidation",
    async ({
      action,
      detailPath,
      directoryPath,
      missingTitle,
      path,
      queryKey,
      response,
      scope,
    }) => {
      let phase: "found" | "missing" | "failed" = "found";
      const failureGate = createDeferred();
      let failureRequested = false;
      server.use(
        http.get(directoryPath, () =>
          HttpResponse.json({
            items:
              phase === "found"
                ? []
                : [
                    scope === "match"
                      ? { ...response, id: "absent-target", kind: "match", status: "confirmed" }
                      : response,
                  ],
          }),
        ),
        http.get(detailPath, async () => {
          if (phase === "missing") return HttpResponse.json(notFoundProblem, { status: 404 });
          if (phase === "failed") {
            failureRequested = true;
            await failureGate.promise;
            return HttpResponse.json({ detail: "unavailable" }, { status: 503 });
          }
          return HttpResponse.json(response);
        }),
      );
      renderPage({ path });
      expect(await screen.findByRole("button", { name: action })).toBeEnabled();

      phase = "missing";
      await act(async () => queryClient.invalidateQueries({ queryKey }));
      expect(await screen.findByText(missingTitle)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: action })).not.toBeInTheDocument();

      // An older list snapshot cannot override the selected target's confirmed absence.
      await act(async () =>
        queryClient.invalidateQueries({
          queryKey: scope === "match" ? matchKeys.collections() : heldEventKeys.listRoot(),
        }),
      );
      expect(await screen.findByText(missingTitle)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: action })).not.toBeInTheDocument();

      phase = "failed";
      const refresh = queryClient.invalidateQueries({ queryKey });
      await waitFor(() => expect(failureRequested).toBe(true));
      expect(await screen.findByText(missingTitle)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: action })).not.toBeInTheDocument();
      await act(async () => {
        failureGate.resolve();
        await refresh;
      });
      expect(await screen.findByText(missingTitle)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: action })).not.toBeInTheDocument();

      phase = "found";
      await act(async () => queryClient.invalidateQueries({ queryKey }));
      expect(await screen.findByRole("button", { name: action })).toBeEnabled();
    },
  );

  it("never lets a retained retry notice override a newly confirmed missing target", async () => {
    const gate = createDeferred();
    let revalidating = false;
    let requestStarted = false;
    server.use(
      http.get("/api/matches", () => HttpResponse.json({ items: [] })),
      http.get("/api/matches/match-1/identity", async () => {
        if (!revalidating) return HttpResponse.json(makeMatchDetail());
        requestStarted = true;
        await gate.promise;
        return new HttpResponse(null, { status: 503 });
      }),
    );
    renderPage({ path: "/exports?matchId=match-1" });
    expect(
      await screen.findByRole("button", { name: "この試合をCSVでダウンロード" }),
    ).toBeEnabled();

    let refresh: Promise<void> | undefined;
    act(() => {
      // Cache changes may coalesce before React presents an intermediate settled state.
      queryClient.setQueryData(matchKeys.identityRead("match-1"), { kind: "notFound" });
      revalidating = true;
      refresh = queryClient.invalidateQueries({ queryKey: matchKeys.identityRead("match-1") });
    });
    await waitFor(() => expect(requestStarted).toBe(true));
    try {
      expect(await screen.findByText("指定された試合が見つかりません")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "この試合をCSVでダウンロード" }),
      ).not.toBeInTheDocument();
    } finally {
      await act(async () => {
        gate.resolve();
        await refresh;
      });
    }
  });

  it.each([
    {
      changeName: "開催を変更",
      detailPath: "/api/held-events/:heldEventId/summary",
      detailResponse: makeHeldEventDetailResponse({
        heldAt: "2026-04-04T12:34:56.000Z",
        id: "opaque-held-target",
        matchCount: 4,
        nextMatchNo: 5,
      }),
      downloadName: "この開催をCSVでダウンロード",
      listPath: "/api/held-events",
      listResponse: {
        items: [
          {
            draftCount: 0,
            heldAt: "2026-04-04T12:34:56.000Z",
            id: "opaque-held-target",
            matchCount: 4,
            nextMatchNo: 5,
          },
        ],
        pagination: {
          hasNextPage: false,
          hasPreviousPage: false,
          page: 1,
          pageSize: 20,
          totalItems: 1,
          totalPages: 1,
        },
        totalMatchCount: 4,
      },
      opaqueId: "opaque-held-target",
      path: "/exports?heldEventId=opaque-held-target&format=csv",
      summary: /4試合をCSVで書き出します。/u,
    },
    {
      changeName: "試合を変更",
      detailPath: "/api/matches/:matchId/identity",
      detailResponse: makeMatchDetail({
        matchId: "opaque-match-target",
        matchNoInEvent: 7,
      }),
      downloadName: "この試合をCSVでダウンロード",
      listPath: "/api/matches",
      listResponse: {
        items: [
          {
            createdAt: "2026-04-04T13:00:00.000Z",
            gameTitleId: "gt_momotetsu_2",
            heldEventId: "held-1",
            id: "opaque-match-target",
            kind: "match",
            matchId: "opaque-match-target",
            matchNoInEvent: 7,
            playedAt: "2026-04-04T12:34:56.000Z",
            seasonMasterId: "season_current",
            status: "confirmed",
            updatedAt: "2026-04-04T13:00:00.000Z",
          },
        ],
        pagination: {
          hasNextPage: false,
          hasPreviousPage: false,
          lastCursor: null,
          nextCursor: null,
          page: 1,
          pageSize: 20,
          previousCursor: null,
          totalItems: 1,
          totalPages: 1,
        },
      },
      opaqueId: "opaque-match-target",
      path: "/exports?matchId=opaque-match-target&format=csv",
      summary: /第7試合.*CSVで書き出します。/u,
    },
  ])(
    "keeps a resolved deep-linked target usable when its candidate directory fails ($downloadName)",
    async ({
      changeName,
      detailPath,
      detailResponse,
      downloadName,
      listPath,
      listResponse,
      opaqueId,
      path,
      summary,
    }) => {
      const retryGate = createDeferred();
      let attempts = 0;
      server.use(
        http.get(listPath, async () => {
          attempts += 1;
          if (attempts === 1) {
            return HttpResponse.json({ detail: "temporarily unavailable" }, { status: 503 });
          }
          await retryGate.promise;
          return HttpResponse.json(listResponse);
        }),
        http.get(detailPath, () => HttpResponse.json(detailResponse)),
      );

      renderPage({ path });

      expect(await screen.findByText(summary)).toBeInTheDocument();
      expect(screen.getByText("出力候補を読み込めませんでした")).toBeInTheDocument();
      expect(
        screen.getByText(
          "指定された出力対象は確認できているため、このままダウンロードできます。別の対象へ変更するための候補一覧だけ取得できませんでした。",
        ),
      ).toBeInTheDocument();
      expect(document.body).not.toHaveTextContent(opaqueId);
      expect(screen.getByRole("button", { name: downloadName })).toBeEnabled();

      const retry = screen.getByRole("button", { name: "出力候補を再取得" });
      await user.click(retry);

      expect(await screen.findByRole("button", { name: "再取得中" })).toBe(retry);
      expect(retry).toBeDisabled();
      expect(screen.getByText("出力候補を読み込めませんでした")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: downloadName })).toBeEnabled();

      retryGate.resolve();
      expect(await screen.findByRole("button", { name: changeName })).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.queryByText("出力候補を読み込めませんでした")).not.toBeInTheDocument(),
      );
      expect(attempts).toBe(2);
    },
  );

  it("uses honest fallback labels if projected names are absent", async () => {
    const gameTitleId = "opaque-game-title-id";
    const seasonMasterId = "opaque-season-id";
    server.use(
      http.get("/api/game-titles", () =>
        HttpResponse.json({ detail: "temporarily unavailable" }, { status: 503 }),
      ),
      http.get("/api/season-masters", () =>
        HttpResponse.json({ detail: "temporarily unavailable" }, { status: 503 }),
      ),
      http.get("/api/matches", () =>
        HttpResponse.json({
          items: [
            {
              createdAt: "2026-04-04T13:00:00.000Z",
              gameTitleId,
              heldEventId: "held-1",
              id: "match-master-failure",
              kind: "match",
              matchId: "match-master-failure",
              matchNoInEvent: 2,
              playedAt: "2026-04-04T12:34:56.000Z",
              seasonMasterId,
              status: "confirmed",
              updatedAt: "2026-04-04T13:00:00.000Z",
            },
          ],
          pagination: {
            hasNextPage: false,
            hasPreviousPage: false,
            lastCursor: null,
            nextCursor: null,
            page: 1,
            pageSize: 20,
            previousCursor: null,
            totalItems: 1,
            totalPages: 1,
          },
        }),
      ),
    );

    renderPage({ path: "/exports?matchId=match-master-failure&format=csv" });

    expect(
      await screen.findByText(/作品名未取得・シーズン名未取得.*CSVで書き出します。/u),
    ).toBeInTheDocument();
    expect(screen.queryByText("候補の表示名を取得できませんでした")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(gameTitleId);
    expect(document.body).not.toHaveTextContent(seasonMasterId);
    expect(screen.getByRole("button", { name: "この試合をCSVでダウンロード" })).toBeEnabled();
  });

  it("uses the projected title without requesting a master directory", async () => {
    const gameTitleId = "opaque-game-title-id";
    const seasonMasterId = "opaque-season-id";
    const masterRequests: string[] = [];
    server.use(
      http.get("/api/game-titles", ({ request }) => {
        masterRequests.push(new URL(request.url).pathname);
        return HttpResponse.json({ items: [] });
      }),
      http.get("/api/season-masters", ({ request }) => {
        masterRequests.push(new URL(request.url).pathname);
        return HttpResponse.json({ items: [] });
      }),
      http.get("/api/matches", () =>
        HttpResponse.json({
          items: [
            {
              createdAt: "2026-04-04T13:00:00.000Z",
              gameTitleId,
              heldEventId: "held-1",
              id: "match-one-master-failure",
              gameTitleName: "桃太郎電鉄2",
              kind: "match",
              matchId: "match-one-master-failure",
              matchNoInEvent: 3,
              playedAt: "2026-04-04T12:34:56.000Z",
              seasonMasterId,
              status: "confirmed",
              updatedAt: "2026-04-04T13:00:00.000Z",
            },
          ],
          pagination: {
            hasNextPage: false,
            hasPreviousPage: false,
            lastCursor: null,
            nextCursor: null,
            page: 1,
            pageSize: 20,
            previousCursor: null,
            totalItems: 1,
            totalPages: 1,
          },
        }),
      ),
    );

    renderPage({ path: "/exports?matchId=match-one-master-failure&format=csv" });

    expect(
      await screen.findByText(/桃太郎電鉄2・シーズン名未取得.*CSVで書き出します。/u),
    ).toBeInTheDocument();
    expect(screen.queryByText("候補の表示名を取得できませんでした")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(gameTitleId);
    expect(document.body).not.toHaveTextContent(seasonMasterId);
    expect(screen.getByRole("button", { name: "この試合をCSVでダウンロード" })).toBeEnabled();
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(masterRequests).toEqual([]);
  });

  it("preserves cached candidates and actions when a same-scope refresh fails", async () => {
    let attempts = 0;
    server.use(
      http.get("/api/matches", ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("kind") !== "match") return;
        attempts += 1;
        if (attempts === 2) {
          return HttpResponse.json({ detail: "temporarily unavailable" }, { status: 503 });
        }
        return HttpResponse.json({
          items: [
            {
              createdAt: "2026-01-01T09:00:00.000Z",
              heldEventId: "held-1",
              id: "match-1",
              kind: "match",
              matchId: "match-1",
              matchNoInEvent: 1,
              playedAt: "2026-01-01T09:00:00.000Z",
              status: "confirmed",
              updatedAt: "2026-01-01T09:00:00.000Z",
            },
          ],
        });
      }),
    );

    renderPage({ path: "/exports?matchId=match-1&format=csv" });
    const change = await screen.findByRole("button", { name: "試合を変更" });
    const download = screen.getByRole("button", { name: "この試合をCSVでダウンロード" });

    await queryClient.invalidateQueries({
      queryKey: matchKeys.exports({ kind: "match", status: "confirmed" }),
    });

    expect(await screen.findByText("出力候補を更新できませんでした")).toBeInTheDocument();
    expect(change).toBeEnabled();
    expect(download).toBeEnabled();
    expect(screen.getByText(/第1試合.*CSVで書き出します。/u)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "出力候補を再取得" }));
    await waitFor(() =>
      expect(screen.queryByText("出力候補を更新できませんでした")).not.toBeInTheDocument(),
    );
    expect(attempts).toBe(3);
  });

  it("resets invalid deep-link conditions from the inline error", async () => {
    renderPage({
      path: "/exports?format=invalid&seasonMasterId=season-1&matchId=match-1",
    });

    expect(await screen.findByText("出力条件を確認")).toBeInTheDocument();
    expect(
      screen.getByText(
        "format は csv または tsv を指定してください。 出力範囲は1つだけ指定してください。",
      ),
    ).toBeInTheDocument();
    const reset = screen.getByRole("button", { name: "初期条件へ戻す" });
    expect(screen.queryByRole("button", { name: /ダウンロード/u })).not.toBeInTheDocument();

    await user.click(reset);

    expect(screen.queryByText("出力条件を確認")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "全試合" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "全試合をCSVでダウンロード" })).toBeEnabled();
  });

  it("shows API errors from failed downloads near the action", async () => {
    server.use(
      http.get(
        "/api/exports/matches",
        () =>
          HttpResponse.json(
            {
              code: "VALIDATION_FAILED",
              detail: "Specify at most one export scope.",
              status: 422,
              title: "Validation Failed",
              type: "about:blank",
            },
            { status: 422 },
          ),
        { once: true },
      ),
    );

    renderPage();
    await screen.findByRole("region", { name: "出力条件" });
    await user.click(screen.getByRole("button", { name: "全試合をCSVでダウンロード" }));

    expect(await screen.findByText("出力条件を確認してください")).toBeInTheDocument();
    expect(
      screen.getByText("出力条件に問題があります。条件を確認して、もう一度お試しください。"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Validation Failed")).not.toBeInTheDocument();
    expect(screen.queryByText("Specify at most one export scope.")).not.toBeInTheDocument();
    expect(anchorClick.click).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "もう一度試す" }));
    expect(await screen.findByText("ダウンロードを開始しました")).toBeInTheDocument();
    expect(anchorClick.click).toHaveBeenCalledOnce();
    expect(screen.queryByText("出力条件を確認してください")).not.toBeInTheDocument();
  });

  it("keeps a resolved download usable while candidate controls are refreshing", async () => {
    const refetchGate = createDeferred();
    let holdMatchRefetch = false;
    const requestedExports: string[] = [];

    server.use(
      http.get("/api/matches", async ({ request }) => {
        const url = new URL(request.url);
        if (
          holdMatchRefetch &&
          url.searchParams.get("kind") === "match" &&
          url.searchParams.get("status") === "confirmed"
        ) {
          await refetchGate.promise;
        }
        return HttpResponse.json({
          items: [
            {
              createdAt: "2026-01-01T09:00:00.000Z",
              heldEventId: "held-1",
              id: "match-1",
              kind: "match",
              matchId: "match-1",
              matchNoInEvent: 1,
              status: "confirmed",
              updatedAt: "2026-01-01T09:00:00.000Z",
            },
          ],
        });
      }),
      http.get("/api/exports/matches", ({ request }) => {
        requestedExports.push(new URL(request.url).search);
        return new HttpResponse("csv", { headers: { "Content-Type": "text/csv" } });
      }),
    );

    renderPage({ path: "/exports?matchId=match-1&format=csv" });
    expect(await screen.findByRole("button", { name: "試合を変更" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "この試合をCSVでダウンロード" })).toBeEnabled();

    holdMatchRefetch = true;
    void queryClient.invalidateQueries({
      queryKey: matchKeys.exports({ kind: "match", status: "confirmed" }),
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "試合を変更" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "この試合をCSVでダウンロード" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "この試合をCSVでダウンロード" }));
    expect(await screen.findByText("ダウンロードを開始しました")).toBeInTheDocument();
    expect(requestedExports).toEqual(["?format=csv&matchId=match-1"]);
    expect(anchorClick.click).toHaveBeenCalledOnce();
    await act(async () => refetchGate.resolve());
    await waitFor(() => expect(screen.getByRole("button", { name: "試合を変更" })).toBeEnabled());
  });

  it("prevents duplicate submission while pending and shows progress", async () => {
    let requests = 0;
    const responseGate = createDeferred();
    server.use(
      http.get("/api/exports/matches", async () => {
        requests += 1;
        await responseGate.promise;
        return new HttpResponse("csv", {
          headers: {
            "Content-Disposition": 'attachment; filename="momo-results-all.csv"',
            "Content-Type": "text/csv; charset=utf-8",
          },
        });
      }),
    );

    renderPage();
    await screen.findByRole("region", { name: "出力条件" });
    const location = screen.getByLabelText("current location");
    const initialLocation = location.dataset["location"] ?? "";
    await user.click(screen.getByRole("button", { name: "全試合をCSVでダウンロード" }));

    expect(screen.getByRole("button", { name: "作成中…" })).toBeDisabled();
    const csvTab = screen.getByRole("tab", { name: "CSV" });
    const tsvTab = screen.getByRole("tab", { name: "TSV" });
    const allScopeTab = screen.getByRole("tab", { name: "全試合" });
    const seasonTab = screen.getByRole("tab", { name: "シーズン" });
    expect(csvTab).toHaveAttribute("aria-disabled", "true");
    expect(allScopeTab).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByText("出力ファイルを作成しています")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "作成中…" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "試合一覧へ戻る" })).not.toBeInTheDocument();

    await user.click(tsvTab);
    await user.keyboard("{Enter}{ArrowRight}");
    await user.click(seasonTab);
    await user.keyboard("{Enter}{ArrowRight}");

    expect(csvTab).toHaveAttribute("aria-selected", "true");
    expect(tsvTab).toHaveAttribute("aria-selected", "false");
    expect(allScopeTab).toHaveAttribute("aria-selected", "true");
    expect(seasonTab).toHaveAttribute("aria-selected", "false");
    expect(location).toHaveAttribute("data-location", initialLocation);

    await user.click(screen.getByRole("button", { name: "作成中…" }));
    expect(requests).toBe(1);

    responseGate.resolve();
    expect(await screen.findByText("ダウンロードを開始しました")).toBeInTheDocument();
  });

  it("shows timeout states without leaving the spinner running", async () => {
    server.use(
      http.get("/api/exports/matches", () =>
        HttpResponse.json(
          {
            code: "REQUEST_TIMEOUT",
            detail: "export timed out",
            status: 408,
            title: "Request Timeout",
            type: "about:blank",
          },
          { status: 408 },
        ),
      ),
    );

    renderPage();
    await screen.findByRole("region", { name: "出力条件" });
    await user.click(screen.getByRole("button", { name: "全試合をCSVでダウンロード" }));

    expect(await screen.findByText("出力が完了しませんでした")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "作成中…" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "もう一度試す" })).toBeInTheDocument();
  });
});

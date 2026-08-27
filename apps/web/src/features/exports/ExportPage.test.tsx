import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExportPage } from "@/features/exports/ExportPage";
import { matchKeys } from "@/shared/api/queryKeys";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { installAnchorClickMock } from "@/test/doubles/dom";
import { makeHeldEventDetailResponse, makeMatchDetail } from "@/test/factories";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

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

function expectSingleCandidateScrollRegion(label: "開催" | "試合") {
  const dialog = screen.getByRole("dialog", { name: `${label}を選択` });
  expect(dialog).toHaveClass("overflow-y-hidden");
  expect(dialog).not.toHaveClass("overflow-y-auto");
  expect(dialog.firstElementChild).toHaveClass("overflow-y-hidden");
  expect(dialog.firstElementChild).not.toHaveClass("overflow-y-auto");
  const candidateGroup = screen.getByRole("group", { name: `${label}候補` });
  const candidateList = candidateGroup.querySelector(":scope > div");
  expect(candidateGroup).not.toHaveClass("overflow-y-auto");
  expect(candidateList).toHaveClass("overflow-y-auto", "overscroll-contain");
}

describe("ExportPage", () => {
  beforeEach(() => {
    queryClient = createTestQueryClient();
    user = userEvent.setup();
    anchorClick = installAnchorClickMock();
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
    await screen.findByRole("heading", { name: "CSV/TSV出力" });
    await user.click(screen.getByRole("button", { name: "全試合をCSVでダウンロード" }));

    await waitFor(() => expect(captured?.searchParams.get("format")).toBe("csv"));
    expect(captured?.searchParams.has("matchId")).toBe(false);
    expect(await screen.findByText("ダウンロードを開始しました")).toBeInTheDocument();
    expect(screen.getByText("momo-results-all.csv")).toBeInTheDocument();
    expect(anchorClick.clickedAnchors[0]?.download).toBe("momo-results-all.csv");
  });

  it("keeps one concise heading and orders the task from scope to format", async () => {
    renderPage();

    await screen.findByRole("heading", { name: "CSV/TSV出力" });
    const surface = screen.getByRole("region", { name: "出力条件" });
    const scope = screen.getByRole("tablist", { name: "出力範囲" });
    const format = screen.getByRole("tablist", { name: "ファイル形式" });

    expect(surface).toHaveClass("bg-[var(--color-surface)]", "rounded-[var(--radius-md)]");
    expect(surface).not.toHaveClass("border");
    expect(surface).not.toContainElement(screen.getByRole("heading", { name: "CSV/TSV出力" }));
    expect(screen.queryByText("出力条件")).not.toBeInTheDocument();
    expect(screen.queryByText("書き出し内容")).not.toBeInTheDocument();
    expect(screen.queryByText(/条件はURLに保存/u)).not.toBeInTheDocument();
    expect(scope.compareDocumentPosition(format) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(scope).getByRole("tab", { name: "全試合" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(format).getByRole("tab", { name: "CSV" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const exclusionNotice = screen.getByText("下書きや確認待ちの試合は含みません。");
    expect(
      exclusionNotice.compareDocumentPosition(scope) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const allScopePanel = screen.getByRole("tabpanel", { name: "全試合" });
    expect(allScopePanel).toBeInTheDocument();
    expect(within(allScopePanel).queryByText("下書きや確認待ちの試合は含みません。")).toBeNull();
    expect(screen.getByRole("tabpanel", { name: "CSV" })).toBeInTheDocument();
    const actionSummary = screen.getByText("すべての確定済み試合をCSVで書き出します。");
    expect(actionSummary).toBeInTheDocument();
    expect(actionSummary.parentElement?.parentElement).toHaveClass("pt-2");
    expect(actionSummary.parentElement?.parentElement).not.toHaveClass("border-t");
  });

  it("keeps the exclusion notice visible for every export scope", async () => {
    renderPage();

    await screen.findByRole("heading", { name: "CSV/TSV出力" });
    const scopeTabs = screen.getByRole("tablist", { name: "出力範囲" });
    const exclusionNotice = screen.getByText("下書きや確認待ちの試合は含みません。");

    for (const label of ["全試合", "シーズン", "開催", "試合"]) {
      await user.click(within(scopeTabs).getByRole("tab", { name: label }));
      expect(screen.getByText("下書きや確認待ちの試合は含みません。")).toBe(exclusionNotice);
    }
  });

  it("activates instant format tabs on focus and waits for confirmation before loading a scope", async () => {
    let seasonRequests = 0;
    server.use(
      http.get("/api/season-masters", () => {
        seasonRequests += 1;
        return HttpResponse.json({ items: [{ id: "season-1", name: "3年決戦" }] });
      }),
    );
    renderPage();

    await screen.findByRole("heading", { name: "CSV/TSV出力" });
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

    await screen.findByRole("heading", { name: "CSV/TSV出力" });
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
    await screen.findByRole("heading", { name: "CSV/TSV出力" });
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
    let detailRequested = false;
    const allEvents = Array.from({ length: 21 }, (_, index) => ({
      draftCount: 0,
      heldAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      id: `held-${index + 1}`,
      matchCount: index + 1,
      nextMatchNo: index + 2,
    }));
    server.use(
      http.get("/api/held-events", ({ request }) => {
        const url = new URL(request.url);
        const page = Number(url.searchParams.get("page") ?? "1");
        const pageSize = Number(url.searchParams.get("pageSize") ?? "20");
        const offset = (page - 1) * pageSize;
        requestedPages.push(page);
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
      http.get("/api/held-events/held-1", async () => {
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
    expectSingleCandidateScrollRegion("開催");
    expect(screen.getByText("1-20件 / 全21件")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "次のページへ" }));
    const lastEvent = await screen.findByRole("radio", { name: /21試合/u });
    expect(requestedPages).toEqual([1, 2]);
    expect(screen.getByText("21-21件 / 全21件")).toBeInTheDocument();
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
    server.use(
      http.get("/api/matches", ({ request }) => {
        const url = new URL(request.url);
        const cursor = url.searchParams.get("cursor");
        requestedCursors.push(cursor);
        const page = cursor === "candidate-last" ? 2 : 1;
        const pageSize = Number(url.searchParams.get("pageSize") ?? "20");
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
      http.get("/api/matches/match-21", () =>
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
    expectSingleCandidateScrollRegion("試合");
    await user.click(screen.getByRole("button", { name: "次のページへ" }));
    expect(await screen.findByRole("radio", { name: /第21試合/u })).toBeChecked();
    expect(requestedCursors).toEqual([null, "candidate-last"]);
  });

  it("syncs scope changes to one URL scope and shows empty actions", async () => {
    server.use(http.get("/api/season-masters", () => HttpResponse.json({ items: [] })));

    renderPage();
    await screen.findByRole("heading", { name: "CSV/TSV出力" });
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
    expect(retry).toHaveClass("bg-[var(--color-action)]");
    await user.click(retry);

    expect(await screen.findByRole("combobox", { name: "シーズン" })).toHaveValue("season-1");
    expect(requests).toBe(2);
  });

  it.each([
    {
      detailPath: "/api/held-events/:heldEventId",
      downloadName: "この開催をCSVでダウンロード",
      missingId: "opaque-held-event-id",
      path: "/exports?heldEventId=opaque-held-event-id&format=csv",
      recoveryName: "開催を選び直す",
      title: "指定された開催が見つかりません",
    },
    {
      detailPath: "/api/matches/:matchId",
      downloadName: "この試合をCSVでダウンロード",
      missingId: "opaque-match-id",
      path: "/exports?matchId=opaque-match-id&format=csv",
      recoveryName: "試合を選び直す",
      title: "指定された試合が見つかりません",
    },
  ])(
    "keeps a missing scoped deep link non-downloadable without exposing its opaque ID ($title)",
    async ({ detailPath, downloadName, missingId, path, recoveryName, title }) => {
      server.use(
        http.get(detailPath, () =>
          HttpResponse.json(
            { detail: "not found", status: 404, title: "Not Found" },
            { status: 404 },
          ),
        ),
      );

      renderPage({ path });

      expect(await screen.findByText(title)).toBeInTheDocument();
      expect(document.body).not.toHaveTextContent(missingId);
      expect(screen.queryByRole("button", { name: downloadName })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: recoveryName })).toHaveClass(
        "bg-[var(--color-action)]",
      );
    },
  );

  it("retries a transient selected-match lookup failure in place", async () => {
    let attempts = 0;
    server.use(
      http.get("/api/matches/:matchId", ({ params }) => {
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
    expect(retry).toHaveClass("bg-[var(--color-action)]");
    await user.click(retry);

    expect(await screen.findByText(/第7試合.*CSVで書き出します。/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "この試合をCSVでダウンロード" })).toBeEnabled();
    expect(attempts).toBe(2);
  });

  it.each([
    {
      changeName: "開催を変更",
      detailPath: "/api/held-events/:heldEventId",
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
      detailPath: "/api/matches/:matchId",
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
      expect(retry).toHaveClass("bg-[var(--color-surface)]");
      await user.click(retry);

      expect(await screen.findByText("出力対象を確認しています。")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: downloadName })).toBeEnabled();

      retryGate.resolve();
      expect(await screen.findByRole("button", { name: changeName })).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.queryByText("出力候補を読み込めませんでした")).not.toBeInTheDocument(),
      );
      expect(attempts).toBe(2);
    },
  );

  it("marks both master names as unacquired when both master requests fail", async () => {
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
    expect(screen.getByText("候補の表示名を取得できませんでした")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(gameTitleId);
    expect(document.body).not.toHaveTextContent(seasonMasterId);
    expect(screen.getByRole("button", { name: "この試合をCSVでダウンロード" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "出力候補を再取得" })).toHaveClass(
      "bg-[var(--color-surface)]",
    );
  });

  it("keeps the acquired master name when only the other master request fails", async () => {
    const gameTitleId = "opaque-game-title-id";
    const seasonMasterId = "opaque-season-id";
    server.use(
      http.get("/api/game-titles", () =>
        HttpResponse.json({
          items: [
            {
              createdAt: "2026-01-01T00:00:00.000Z",
              displayOrder: 1,
              id: gameTitleId,
              layoutFamily: "momotetsu_2",
              name: "桃太郎電鉄2",
            },
          ],
        }),
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
              id: "match-one-master-failure",
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
    expect(screen.getByText("候補の表示名を取得できませんでした")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(gameTitleId);
    expect(document.body).not.toHaveTextContent(seasonMasterId);
    expect(screen.getByRole("button", { name: "この試合をCSVでダウンロード" })).toBeEnabled();
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
    expect(reset).toHaveClass("bg-[var(--color-action)]");
    expect(screen.queryByRole("button", { name: /ダウンロード/u })).not.toBeInTheDocument();

    await user.click(reset);

    expect(screen.queryByText("出力条件を確認")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "全試合" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "全試合をCSVでダウンロード" })).toBeEnabled();
  });

  it("shows API errors from failed downloads near the action", async () => {
    server.use(
      http.get("/api/exports/matches", () =>
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
      ),
    );

    renderPage();
    await screen.findByRole("heading", { name: "CSV/TSV出力" });
    await user.click(screen.getByRole("button", { name: "全試合をCSVでダウンロード" }));

    expect(await screen.findByText("出力条件を確認してください")).toBeInTheDocument();
    expect(
      screen.getByText("出力条件に問題があります。条件を確認して、もう一度お試しください。"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Validation Failed")).not.toBeInTheDocument();
    expect(screen.queryByText("Specify at most one export scope.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "もう一度試す" })).toBeInTheDocument();
  });

  it("keeps a resolved download usable while candidate controls are refreshing", async () => {
    const refetchGate = createDeferred();
    let holdMatchRefetch = false;

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
    );

    renderPage({ path: "/exports?matchId=match-1&format=csv" });
    expect(await screen.findByRole("button", { name: "試合を変更" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "この試合をCSVでダウンロード" })).toBeEnabled();

    holdMatchRefetch = true;
    void queryClient.invalidateQueries({
      queryKey: matchKeys.exports({ kind: "match", status: "confirmed" }),
    });

    expect(await screen.findByText("出力対象を確認しています。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "試合を変更" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "この試合をCSVでダウンロード" })).toBeEnabled();

    refetchGate.resolve();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "この試合をCSVでダウンロード" })).toBeEnabled();
    });
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
    await screen.findByRole("heading", { name: "CSV/TSV出力" });
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
    expect(screen.getByText("出力ファイルを作成しています")).toBeInTheDocument();
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

  it("switches to the slow progress state once at the configured threshold", async () => {
    const responseGate = createDeferred();
    server.use(
      http.get("/api/exports/matches", async () => {
        await responseGate.promise;
        return new HttpResponse("csv", {
          headers: {
            "Content-Disposition": 'attachment; filename="momo-results-all.csv"',
            "Content-Type": "text/csv; charset=utf-8",
          },
        });
      }),
    );

    renderPage({ slowThresholdMs: 1_000 });
    await screen.findByRole("heading", { name: "CSV/TSV出力" });
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole("button", { name: "全試合をCSVでダウンロード" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText("出力ファイルを作成しています")).toBeInTheDocument();
    expect(screen.queryByText("通常より時間がかかっています")).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(screen.getByText("出力ファイルを作成しています")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByText("通常より時間がかかっています")).toBeInTheDocument();

    vi.useRealTimers();
    responseGate.resolve();
    expect(await screen.findByText("ダウンロードを開始しました")).toBeInTheDocument();
    expect(screen.queryByText("通常より時間がかかっています")).not.toBeInTheDocument();
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
    await screen.findByRole("heading", { name: "CSV/TSV出力" });
    await user.click(screen.getByRole("button", { name: "全試合をCSVでダウンロード" }));

    expect(await screen.findByText("出力が完了しませんでした")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "作成中…" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "もう一度試す" })).toBeInTheDocument();
  });
});

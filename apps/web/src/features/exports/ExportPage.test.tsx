import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { ExportPage } from "@/features/exports/ExportPage";
import { createDeferred } from "@/test/deferred";
import { installAnchorClickMock } from "@/test/doubles/dom";
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

function renderPage({ downloadTimeoutMs, path = "/exports", slowThresholdMs }: RenderOptions = {}) {
  window.localStorage.setItem("momoresult.devUser", "account_ponta");
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
      </MemoryRouter>
    </QueryClientProvider>,
  );
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

    const { container } = renderPage();
    await screen.findByRole("heading", { name: "CSV / TSV 出力" });
    expect(container.querySelector('[data-export-artwork="ticket"]')).toHaveAttribute(
      "src",
      "/ticket.png",
    );
    expect(container.querySelector("[data-matches-artwork]")).toBeNull();
    expect(container.querySelector("[data-ocr-artwork]")).toBeNull();
    expect(container.querySelector("[data-result-asset]")).toBeNull();
    await user.click(screen.getByRole("button", { name: "CSVをダウンロード" }));

    await waitFor(() => expect(captured?.searchParams.get("format")).toBe("csv"));
    expect(captured?.searchParams.has("matchId")).toBe(false);
    expect(await screen.findByText("ダウンロードを開始しました")).toBeInTheDocument();
    expect(anchorClick.clickedAnchors[0]?.download).toBe("momo-results-all.csv");
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
    await screen.findByRole("heading", { name: "CSV / TSV 出力" });
    expect(await screen.findByLabelText("試合")).toHaveValue("match-1");
    expect(screen.queryByText("draft-1")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "TSVをダウンロード" }));

    await waitFor(() => expect(capturedExport?.searchParams.get("format")).toBe("tsv"));
    expect(capturedExport?.searchParams.get("matchId")).toBe("match-1");
    expect(capturedMatchList?.searchParams.get("status")).toBe("confirmed");
    expect(capturedMatchList?.searchParams.get("kind")).toBe("match");
    expect(anchorClick.clickedAnchors[0]?.download).toBe("momo-results-match-match-1.tsv");
  });

  it("syncs scope changes to one URL scope and shows empty actions", async () => {
    server.use(http.get("/api/season-masters", () => HttpResponse.json({ items: [] })));

    renderPage();
    await screen.findByRole("heading", { name: "CSV / TSV 出力" });
    await user.click(screen.getByRole("button", { name: "シーズン" }));

    expect(await screen.findByText("シーズン候補がありません")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "設定管理へ" })).toHaveAttribute(
      "href",
      "/admin/masters",
    );
    expect(screen.getByRole("button", { name: "CSVをダウンロード" })).toBeDisabled();
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
    await screen.findByRole("heading", { name: "CSV / TSV 出力" });
    await user.click(screen.getByRole("button", { name: "CSVをダウンロード" }));

    expect(await screen.findByText("Validation Failed")).toBeInTheDocument();
    expect(screen.getByText("Specify at most one export scope.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "もう一度試す" })).toBeInTheDocument();
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
    await screen.findByRole("heading", { name: "CSV / TSV 出力" });
    await user.click(screen.getByRole("button", { name: "CSVをダウンロード" }));

    expect(screen.getByRole("button", { name: "作成中…" })).toBeDisabled();
    expect(screen.getByText("出力ファイルを作成しています")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "試合一覧へ戻る" })).not.toBeInTheDocument();
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
    await screen.findByRole("heading", { name: "CSV / TSV 出力" });
    await user.click(screen.getByRole("button", { name: "CSVをダウンロード" }));

    expect(await screen.findByText("出力が完了しませんでした")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "作成中…" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "もう一度試す" })).toBeInTheDocument();
  });
});

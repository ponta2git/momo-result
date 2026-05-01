import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { queryClient } from "@/app/queryClient";
import { ExportPage } from "@/features/exports/ExportPage";
import { server } from "@/shared/api/msw/server";

function renderPage(path = "/exports") {
  window.localStorage.setItem("momoresult.devUser", "ponta");
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <ExportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ExportPage", () => {
  afterEach(() => queryClient.clear());

  it("downloads all matches as CSV by default", async () => {
    let captured: URL | undefined;
    server.use(
      http.get("/api/exports/matches", ({ request }) => {
        captured = new URL(request.url);
        return new HttpResponse("csv", {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="momo-results-all.csv"',
          },
        });
      }),
    );

    renderPage();
    await screen.findByRole("heading", { name: "CSV / TSV 出力" });
    await userEvent.click(screen.getByRole("button", { name: "CSV をダウンロード" }));

    await waitFor(() => expect(captured?.searchParams.get("format")).toBe("csv"));
    expect(captured?.searchParams.has("matchId")).toBe(false);
  });

  it("prefills match scope and downloads TSV for a single match", async () => {
    let captured: URL | undefined;
    server.use(
      http.get("/api/exports/matches", ({ request }) => {
        captured = new URL(request.url);
        return new HttpResponse("tsv", {
          headers: {
            "Content-Type": "text/tab-separated-values; charset=utf-8",
            "Content-Disposition": 'attachment; filename="momo-results-match-match-1.tsv"',
          },
        });
      }),
    );

    renderPage("/exports?matchId=match-1");
    await screen.findByRole("heading", { name: "CSV / TSV 出力" });
    await waitFor(() => expect(screen.getByLabelText("試合")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "tsv" }));
    await userEvent.click(screen.getByRole("button", { name: "TSV をダウンロード" }));

    await waitFor(() => expect(captured?.searchParams.get("format")).toBe("tsv"));
    expect(captured?.searchParams.get("matchId")).toBe("match-1");
  });

  it("shows API errors from failed downloads", async () => {
    server.use(
      http.get("/api/exports/matches", () =>
        HttpResponse.json(
          {
            type: "about:blank",
            title: "Validation Failed",
            status: 422,
            detail: "Specify at most one export scope.",
            code: "VALIDATION_FAILED",
          },
          { status: 422 },
        ),
      ),
    );

    renderPage();
    await screen.findByRole("heading", { name: "CSV / TSV 出力" });
    await userEvent.click(screen.getByRole("button", { name: "CSV をダウンロード" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Specify at most one export scope.");
  });
});

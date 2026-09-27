import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { useLayoutEffect, useRef } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { useExportPageModel } from "@/features/exports/useExportPageModel";
import { setDevUser } from "@/test/auth";
import { installAnchorClickMock } from "@/test/doubles/dom";
import { makeMatchDetail } from "@/test/factories";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

function DownloadAtFirstReadyCommit() {
  const page = useExportPageModel({});
  const started = useRef(false);
  useLayoutEffect(() => {
    if (started.current || !page.view.canDownload) return;
    started.current = true;
    page.download.start();
  }, [page]);
  return <p>{page.view.summaryText}</p>;
}

describe("export page action contract", () => {
  it("uses the displayed default candidate even before URL normalization commits", async () => {
    setDevUser();
    const anchor = installAnchorClickMock();
    let requestUrl: URL | undefined;
    server.use(
      http.get("/api/matches", () =>
        HttpResponse.json({
          items: [
            {
              ...makeMatchDetail({ matchId: "match-default", matchNoInEvent: 7 }),
              id: "match-default",
              kind: "match",
              status: "confirmed",
            },
          ],
        }),
      ),
      http.get("/api/exports/matches", ({ request }) => {
        requestUrl = new URL(request.url);
        return new HttpResponse("csv", { headers: { "Content-Type": "text/csv" } });
      }),
    );
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter initialEntries={["/exports?matchId="]}>
          <DownloadAtFirstReadyCommit />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/第7試合.*CSVで書き出します。/u)).toBeInTheDocument();
    await waitFor(() => expect(requestUrl?.searchParams.get("matchId")).toBe("match-default"));
    await waitFor(() => expect(anchor.click).toHaveBeenCalledOnce());
  });
});

import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { SeriesAnalysisNavigation } from "@/features/seriesComparison/navigation/SeriesAnalysisNavigation";
import { useSeriesAnalysisLocationState } from "@/features/seriesComparison/navigation/useSeriesAnalysisLocationState";
import { SeriesAnalysisContent } from "@/features/seriesComparison/page/SeriesAnalysisContent";
import { createDeferred } from "@/test/deferred";
import {
  makeFourPlayerSeriesAnalysisReview,
  makeSeriesAnalysisAggregate,
  makeSeriesAnalysisOptions,
} from "@/test/msw/seriesAnalysisFixtures";
import { createTestQueryClient } from "@/test/queryClient";

const options = makeSeriesAnalysisOptions();
const review = makeFourPlayerSeriesAnalysisReview();
const aggregate = makeSeriesAnalysisAggregate();
const initialUrl =
  "/analytics/series?gameTitleId=gt_momotetsu_2&focusMatchId=match-12&returnTo=%2Fmatches";

function Harness({ gate }: { gate?: Promise<void> | undefined }) {
  const location = useSeriesAnalysisLocationState(options);
  const [ready, setReady] = useState(!gate);
  useEffect(() => {
    let mounted = true;
    void gate?.then(() => {
      if (mounted) setReady(true);
      return undefined;
    });
    return () => {
      mounted = false;
    };
  }, [gate]);
  return (
    <SeriesAnalysisNavigation>
      <button type="button">別の操作</button>
      <SeriesAnalysisContent
        bundle={
          location.activeView === "review"
            ? { kind: "review", view: "review", review, matchContext: undefined }
            : { kind: "analysis", view: location.activeView, aggregate, matchContext: undefined }
        }
        navigationReady={location.activeView === "review" || ready}
        onArtifactExpired={() => undefined}
        onClearFocusedMatch={location.actions.clearFocusedMatch}
        onFocusMatch={location.actions.focusMatch}
        onViewChange={location.actions.updateView}
      />
    </SeriesAnalysisNavigation>
  );
}

function setup({ gate, url = initialUrl }: { gate?: Promise<void>; url?: string } = {}) {
  const router = createMemoryRouter(
    [
      { path: "/matches", element: <p>試合一覧</p> },
      { path: "/analytics/series", element: <Harness gate={gate} /> },
    ],
    { initialEntries: ["/matches", url], initialIndex: 1 },
  );
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe("series analysis section navigation", () => {
  it("reaches evidence and returns to the expanded hypothesis with exactly one history entry", async () => {
    const user = userEvent.setup();
    const restoration = window.history.scrollRestoration;
    const router = setup();
    expect(window.history.scrollRestoration).toBe("manual");
    window.dispatchEvent(new Event("pagehide"));
    expect(window.history.scrollRestoration).toBe(restoration);
    window.dispatchEvent(new Event("pageshow"));
    expect(window.history.scrollRestoration).toBe("manual");
    await user.click(screen.getByRole("button", { name: "ぽんたのほかの仮説" }));
    const link = screen.getAllByRole("link", { name: "ぽんたの詳しい分析" })[1];
    if (!link) throw new Error("secondary hypothesis fixture is required");
    const linkId = link.id;
    expect(link).toHaveAttribute(
      "href",
      "/analytics/series?gameTitleId=gt_momotetsu_2&focusMatchId=match-12&view=drivers&returnTo=%2Fmatches#metric-revenue-outcome",
    );
    await user.click(link);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "物件収益と最終順位" })).toHaveFocus(),
    );
    expect(router.state.location.hash).toBe("#metric-revenue-outcome");
    await act(async () => router.navigate(-1));
    expect(screen.getByRole("button", { name: "ぽんたのほかの仮説" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(document.getElementById(linkId)).toHaveFocus();
    expect(router.state.location.search).toBe(initialUrl.slice(initialUrl.indexOf("?")));
    await act(async () => router.navigate(-1));
    expect(screen.getByText("試合一覧")).toBeInTheDocument();
    expect(window.history.scrollRestoration).toBe(restoration);
  });

  it("finishes arrival when the current body becomes ready", async () => {
    const user = userEvent.setup();
    const gate = createDeferred<void>();
    setup({ gate: gate.promise });
    await user.click(screen.getByRole("link", { name: "ぽんたの詳しい分析" }));
    const heading = await screen.findByRole("heading", { name: "物件収益と最終順位" });
    expect(heading).not.toHaveFocus();
    await act(async () => gate.resolve());
    expect(heading).toHaveFocus();
  });

  it("waits for the current body and cancels arrival when the user moves to another control", async () => {
    const user = userEvent.setup();
    const gate = createDeferred<void>();
    setup({ gate: gate.promise });
    await user.click(screen.getByRole("link", { name: "ぽんたの詳しい分析" }));
    const heading = await screen.findByRole("heading", { name: "物件収益と最終順位" });
    expect(heading).not.toHaveFocus();
    await user.click(screen.getByRole("button", { name: "別の操作" }));
    await act(async () => gate.resolve());
    expect(screen.getByRole("button", { name: "別の操作" })).toHaveFocus();
  });

  it("preserves the section through URL canonicalization on direct entry", async () => {
    const router = setup({ url: `${initialUrl}&view=drivers&unused=1#metric-revenue-outcome` });
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "物件収益と最終順位" })).toHaveFocus(),
    );
    expect(router.state.location.hash).toBe("#metric-revenue-outcome");
    expect(router.state.location.search).not.toContain("unused");
    expect(router.state.location.search).toContain("focusMatchId=match-12");
    expect(router.state.location.search).toContain("returnTo=%2Fmatches");
  });
});

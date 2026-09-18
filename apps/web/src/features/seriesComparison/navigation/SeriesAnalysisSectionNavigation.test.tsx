import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useEffect, useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SeriesAnalysisNavigation } from "@/features/seriesComparison/navigation/SeriesAnalysisNavigation";
import { useSeriesAnalysisLocationState } from "@/features/seriesComparison/navigation/useSeriesAnalysisLocationState";
import { SeriesAnalysisContent } from "@/features/seriesComparison/page/SeriesAnalysisContent";
import { createDeferred } from "@/test/deferred";
import {
  makeFourPlayerSeriesAnalysisReview,
  makeOwnerComparisonAggregate,
  makeSeriesAnalysisOptions,
} from "@/test/msw/seriesAnalysisFixtures";
import { createTestQueryClient } from "@/test/queryClient";
import { selectOption } from "@/test/selectOption";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

const options = makeSeriesAnalysisOptions();
const review = makeFourPlayerSeriesAnalysisReview();
const aggregate = makeOwnerComparisonAggregate();
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
    <SeriesAnalysisNavigation displayIntent={location.displayIntent}>
      <button type="button">別の操作</button>
      <SeriesAnalysisContent
        ownerMetric={location.state.ownerMetric}
        onOwnerMetricChange={location.actions.updateOwnerMetric}
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
    <StrictMode>
      <QueryClientProvider client={createTestQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
  return router;
}

describe("series analysis section navigation", () => {
  it("changes the actual owner select without a new arrival or history entry under Strict Mode", async () => {
    const user = userEvent.setup();
    const router = setup({ url: `${initialUrl}&view=context#metric-play-order` });
    const select = await screen.findByRole("combobox", { name: "オーナー比較の指標" });
    // Arrive by ordinary scrolling rather than by the owner's table-of-contents link.
    await selectOption(user, select, "ginji.average");
    await waitFor(() => expect(router.state.location.hash).toBe("#metric-owner"));
    expect(new URLSearchParams(router.state.location.search).get("ownerMetric")).toBe(
      "ginji.average",
    );
    expect(select).toHaveFocus();
    expect(screen.getAllByText("1.5回/試合")).toHaveLength(4);
    expect(new URLSearchParams(router.state.location.search).get("focusMatchId")).toBe("match-12");
    expect(
      screen
        .getByRole("table", { name: "オーナー別の銀次遭遇回数（1試合平均）" })
        .closest("[inert]"),
    ).toBeNull();
    await selectOption(user, select, "ginji.encounterRate");
    expect(select).toHaveFocus();
    expect(screen.getByRole("table", { name: "オーナー別の銀次遭遇率" })).toHaveTextContent("50%");
    await act(async () => router.navigate(-1));
    expect(screen.getByText("試合一覧")).toBeInTheDocument();
  });

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

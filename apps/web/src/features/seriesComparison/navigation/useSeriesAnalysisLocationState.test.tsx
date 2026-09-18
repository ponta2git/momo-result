import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { useSeriesAnalysisLocationState } from "@/features/seriesComparison/navigation/useSeriesAnalysisLocationState";
import { createDeferred } from "@/test/deferred";
import { makeSeriesAnalysisOptions } from "@/test/msw/seriesAnalysisFixtures";

function LocationStateHarness() {
  const location = useLocation();
  const model = useSeriesAnalysisLocationState(makeSeriesAnalysisOptions());

  return (
    <>
      <output aria-label="normalization notice">{model.normalizationNotice}</output>
      <button
        type="button"
        onClick={() => {
          model.actions.updateOwnerMetric("ginji.average");
          model.actions.updateSeasonMasterId("season_current");
        }}
      >
        指標と条件を連続変更
      </button>
      <button type="button" onClick={() => model.actions.updateGameTitle("gt_momotetsu_2")}>
        作品を変更
      </button>
      <output aria-label="analysis state">{JSON.stringify(model.state)}</output>
      <output aria-label="analysis location">{location.search}</output>
      <button type="button" onClick={() => model.actions.focusMatch("match-12")}>
        試合を選択
      </button>
      <button
        type="button"
        onClick={() => {
          model.actions.updateView("overview");
          model.actions.updateView("drivers");
        }}
      >
        表示を連続変更
      </button>
    </>
  );
}

function renderHarness(url = "/analytics/series?gameTitleId=gt_momotetsu_2&view=flow") {
  const router = createMemoryRouter(
    [{ path: "/analytics/series", element: <LocationStateHarness /> }],
    {
      initialEntries: [
        {
          pathname: "/analytics/series",
          search: url.slice(url.indexOf("?")),
          state: { from: "test" },
        },
      ],
    },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe("useSeriesAnalysisLocationState", () => {
  it("retains the selected match while its URL navigation is pending", async () => {
    const gate = createDeferred();
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [
        {
          path: "/analytics/series",
          hydrateFallbackElement: <p>経路を準備中</p>,
          loader: ({ request }) =>
            new URL(request.url).searchParams.has("focusMatchId") ? gate.promise : null,
          element: <LocationStateHarness />,
        },
      ],
      { initialEntries: ["/analytics/series?gameTitleId=gt_momotetsu_2&view=flow"] },
    );
    render(<RouterProvider router={router} />);
    await screen.findByRole("button", { name: "試合を選択" });

    await user.click(screen.getByRole("button", { name: "試合を選択" }));
    expect(screen.getByLabelText("analysis state")).toHaveTextContent('"focusMatchId":"match-12"');
    expect(router.state.location.search).not.toContain("focusMatchId");

    await act(async () => gate.resolve());
    await waitFor(() => expect(router.state.location.search).toContain("focusMatchId=match-12"));
    expect(screen.getByLabelText("analysis state")).toHaveTextContent('"focusMatchId":"match-12"');
  });

  it("keeps only the latest intent when URL updates are issued rapidly", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole("button", { name: "表示を連続変更" }));

    await waitFor(() =>
      expect(screen.getByLabelText("analysis state")).toHaveTextContent('"view":"drivers"'),
    );
    expect(screen.getByLabelText("analysis location")).toHaveTextContent("view=drivers");
    expect(screen.getByLabelText("analysis state")).not.toHaveTextContent('"view":"overview"');
  });

  it("merges an uncommitted metric change with scope and preserves it across title changes", async () => {
    const user = userEvent.setup();
    const router = renderHarness(
      "/analytics/series?gameTitleId=gt_momotetsu_2&view=context&returnTo=%2Fmatches&focusMatchId=match-12",
    );
    await user.click(screen.getByRole("button", { name: "指標と条件を連続変更" }));
    await waitFor(() =>
      expect(router.state.location.search).toContain("seasonMasterId=season_current"),
    );
    expect(router.state.location.search).toContain("ownerMetric=ginji.average");
    expect(router.state.location.search).toContain("returnTo=%2Fmatches");
    expect(router.state.location.search).not.toContain("focusMatchId");
    expect(router.state.location.hash).toBe("#metric-owner");
    expect(router.state.location.state).toEqual({ from: "test" });
    await user.click(screen.getByRole("button", { name: "作品を変更" }));
    expect(router.state.location.search).toContain("ownerMetric=ginji.average");
    expect(router.state.location.search).not.toContain("seasonMasterId");
  });

  it("canonicalizes an invalid metric once and retains its explanation", async () => {
    const router = renderHarness(
      "/analytics/series?gameTitleId=gt_momotetsu_2&view=context&ownerMetric=unknown",
    );
    await waitFor(() => expect(router.state.location.search).not.toContain("ownerMetric"));
    expect(screen.getByLabelText("normalization notice")).toHaveTextContent(
      "オーナー比較の指標を平均順位に戻しました。",
    );
    expect(screen.getByLabelText("analysis state")).toHaveTextContent(
      '"ownerMetric":"rank.average"',
    );
  });

  it("restores focus intent across browser back and forward traversal", async () => {
    const user = userEvent.setup();
    const router = renderHarness();

    await user.click(screen.getByRole("button", { name: "試合を選択" }));
    await waitFor(() =>
      expect(screen.getByLabelText("analysis location")).toHaveTextContent("focusMatchId=match-12"),
    );

    await act(async () => router.navigate(-1));
    await waitFor(() =>
      expect(screen.getByLabelText("analysis location")).not.toHaveTextContent("focusMatchId"),
    );
    expect(screen.getByLabelText("analysis state")).not.toHaveTextContent("focusMatchId");

    await act(async () => router.navigate(1));
    await waitFor(() =>
      expect(screen.getByLabelText("analysis state")).toHaveTextContent(
        '"focusMatchId":"match-12"',
      ),
    );
    expect(screen.getByLabelText("analysis location")).toHaveTextContent("focusMatchId=match-12");
  });
});

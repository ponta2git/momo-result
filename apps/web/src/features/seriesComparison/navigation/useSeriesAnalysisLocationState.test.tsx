import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { useSeriesAnalysisLocationState } from "@/features/seriesComparison/navigation/useSeriesAnalysisLocationState";
import { makeSeriesAnalysisOptions } from "@/test/msw/seriesAnalysisFixtures";

function LocationStateHarness() {
  const location = useLocation();
  const model = useSeriesAnalysisLocationState(makeSeriesAnalysisOptions());

  return (
    <>
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

function renderHarness() {
  const router = createMemoryRouter(
    [{ path: "/analytics/series", element: <LocationStateHarness /> }],
    {
      initialEntries: ["/analytics/series?gameTitleId=gt_momotetsu_2&view=flow"],
    },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe("useSeriesAnalysisLocationState", () => {
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

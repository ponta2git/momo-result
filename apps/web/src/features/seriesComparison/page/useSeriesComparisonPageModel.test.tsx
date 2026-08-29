import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useEffect } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { useSeriesComparisonPageModel } from "@/features/seriesComparison/page/useSeriesComparisonPageModel";
import { setupMsw } from "@/test/msw/lifecycle";
import { makeSeriesAnalysisExcludedMatchContext } from "@/test/msw/seriesAnalysisFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

function PageModelHarness({
  onFocusChange,
}: {
  onFocusChange: (matchId: string | undefined) => void;
}) {
  const location = useLocation();
  const page = useSeriesComparisonPageModel();

  useEffect(
    () => onFocusChange(page.filters.state.focusMatchId),
    [onFocusChange, page.filters.state.focusMatchId],
  );

  return (
    <>
      <output aria-label="analysis readiness">{page.resource.data ? "ready" : "loading"}</output>
      <output aria-label="analysis location">{location.search}</output>
      <output aria-label="analysis focus">{page.filters.state.focusMatchId ?? ""}</output>
      {page.focus.notice ? <p aria-label="focus notice">{page.focus.notice}</p> : null}
      <button type="button" onClick={() => page.actions.focusMatch("match-excluded")}>
        対象外の試合を選択
      </button>
    </>
  );
}

describe("useSeriesComparisonPageModel", () => {
  it("clears and explains the same excluded focus every time it is selected", async () => {
    const user = userEvent.setup();
    const observedFocusMatches: string[] = [];
    const recordFocus = (matchId: string | undefined) => {
      if (matchId) observedFocusMatches.push(matchId);
    };
    server.use(
      http.get("/api/analytics/series-comparison/v2/match-context", ({ request }) => {
        return HttpResponse.json(
          makeSeriesAnalysisExcludedMatchContext(
            "not_in_scope",
            new URL(request.url).searchParams.get("matchId") ?? "match-excluded",
          ),
        );
      }),
    );
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/analytics/series?gameTitleId=gt_momotetsu_2&view=flow"]}>
          <PageModelHarness onFocusChange={recordFocus} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("analysis readiness")).toHaveTextContent("ready"),
    );

    const selectExcludedMatch = screen.getByRole("button", { name: "対象外の試合を選択" });
    await user.click(selectExcludedMatch);

    await waitFor(() => expect(observedFocusMatches).toEqual(["match-excluded"]));

    expect(await screen.findByLabelText("focus notice")).toHaveTextContent(
      "選択した試合は現在の比較条件に含まれないため、強調表示を解除しました。",
    );
    await waitFor(() =>
      expect(screen.getByLabelText("analysis location")).not.toHaveTextContent("focusMatchId"),
    );

    await user.click(selectExcludedMatch);

    await waitFor(() => expect(observedFocusMatches).toEqual(["match-excluded", "match-excluded"]));

    expect(await screen.findByLabelText("focus notice")).toHaveTextContent(
      "選択した試合は現在の比較条件に含まれないため、強調表示を解除しました。",
    );
    await waitFor(() =>
      expect(screen.getByLabelText("analysis location")).not.toHaveTextContent("focusMatchId"),
    );
    expect(screen.getByLabelText("analysis focus")).toBeEmptyDOMElement();
  });
});

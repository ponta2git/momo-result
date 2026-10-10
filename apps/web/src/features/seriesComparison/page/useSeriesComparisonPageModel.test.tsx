import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useEffect } from "react";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeAll, describe, expect, it } from "vitest";

import {
  adoptOutlookSummary,
  updateOutlookEntry,
} from "@/features/seriesComparison/outlook/outlookSession";
import type { OutlookSession } from "@/features/seriesComparison/outlook/outlookSession";
import {
  OutlookSessionOwner,
  useOutlookSession,
} from "@/features/seriesComparison/outlook/OutlookSessionOwner";
import { useSeriesComparisonPageModel } from "@/features/seriesComparison/page/useSeriesComparisonPageModel";
import { decodeSeriesAnalysisArtifact } from "@/shared/api/seriesAnalysisArtifactDecoder";
import { canonicalResultMemberIds } from "@/shared/domain/members";
import { createDeferred } from "@/test/deferred";
import { setupMsw } from "@/test/msw/lifecycle";
import {
  makeSeriesAnalysisAggregate,
  makeSeriesAnalysisExcludedMatchContext,
  makeSeriesAnalysisOptions,
} from "@/test/msw/seriesAnalysisFixtures";
import { makeSeriesAnalysisOutlookSummary } from "@/test/msw/seriesAnalysisOutlookFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

// Query lifecycle is the oracle here; prepare the large generated validator before timed UI waits.
beforeAll(() => decodeSeriesAnalysisArtifact("aggregateV5", makeSeriesAnalysisAggregate()));

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

function RetainedOutlookHarness({ initial }: { initial: OutlookSession }) {
  const { session, store } = useOutlookSession();
  return (
    <>
      <button type="button" onClick={() => store.update(() => initial)}>
        試算を用意
      </button>
      <output aria-label="retained average input">{session?.entries[0].meanDraft ?? ""}</output>
      <Link to="/analytics/series?gameTitleId=gt_momotetsu_2&view=outlook">同じ比較へ戻る</Link>
      <Link to="/analytics/series?gameTitleId=gt_momotetsu_2&view=outlook&seasonMasterId=season_current">
        シーズンを変更
      </Link>
      <Link to="/analytics/series?gameTitleId=gt_momotetsu_2&view=review">目的だけ変更</Link>
      <Link
        to={`/analytics/series?gameTitleId=gt_momotetsu_2&view=review&focusMemberId=${canonicalResultMemberIds[0]}&rivalMemberId=${canonicalResultMemberIds[2]}`}
      >
        振り返りで人物を変更
      </Link>
    </>
  );
}

describe("useSeriesComparisonPageModel", () => {
  it("preserves input for a purpose change but discards it when the pair changes while outlook is hidden", async () => {
    const user = userEvent.setup();
    const summary = await makeSeriesAnalysisOutlookSummary();
    const adopted = adoptOutlookSummary(undefined, summary, "gt_momotetsu_2||", [
      canonicalResultMemberIds[0],
      canonicalResultMemberIds[1],
    ]);
    if (!adopted) throw new Error("Synthetic fixture must contain the selected people");
    const initial = updateOutlookEntry(adopted, 0, { meanDraft: "2.30" });
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={["/analytics/series?gameTitleId=gt_momotetsu_2&view=outlook"]}
        >
          <OutlookSessionOwner>
            <RetainedOutlookHarness initial={initial} />
            <PageModelHarness onFocusChange={() => undefined} />
          </OutlookSessionOwner>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("analysis readiness")).toHaveTextContent("ready"),
    );
    await user.click(screen.getByRole("button", { name: "試算を用意" }));
    await user.click(screen.getByRole("link", { name: "目的だけ変更" }));
    await waitFor(() =>
      expect(screen.getByLabelText("analysis readiness")).toHaveTextContent("ready"),
    );
    expect(screen.getByLabelText("retained average input")).toHaveTextContent("2.30");
    await user.click(screen.getByRole("link", { name: "振り返りで人物を変更" }));
    await waitFor(() =>
      expect(screen.getByLabelText("retained average input")).toBeEmptyDOMElement(),
    );
    await user.click(screen.getByRole("link", { name: "同じ比較へ戻る" }));
    await waitFor(() =>
      expect(screen.getByLabelText("analysis readiness")).toHaveTextContent("ready"),
    );
    expect(screen.getByLabelText("retained average input")).toBeEmptyDOMElement();
  });

  it("retains the same comparison while uncached options reload, then discards it for a real scope change", async () => {
    const user = userEvent.setup();
    const summary = await makeSeriesAnalysisOutlookSummary();
    const adopted = adoptOutlookSummary(undefined, summary, "gt_momotetsu_2||", [
      canonicalResultMemberIds[0],
      canonicalResultMemberIds[1],
    ]);
    if (!adopted) throw new Error("Synthetic fixture must contain the selected people");
    const initial = updateOutlookEntry(adopted, 0, { meanDraft: "2.30" });
    const optionsGate = createDeferred();
    let optionsRequested = false;
    server.use(
      http.get("/api/analytics/series-comparison/v2/options", async () => {
        optionsRequested = true;
        await optionsGate.promise;
        return HttpResponse.json(makeSeriesAnalysisOptions());
      }),
    );
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches"]}>
          <OutlookSessionOwner>
            <RetainedOutlookHarness initial={initial} />
            <Routes>
              <Route path="/matches" element={<p>戦績を確認中</p>} />
              <Route
                path="/analytics/series"
                element={<PageModelHarness onFocusChange={() => undefined} />}
              />
            </Routes>
          </OutlookSessionOwner>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await user.click(screen.getByRole("button", { name: "試算を用意" }));
    await user.click(screen.getByRole("link", { name: "同じ比較へ戻る" }));
    await waitFor(() => expect(optionsRequested).toBe(true));
    expect(screen.getByLabelText("retained average input")).toHaveTextContent("2.30");
    await act(async () => optionsGate.resolve());
    await waitFor(() =>
      expect(screen.getByLabelText("analysis readiness")).toHaveTextContent("ready"),
    );
    expect(screen.getByLabelText("retained average input")).toHaveTextContent("2.30");
    await user.click(screen.getByRole("link", { name: "シーズンを変更" }));
    await waitFor(() =>
      expect(screen.getByLabelText("retained average input")).toBeEmptyDOMElement(),
    );
  });

  it("clears and explains the same excluded focus every time it is selected", async () => {
    const user = userEvent.setup();
    const observedFocusMatches: string[] = [];
    const recordFocus = (matchId: string | undefined) => {
      if (matchId) observedFocusMatches.push(matchId);
    };
    server.use(
      http.get("/api/analytics/series-comparison/v3/match-context", ({ request }) => {
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

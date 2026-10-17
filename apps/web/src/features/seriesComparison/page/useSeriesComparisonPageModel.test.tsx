import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useEffect, useSyncExternalStore } from "react";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeAll, describe, expect, it } from "vitest";

import {
  OutlookWorkspaceProvider,
  useOutlookWorkspaceStore,
} from "@/features/seriesComparison/outlook/OutlookWorkspaceProvider";
import {
  adoptOutlookSummary,
  updateOutlookEntry,
} from "@/features/seriesComparison/outlook/outlookWorkspaceState";
import type { OutlookWorkspaceState } from "@/features/seriesComparison/outlook/outlookWorkspaceState";
import { useSeriesComparisonPageModel } from "@/features/seriesComparison/page/useSeriesComparisonPageModel";
import { decodeSeriesAnalysisArtifact } from "@/shared/api/seriesAnalysisArtifactDecoder";
import { canonicalResultMemberIds } from "@/shared/domain/members";
import { createDeferred } from "@/test/deferred";
import { setupMsw } from "@/test/msw/lifecycle";
import {
  makeSeriesAnalysisAggregate,
  makeSeriesAnalysisExcludedMatchContext,
  makeSeriesAnalysisOptions,
  makeSeriesAnalysisScopeStatus,
} from "@/test/msw/seriesAnalysisFixtures";
import { makeSeriesAnalysisOutlookSummary } from "@/test/msw/seriesAnalysisOutlookFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

// Query lifecycle is the oracle here; prepare the large generated validator before timed UI waits.
beforeAll(() =>
  Promise.all([
    decodeSeriesAnalysisArtifact("aggregateV5", makeSeriesAnalysisAggregate()),
    decodeSeriesAnalysisArtifact(
      "matchContext",
      makeSeriesAnalysisExcludedMatchContext("not_in_scope"),
    ),
  ]),
);

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

function RetainedOutlookHarness({ initial }: { initial: OutlookWorkspaceState }) {
  const store = useOutlookWorkspaceStore();
  const state = useSyncExternalStore(store.subscribe, store.read);
  return (
    <>
      <button type="button" onClick={() => store.commit(initial)}>
        試算を用意
      </button>
      <output aria-label="retained average input">{state?.entries[0].meanDraft ?? ""}</output>
      <Link to="/analytics/series?gameTitleId=gt_momotetsu_2&view=outlook">同じ比較へ戻る</Link>
      <Link to="/analytics/series?gameTitleId=gt_momotetsu_2&view=outlook&seasonMasterId=season_current">
        シーズンを変更
      </Link>
      <Link to="/analytics/series?gameTitleId=gt_momotetsu_2&view=outlook&seasonMasterId=season_without_matches">
        一覧にないシーズンを指定
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
  it.each([true, false])(
    "keeps the trial while a URL-only scope is unverified and changes it only for a valid new scope: %s",
    async (validIdentity) => {
      const user = userEvent.setup();
      const summary = await makeSeriesAnalysisOutlookSummary();
      const adopted = adoptOutlookSummary(undefined, summary, "gt_momotetsu_2||", [
        canonicalResultMemberIds[0],
        canonicalResultMemberIds[1],
      ]);
      if (!adopted) throw new Error("Synthetic fixture must contain the selected people");
      const initial = updateOutlookEntry(adopted, 0, { meanDraft: "2.30" });
      const identityGate = createDeferred();
      let identityRequested = false;
      server.use(
        http.get("/api/analytics/series-comparison/v2/scope-status", async ({ request }) => {
          const params = new URL(request.url).searchParams;
          const seasonMasterId = params.get("seasonMasterId");
          if (seasonMasterId === "season_without_matches") {
            identityRequested = true;
            await identityGate.promise;
            return HttpResponse.json(
              makeSeriesAnalysisScopeStatus({
                artifactId: params.get("artifactId"),
                seasonMasterId,
                seasonName: validIdentity ? "記録のないシーズン" : null,
                state: validIdentity ? "empty" : "invalid",
                invalidFields: validIdentity ? [] : ["seasonMasterId"],
                currentHasMatches: false,
                publishedHasMatches: false,
              }),
            );
          }
          return HttpResponse.json(
            makeSeriesAnalysisScopeStatus({ artifactId: params.get("artifactId") }),
          );
        }),
      );
      const queryClient = createTestQueryClient();
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter
            initialEntries={["/analytics/series?gameTitleId=gt_momotetsu_2&view=outlook"]}
          >
            <OutlookWorkspaceProvider>
              <RetainedOutlookHarness initial={initial} />
              <PageModelHarness onFocusChange={() => undefined} />
            </OutlookWorkspaceProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      );
      await waitFor(() =>
        expect(screen.getByLabelText("analysis readiness")).toHaveTextContent("ready"),
      );
      await user.click(screen.getByRole("button", { name: "試算を用意" }));
      await user.click(screen.getByRole("link", { name: "一覧にないシーズンを指定" }));
      await waitFor(() => expect(identityRequested).toBe(true));
      expect(screen.getByLabelText("retained average input")).toHaveTextContent("2.30");
      expect(screen.getByLabelText("analysis location")).toHaveTextContent(
        "season_without_matches",
      );
      await act(async () => identityGate.resolve());
      if (validIdentity) {
        await waitFor(() =>
          expect(screen.getByLabelText("retained average input")).toBeEmptyDOMElement(),
        );
        expect(screen.getByLabelText("analysis location")).toHaveTextContent(
          "season_without_matches",
        );
      } else {
        await waitFor(() =>
          expect(screen.getByLabelText("analysis location")).not.toHaveTextContent(
            "seasonMasterId",
          ),
        );
        expect(screen.getByLabelText("retained average input")).toHaveTextContent("2.30");
      }
    },
  );

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
          <OutlookWorkspaceProvider>
            <RetainedOutlookHarness initial={initial} />
            <PageModelHarness onFocusChange={() => undefined} />
          </OutlookWorkspaceProvider>
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
          <OutlookWorkspaceProvider>
            <RetainedOutlookHarness initial={initial} />
            <Routes>
              <Route path="/matches" element={<p>戦績を確認中</p>} />
              <Route
                path="/analytics/series"
                element={<PageModelHarness onFocusChange={() => undefined} />}
              />
            </Routes>
          </OutlookWorkspaceProvider>
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

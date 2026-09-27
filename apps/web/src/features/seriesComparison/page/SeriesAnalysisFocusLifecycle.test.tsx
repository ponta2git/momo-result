import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { SeriesAnalysisUrlState } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import { SeriesAnalysisContent } from "@/features/seriesComparison/page/SeriesAnalysisContent";
import { useSeriesAnalysisResource } from "@/features/seriesComparison/page/useSeriesAnalysisResource";
import { seriesAnalysisKeys } from "@/shared/api/queryKeys";
import { decodeSeriesAnalysisArtifact } from "@/shared/api/seriesAnalysisArtifactDecoder";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { setupMsw } from "@/test/msw/lifecycle";
import {
  analysisArtifact,
  makeFourPlayerSeriesAnalysisMatchContext,
  makeOwnerComparisonAggregate,
} from "@/test/msw/seriesAnalysisFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

beforeAll(() =>
  Promise.all([
    decodeSeriesAnalysisArtifact("aggregateV4", makeOwnerComparisonAggregate()),
    decodeSeriesAnalysisArtifact("matchContext", makeFourPlayerSeriesAnalysisMatchContext()),
  ]),
);

beforeEach(() => {
  setDevUser();
  server.use(
    http.get("/api/analytics/series-comparison/v4/aggregate", () =>
      HttpResponse.json(makeOwnerComparisonAggregate()),
    ),
  );
});

function Harness() {
  const [state, setState] = useState<SeriesAnalysisUrlState>({
    gameTitleId: analysisArtifact.gameTitleId,
    focusMatchId: "match-12",
    view: "context",
  });
  const analysis = useSeriesAnalysisResource({
    activeView: "context",
    state,
    deferredState: state,
  });
  return (
    <>
      <button type="button" onClick={() => setState({ ...state, focusMatchId: "match-13" })}>
        試合Bを選択
      </button>
      <button type="button" onClick={() => setState({ ...state, focusMatchId: "match-12" })}>
        試合Aを選択
      </button>
      <button type="button" onClick={() => setState({ ...state, focusMatchId: undefined })}>
        選択解除
      </button>
      <output aria-label="contextの取得失敗">{String(analysis.focus.hasError)}</output>
      <output aria-label="操作保護">{String(analysis.resource.shielded)}</output>
      {analysis.resource.bundle ? (
        <SeriesAnalysisContent
          bundle={analysis.resource.bundle}
          shielded={analysis.resource.shielded}
          onArtifactExpired={analysis.refresh}
          onClearFocusedMatch={() => setState({ ...state, focusMatchId: undefined })}
          onFocusMatch={(focusMatchId) => setState({ ...state, focusMatchId })}
          onViewChange={() => undefined}
        />
      ) : null}
    </>
  );
}

function mount() {
  const client = createTestQueryClient();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Harness />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

function expectFocus(owner: string, matchIndex: number) {
  expect(screen.getByRole("region", { name: "選択中の試合" })).toHaveTextContent(
    `第${matchIndex}戦`,
  );
  const ownerTable = screen.getByRole("table", { name: "オーナー別の平均順位" });
  expect(
    within(ownerTable).getByRole("columnheader", {
      name: new RegExp(`${owner}.*この試合のオーナー`, "u"),
    }),
  ).toBeInTheDocument();
  const playOrder = screen.getByRole("table", { name: "番手別成績" });
  expect(
    within(playOrder).getByRole("cell", { name: /ぽんた、1番手.*この試合/u }),
  ).toBeInTheDocument();
}

function expectNoFocus() {
  expect(screen.queryByRole("region", { name: "選択中の試合" })).not.toBeInTheDocument();
  expect(screen.queryByText("この試合のオーナー")).not.toBeInTheDocument();
  const playOrder = screen.getByRole("table", { name: "番手別成績" });
  expect(within(playOrder).queryByRole("cell", { name: /この試合/u })).not.toBeInTheDocument();
  expect(within(playOrder).getByRole("cell", { name: /ぽんた、1番手、平均/u })).toBeInTheDocument();
}

function failure(status: number, code: string) {
  return HttpResponse.json(
    {
      type: "about:blank",
      title: "Unavailable",
      detail: "Unavailable",
      status,
      code,
    },
    { status },
  );
}

describe("selected match display lifecycle", () => {
  it.each([
    [404, "NOT_FOUND"],
    [410, "ANALYSIS_ARTIFACT_EXPIRED"],
  ] as const)(
    "keeps transient failures coherent, clears a definitive %s, and restores only on success",
    async (status, code) => {
      let response: "success" | "transient" | "invalid" | "waiting" = "success";
      const recoveryGate = createDeferred();
      server.use(
        http.get("/api/analytics/series-comparison/v3/match-context", async () => {
          if (response === "waiting") await recoveryGate.promise;
          if (response === "transient") return failure(503, "SERVICE_UNAVAILABLE");
          if (response === "invalid") return failure(status, code);
          return HttpResponse.json(
            makeFourPlayerSeriesAnalysisMatchContext({ ownerMemberId: "member_akane_mami" }),
          );
        }),
      );
      const client = mount();
      await waitFor(() => expectFocus("あかねまみ", 12));
      response = "transient";
      await act(async () =>
        client.refetchQueries({ queryKey: seriesAnalysisKeys.matchContextRoot() }),
      );
      await waitFor(() =>
        expect(screen.getByLabelText("contextの取得失敗")).toHaveTextContent("true"),
      );
      expectFocus("あかねまみ", 12);
      response = "invalid";
      await act(async () =>
        client.refetchQueries({ queryKey: seriesAnalysisKeys.matchContextRoot() }),
      );
      await waitFor(() => {
        expectNoFocus();
        expect(client.isFetching()).toBe(0);
      });
      response = "waiting";
      let refetch: Promise<void> | undefined;
      act(() => {
        refetch = client.refetchQueries({ queryKey: seriesAnalysisKeys.matchContextRoot() });
      });
      await waitFor(() => expect(client.isFetching()).toBeGreaterThan(0));
      expectNoFocus();
      await act(async () => {
        recoveryGate.resolve();
        await refetch;
      });
      await waitFor(() => expectFocus("あかねまみ", 12));
    },
  );

  it("shows aggregates without any selected-match markers when the first context read fails", async () => {
    server.use(
      http.get("/api/analytics/series-comparison/v3/match-context", () =>
        failure(503, "SERVICE_UNAVAILABLE"),
      ),
    );
    mount();
    await screen.findByRole("table", { name: "オーナー別の平均順位" });
    await waitFor(() => expectNoFocus());
    expect(screen.getByLabelText("contextの取得失敗")).toHaveTextContent("true");
  });

  it("keeps one protected bundle during a pending selection and ignores its late response after clearing", async () => {
    const user = userEvent.setup();
    const gate = createDeferred();
    let requestedB = false;
    server.use(
      http.get("/api/analytics/series-comparison/v3/match-context", async ({ request }) => {
        const matchId = new URL(request.url).searchParams.get("matchId");
        if (matchId === "match-13") {
          requestedB = true;
          await gate.promise;
          return HttpResponse.json(
            makeFourPlayerSeriesAnalysisMatchContext({
              matchId,
              matchIndex: 13,
              ownerMemberId: "member_akane_mami",
            }),
          );
        }
        return HttpResponse.json(makeFourPlayerSeriesAnalysisMatchContext());
      }),
    );
    const client = mount();
    await waitFor(() => expectFocus("ぽんた", 12));
    await user.click(screen.getByRole("button", { name: "試合Bを選択" }));
    await waitFor(() => expect(requestedB).toBe(true));
    // Protected content is intentionally inert; its visible text still identifies the same match.
    expect(screen.getByText("この試合のオーナー").closest("th")).toHaveTextContent("ぽんた");
    expect(screen.getByLabelText("操作保護")).toHaveTextContent("true");
    await user.click(screen.getByRole("button", { name: "選択解除" }));
    await waitFor(() => expectNoFocus());
    await act(async () => gate.resolve());
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expectNoFocus();
    await user.click(screen.getByRole("button", { name: "試合Bを選択" }));
    await waitFor(() => expectFocus("あかねまみ", 13));
    await user.click(screen.getByRole("button", { name: "試合Aを選択" }));
    await waitFor(() => expectFocus("ぽんた", 12));
  });
});

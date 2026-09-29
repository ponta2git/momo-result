import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PlayerRadarAdministration } from "@/features/seriesAnalysisAdmin/PlayerRadarAdministration";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { setupMsw } from "@/test/msw/lifecycle";
import {
  makePlayerRadarOperation,
  makePlayerRadarPreview,
  makePlayerRadarState,
  makeReadyPlayerRadarState,
} from "@/test/msw/playerRadarFixtures";
import { makeSeriesAnalysisOptions } from "@/test/msw/seriesAnalysisFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";
import { selectOption } from "@/test/selectOption";

setupMsw();
// The timed assertions exercise operation lifecycle after the real wire validators load.
beforeAll(
  () => import("@/shared/api/generatedContracts/series-analysis-radar-validators.generated"),
);
beforeEach(() => setDevUser());

function renderAdministration() {
  const client = createTestQueryClient();
  render(
    <QueryClientProvider client={client}>
      <PlayerRadarAdministration gameTitleId="gt_momotetsu_2" gameTitleName="桃太郎電鉄2" />
    </QueryClientProvider>,
  );
  return client;
}

function readyHandlers() {
  return [
    http.get("/api/admin/series-analysis/radar", () =>
      HttpResponse.json(makeReadyPlayerRadarState()),
    ),
    http.get("/api/admin/series-analysis/radar/preview", () =>
      HttpResponse.json(makePlayerRadarPreview()),
    ),
  ];
}

describe("PlayerRadarAdministration", () => {
  it("keeps accepted candidate work pending until an explicit status refresh", async () => {
    const user = userEvent.setup();
    const initial = makePlayerRadarState();
    initial.eligibility = { matchCount: 40, heldEventCount: 8 };
    const operation = makePlayerRadarOperation("candidate");
    let completed = false;
    let accepted = false;
    let reads = 0;
    server.use(
      http.get("/api/admin/series-analysis/radar", () => {
        reads += 1;
        return HttpResponse.json(
          completed
            ? {
                ...makeReadyPlayerRadarState(),
                operations: [{ ...operation, status: "succeeded" }],
              }
            : { ...initial, operations: accepted ? [operation] : [] },
        );
      }),
      http.get("/api/admin/series-analysis/radar/preview", () =>
        HttpResponse.json(makePlayerRadarPreview()),
      ),
      http.post("/api/admin/series-analysis/radar/operations", async ({ request }) => {
        expect(await request.json()).toEqual({ gameTitleId: "gt_momotetsu_2", kind: "candidate" });
        accepted = true;
        return HttpResponse.json(operation, { status: 202 });
      }),
    );
    const client = renderAdministration();
    await user.click(await screen.findByRole("button", { name: "基準候補を計算する" }));
    expect(await screen.findByText("基準候補の計算を受け付けました")).toBeInTheDocument();
    await waitFor(() => expect(client.isFetching()).toBe(0));
    const acceptedReads = reads;
    completed = true;
    expect(screen.queryByRole("table", { name: "採点基準変更前後の比較" })).not.toBeInTheDocument();
    expect(reads).toBe(acceptedReads);
    await user.click(screen.getByRole("button", { name: "基準の状態を更新" }));
    expect(
      await screen.findByRole("table", { name: "採点基準変更前後の比較" }),
    ).toBeInTheDocument();
    expect(reads).toBeGreaterThan(acceptedReads);
  });

  it("submits the reviewed identities once and preserves the current basis while publication is pending", async () => {
    const user = userEvent.setup();
    const submitted: unknown[] = [];
    server.use(
      ...readyHandlers(),
      http.post("/api/admin/series-analysis/radar/operations", async ({ request }) => {
        submitted.push(await request.json());
        return HttpResponse.json(makePlayerRadarOperation(), { status: 202 });
      }),
    );
    renderAdministration();
    await screen.findByRole("table", { name: "採点基準変更前後の比較" });
    await user.click(screen.getByRole("button", { name: "適用を確認する" }));
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "作品全体に適用する" }));
    expect(await screen.findByText("基準の適用を受け付けました")).toBeInTheDocument();
    expect(submitted).toEqual([
      {
        gameTitleId: "gt_momotetsu_2",
        kind: "apply",
        candidateId: "radar-candidate",
        previewId: "radar-preview",
        expectedCurrentBasisId: "radar-basis-current",
      },
    ]);
    expect(screen.getByRole("region", { name: "適用中の基準" })).toHaveTextContent(
      "2026/09/01 09:01",
    );
    expect(screen.getByRole("button", { name: "適用を確認する" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "適用を取り下げる" })).toBeEnabled();
  });

  it("recovers a lost response with the same idempotency key instead of issuing a new operation", async () => {
    const user = userEvent.setup();
    const state = makePlayerRadarState();
    state.eligibility = { matchCount: 40, heldEventCount: 8 };
    const keys: Array<string | null> = [];
    server.use(
      http.get("/api/admin/series-analysis/radar", () => HttpResponse.json(state)),
      http.post("/api/admin/series-analysis/radar/operations", ({ request }) => {
        keys.push(request.headers.get("Idempotency-Key"));
        return keys.length === 1
          ? HttpResponse.error()
          : HttpResponse.json(makePlayerRadarOperation("candidate"), { status: 202 });
      }),
    );
    renderAdministration();
    await user.click(await screen.findByRole("button", { name: "基準候補を計算する" }));
    expect(await screen.findByText("操作の受付結果をまだ確認できません")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "基準候補を計算する" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "操作の状態を確認する" }));
    expect(await screen.findByText("基準候補の計算を受け付けました")).toBeInTheDocument();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  it("acknowledges accepted publication before a slow status refresh finishes", async () => {
    const user = userEvent.setup();
    const refreshGate = createDeferred();
    let stateReads = 0;
    server.use(
      http.get("/api/admin/series-analysis/radar", async () => {
        stateReads += 1;
        if (stateReads > 1) await refreshGate.promise;
        return HttpResponse.json(makeReadyPlayerRadarState());
      }),
      http.get("/api/admin/series-analysis/radar/preview", () =>
        HttpResponse.json(makePlayerRadarPreview()),
      ),
      http.post("/api/admin/series-analysis/radar/operations", () =>
        HttpResponse.json(makePlayerRadarOperation(), { status: 202 }),
      ),
    );
    renderAdministration();
    await screen.findByRole("table", { name: "採点基準変更前後の比較" });
    await user.click(screen.getByRole("button", { name: "適用を確認する" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "作品全体に適用する" }),
    );
    expect(await screen.findByText("基準の適用を受け付けました")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("region", { name: "適用中の基準" })).toHaveTextContent(
      "2026/09/01 09:01",
    );
    refreshGate.resolve();
  });

  it("requires refresh after an apply conflict and exposes stale comparison rebuilding", async () => {
    const user = userEvent.setup();
    let stale = false;
    server.use(
      http.get("/api/admin/series-analysis/radar", () =>
        HttpResponse.json(makeReadyPlayerRadarState()),
      ),
      http.get("/api/admin/series-analysis/radar/preview", () =>
        HttpResponse.json({ ...makePlayerRadarPreview(), status: stale ? "stale" : "ready" }),
      ),
      http.post("/api/admin/series-analysis/radar/operations", () => {
        stale = true;
        return HttpResponse.json(
          {
            type: "about:blank",
            title: "Conflict",
            detail: "Preview changed",
            status: 409,
            code: "CONFLICT",
          },
          { status: 409 },
        );
      }),
    );
    renderAdministration();
    await screen.findByRole("table", { name: "採点基準変更前後の比較" });
    await user.click(screen.getByRole("button", { name: "適用を確認する" }));
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "作品全体に適用する" }));
    expect(await within(dialog).findByText(/基準の状態を更新.*最新の比較/u)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "作品全体に適用する" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "キャンセル" }));
    await user.click(screen.getByRole("button", { name: "基準の状態を更新" }));
    expect(await screen.findByRole("button", { name: "最新の記録で比較を計算する" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "適用を確認する" })).toBeDisabled();
  });

  it("removes old values while a new scope loads and keeps an empty map selected", async () => {
    const user = userEvent.setup();
    const gate = createDeferred();
    let mapMissingFromDirectory = false;
    server.use(
      http.get("/api/analytics/series-comparison/v2/options", () => {
        const options = makeSeriesAnalysisOptions();
        if (mapMissingFromDirectory)
          options.titles.forEach((title) => {
            title.maps = [];
            title.seasonMapPairs = [];
          });
        return HttpResponse.json(options);
      }),
      http.get("/api/admin/series-analysis/radar/preview", async ({ request }) => {
        const preview = makePlayerRadarPreview();
        if (!new URL(request.url).searchParams.has("mapMasterId"))
          return HttpResponse.json(preview);
        await gate.promise;
        return HttpResponse.json({
          ...preview,
          scope: {
            ...preview.scope,
            kind: "map",
            key: "map:map_east",
            mapMasterId: "map_east",
            state: "empty",
          },
          before: null,
          after: null,
        });
      }),
      ...readyHandlers(),
    );
    renderAdministration();
    await screen.findByRole("table", { name: "採点基準変更前後の比較" });
    await selectOption(user, screen.getByRole("combobox", { name: "比較するマップ" }), "map_east");
    expect(screen.queryByRole("table", { name: "採点基準変更前後の比較" })).not.toBeInTheDocument();
    gate.resolve();
    expect(await screen.findByText("この条件に対象試合はありません")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "比較するマップ" })).toHaveTextContent("東日本編");
    mapMissingFromDirectory = true;
    await user.click(screen.getByRole("button", { name: "基準の状態を更新" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "基準の状態を更新" })).toBeEnabled(),
    );
    expect(screen.getByRole("combobox", { name: "比較するマップ" })).toHaveTextContent("東日本編");
    await user.click(screen.getByRole("button", { name: "全期間・全マップで比較する" }));
    expect(
      await screen.findByRole("table", { name: "採点基準変更前後の比較" }),
    ).toBeInTheDocument();
  });
});

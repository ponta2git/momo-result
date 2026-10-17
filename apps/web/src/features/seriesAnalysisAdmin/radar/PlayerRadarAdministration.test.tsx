import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PlayerRadarAdministration } from "@/features/seriesAnalysisAdmin/radar/PlayerRadarAdministration";
import { seriesPlayerRadarKeys } from "@/shared/api/queryKeys";
import { getAuthorization } from "@/shared/auth/authorization";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { mswState } from "@/test/msw/fixtures";
import { setupMsw } from "@/test/msw/lifecycle";
import {
  makePlayerRadarBasis,
  makePlayerRadarOperation,
  makePlayerRadarPreview,
  makePlayerRadarState,
  makeReadyPlayerRadarState,
} from "@/test/msw/playerRadarFixtures";
import {
  makeSeriesAnalysisOptions,
  makeSeriesAnalysisScopeStatus,
} from "@/test/msw/seriesAnalysisFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";
import { selectOption } from "@/test/selectOption";

setupMsw();
// The timed assertions exercise operation lifecycle after the real wire validators load.
beforeAll(
  () => import("@/shared/api/generatedContracts/series-analysis-radar-validators.generated"),
);
beforeEach(() => {
  setDevUser();
  const account = mswState.loginAccounts.find((entry) => entry.accountId === "account_ponta");
  if (!account) throw new Error("Expected the authenticated account fixture");
  account.role = "operator";
  delete account.playerMemberId;
});

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

async function enterProposal(user: ReturnType<typeof userEvent.setup>) {
  const edit = await screen.findByRole("button", { name: "変更案を編集" });
  await waitFor(() => expect(edit).toBeEnabled());
  await user.click(edit);
}

async function openProposalApply(user: ReturnType<typeof userEvent.setup>) {
  await enterProposal(user);
  await user.click(screen.getByRole("button", { name: "変更を適用" }));
  const dialog = screen.getByRole("alertdialog");
  await waitFor(() =>
    expect(within(dialog).getByRole("button", { name: "作品全体に適用する" })).toBeEnabled(),
  );
  return dialog;
}

describe("PlayerRadarAdministration", () => {
  it("retries a failed operation as an operator with its saved origin identity", async () => {
    const user = userEvent.setup();
    const state = makeReadyPlayerRadarState();
    const failed = {
      ...makePlayerRadarOperation("candidate"),
      operationId: "failed-candidate-operation",
      status: "failed" as const,
      safeFailureCode: "calculation_failed",
    };
    state.candidate!.status = "failed";
    state.operations = [failed];
    const submitted: unknown[] = [];
    server.use(
      http.get("/api/admin/series-analysis/radar", () => HttpResponse.json(state)),
      ...readyHandlers(),
      http.post("/api/admin/series-analysis/radar/operations", async ({ request }) => {
        submitted.push(await request.json());
        expect(request.headers.get("X-Momo-Account-Id")).toBe("account_ponta");
        expect(request.headers.get("Idempotency-Key")).toBeTruthy();
        return HttpResponse.json(
          {
            ...makePlayerRadarOperation("retry"),
            operationId: "retried-candidate-operation",
            originOperationId: failed.operationId,
          },
          { status: 202 },
        );
      }),
    );
    renderAdministration();
    await user.click(await screen.findByRole("button", { name: "この処理を再試行する" }));
    expect(await screen.findByText("再試行を受け付けました")).toBeInTheDocument();
    expect(submitted).toEqual([
      {
        gameTitleId: "gt_momotetsu_2",
        kind: "retry",
        originOperationId: failed.operationId,
      },
    ]);
  });

  it("continues the current basis with the reviewed evidence as an operator", async () => {
    const user = userEvent.setup();
    const state = makeReadyPlayerRadarState();
    state.candidate = null;
    const evidenceKey = `sha256:${"a".repeat(64)}`;
    state.monitor = {
      completedWindowCount: 0,
      evaluatedHeldEventCount: 0,
      evaluatedMatchCount: 0,
      latestWindows: [],
      pendingMatchCount: 0,
      postSourceMatchCount: 0,
      reasons: [
        { axisIds: [], evidenceChecksum: evidenceKey, kind: "source_changed", mapMasterIds: [] },
      ],
      status: "insufficient_matches",
    };
    const submitted: unknown[] = [];
    server.use(
      http.get("/api/admin/series-analysis/radar", () => HttpResponse.json(state)),
      http.post("/api/admin/series-analysis/radar/operations", async ({ request }) => {
        submitted.push(await request.json());
        state.acknowledgedEvidenceKeys = [evidenceKey];
        return HttpResponse.json(
          {
            ...makePlayerRadarOperation("acknowledge"),
            status: "succeeded",
            candidateId: null,
            previewId: null,
            basisId: null,
            finishedAt: "2026-09-02T00:01:00Z",
          },
          { status: 202 },
        );
      }),
    );
    renderAdministration();
    const currentBasis = await screen.findByRole("table", { name: "適用中の採点境界" });
    const currentValues = currentBasis.textContent;
    await user.click(screen.getByRole("button", { name: "この目安を確認し、基準を継続" }));
    expect(await screen.findByText("現在の基準を継続")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "適用中の採点境界" }).textContent).toBe(currentValues);
    expect(submitted).toEqual([
      { gameTitleId: "gt_momotetsu_2", kind: "acknowledge", evidenceKey },
    ]);
  });

  it.each([
    ["最新の記録から作り直す", "candidate"],
    ["前回の基準に戻す", "restore"],
  ] as const)(
    "opens its completed proposal from %s for editing without applying it",
    async (method, kind) => {
      const user = userEvent.setup();
      const state = makeReadyPlayerRadarState();
      state.candidate = null;
      state.previousBasis = { ...makePlayerRadarBasis(), basisId: "radar-basis-previous" };
      const operation = makePlayerRadarOperation(kind);
      const submitted: unknown[] = [];
      server.use(
        http.get("/api/admin/series-analysis/radar", () => HttpResponse.json(state)),
        http.get("/api/admin/series-analysis/radar/operation", () =>
          HttpResponse.json(state.operations[0] ?? operation),
        ),
        http.get("/api/admin/series-analysis/radar/preview", () =>
          HttpResponse.json(makePlayerRadarPreview()),
        ),
        http.post("/api/admin/series-analysis/radar/operations", async ({ request }) => {
          submitted.push(await request.json());
          state.operations = [operation];
          return HttpResponse.json(operation, { status: 202 });
        }),
      );
      renderAdministration();
      const boundaries = await screen.findByRole("table", { name: "適用中の採点境界" });
      const appliedValues = boundaries.textContent;
      await user.click(screen.getByRole("radio", { name: method }));
      expect(submitted).toEqual([]);
      await user.click(
        screen.getByRole("button", {
          name: kind === "restore" ? "前回の基準から復元" : "最新の記録から作成",
        }),
      );
      await waitFor(() =>
        expect(submitted).toEqual([
          {
            gameTitleId: "gt_momotetsu_2",
            kind,
            ...(kind === "restore" ? { expectedCurrentBasisId: "radar-basis-current" } : {}),
          },
        ]),
      );
      expect(boundaries.textContent).toBe(appliedValues);
      expect(screen.getByRole("dialog", { name: "変更案を作成しています" })).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "この変更案を適用する" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "採点境界の編集" })).not.toBeInTheDocument();
      state.candidate = makeReadyPlayerRadarState().candidate;
      state.operations = [{ ...operation, status: "succeeded" }];
      expect(
        await screen.findByRole("region", { name: "採点境界の編集" }, { timeout: 4000 }),
      ).toBeVisible();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "平均順位 10点の境界（位以下）" })).toHaveValue(
        "1",
      );
      expect(submitted).toHaveLength(1);
    },
  );

  it("opens the proposal boundaries in the editor before a score comparison exists", async () => {
    const user = userEvent.setup();
    const state = makeReadyPlayerRadarState();
    state.candidate!.latestPreview = null;
    server.use(http.get("/api/admin/series-analysis/radar", () => HttpResponse.json(state)));
    renderAdministration();
    expect(await screen.findByRole("table", { name: "適用中の採点境界" })).toBeVisible();
    expect(screen.queryByRole("table", { name: "採点境界の変更案" })).not.toBeInTheDocument();
    await enterProposal(user);
    expect(screen.getByRole("textbox", { name: "平均順位 10点の境界（位以下）" })).toHaveValue("1");
    expect(screen.getByRole("button", { name: "変更を適用" })).toBeEnabled();
  });

  it("polls only its accepted creation and opens the editor when it completes", async () => {
    const user = userEvent.setup();
    const initial = makePlayerRadarState();
    initial.eligibility = { matchCount: 40, heldEventCount: 8 };
    const operation = makePlayerRadarOperation("candidate");
    let completed = false;
    let accepted = false;
    let reads = 0;
    let operationReads = 0;
    server.use(
      http.get("/api/admin/series-analysis/radar/operation", ({ request }) => {
        expect(new URL(request.url).searchParams.get("operationId")).toBe(operation.operationId);
        operationReads += 1;
        return HttpResponse.json({ ...operation, status: completed ? "succeeded" : "running" });
      }),
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
    await user.click(await screen.findByRole("button", { name: "最新の記録から作成" }));
    expect(await screen.findByRole("dialog", { name: "変更案を作成しています" })).toBeVisible();
    await waitFor(() => expect(client.isFetching()).toBe(0));
    const acceptedReads = reads;
    completed = true;
    expect(screen.queryByRole("table", { name: "採点基準変更前後の比較" })).not.toBeInTheDocument();
    expect(reads).toBe(acceptedReads);
    expect(
      await screen.findByRole("region", { name: "採点境界の編集" }, { timeout: 4000 }),
    ).toBeVisible();
    expect(
      await screen.findByRole("table", { name: "採点基準変更前後の比較" }),
    ).toBeInTheDocument();
    expect(reads).toBeGreaterThan(acceptedReads);
    expect(operationReads).toBeGreaterThan(1);
  });

  it("closes creation progress on a read error and recovers without submitting another creation", async () => {
    const user = userEvent.setup();
    const gate = createDeferred();
    const state = makePlayerRadarState();
    state.eligibility = { matchCount: 40, heldEventCount: 8 };
    const operation = makePlayerRadarOperation("candidate");
    let reads = 0;
    let submissions = 0;
    server.use(
      http.get("/api/admin/series-analysis/radar", () => HttpResponse.json(state)),
      http.get("/api/admin/series-analysis/radar/preview", () =>
        HttpResponse.json(makePlayerRadarPreview()),
      ),
      http.post("/api/admin/series-analysis/radar/operations", () => {
        submissions += 1;
        state.operations = [operation];
        return HttpResponse.json(operation, { status: 202 });
      }),
      http.get("/api/admin/series-analysis/radar/operation", async () => {
        reads += 1;
        if (reads === 1) {
          await gate.promise;
          return HttpResponse.error();
        }
        state.candidate = makeReadyPlayerRadarState().candidate;
        state.operations = [{ ...operation, status: "succeeded" }];
        return HttpResponse.json(state.operations[0]);
      }),
    );
    renderAdministration();
    await user.click(await screen.findByRole("button", { name: "最新の記録から作成" }));
    expect(await screen.findByRole("dialog", { name: "変更案を作成しています" })).toBeVisible();
    gate.resolve();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("region", { name: "採点境界の編集" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "基準の状態を更新" }));
    expect(await screen.findByRole("region", { name: "採点境界の編集" })).toBeVisible();
    expect(submissions).toBe(1);
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
    await openProposalApply(user);
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
    expect(screen.getByRole("region", { name: "採点境界" })).toHaveTextContent("2026/09/01 09:01");
    expect(screen.queryByRole("button", { name: "この変更案を適用する" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "適用を取り下げる" })).toBeEnabled();
  });

  it("recovers a lost response with the same idempotency key instead of issuing a new operation", async () => {
    const user = userEvent.setup();
    const state = makePlayerRadarState();
    state.eligibility = { matchCount: 40, heldEventCount: 8 };
    const keys: Array<string | null> = [];
    server.use(
      http.get("/api/admin/series-analysis/radar/operation", () =>
        HttpResponse.json(makePlayerRadarOperation("candidate")),
      ),
      http.get("/api/admin/series-analysis/radar", () => HttpResponse.json(state)),
      http.post("/api/admin/series-analysis/radar/operations", ({ request }) => {
        keys.push(request.headers.get("Idempotency-Key"));
        return keys.length === 1
          ? HttpResponse.error()
          : HttpResponse.json(makePlayerRadarOperation("candidate"), { status: 202 });
      }),
    );
    const client = renderAdministration();
    await user.click(await screen.findByRole("button", { name: "最新の記録から作成" }));
    expect(await screen.findByText("操作の受付結果をまだ確認できません")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "最新の記録から作成" })).toBeDisabled();
    await act(() => getAuthorization(client, "account_ponta").recheck());
    expect(screen.getByText("操作の受付結果をまだ確認できません")).toBeInTheDocument();
    expect(keys).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "操作の状態を確認する" }));
    expect(await screen.findByText("変更案の作成を受け付けました")).toBeInTheDocument();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  it("does not recreate protected caches or follow-up reads when a revoked command finishes late", async () => {
    const user = userEvent.setup();
    const commandGate = createDeferred();
    const state = makePlayerRadarState();
    state.eligibility = { matchCount: 40, heldEventCount: 8 };
    const operation = {
      ...makePlayerRadarOperation("candidate"),
      operationId: "late-revoked-operation",
    };
    let stateReads = 0;
    let commands = 0;
    server.use(
      http.get("/api/admin/series-analysis/radar", () => {
        stateReads += 1;
        return HttpResponse.json(state);
      }),
      http.post("/api/admin/series-analysis/radar/operations", async () => {
        commands += 1;
        await commandGate.promise;
        return HttpResponse.json(operation, { status: 202 });
      }),
    );
    const client = renderAdministration();
    await user.click(await screen.findByRole("button", { name: "最新の記録から作成" }));
    await waitFor(() => expect(commands).toBe(1));
    const account = mswState.loginAccounts.find((entry) => entry.accountId === "account_ponta")!;
    account.role = "user";
    await act(() => getAuthorization(client, "account_ponta").recheck());
    const readsAfterRevocation = stateReads;
    await act(async () => commandGate.resolve());
    await waitFor(() =>
      expect(
        client
          .getMutationCache()
          .getAll()
          .some(
            (mutation) =>
              (mutation.state.data as { operationId?: string } | undefined)?.operationId ===
              operation.operationId,
          ),
      ).toBe(true),
    );
    expect(
      client.getQueryData(seriesPlayerRadarKeys.operation("gt_momotetsu_2", operation.operationId)),
    ).toBeUndefined();
    expect(client.getQueryData(seriesPlayerRadarKeys.state("gt_momotetsu_2"))).toBeUndefined();
    expect(screen.queryByText("変更案の作成を受け付けました")).not.toBeInTheDocument();
    expect(stateReads).toBe(readsAfterRevocation);
    expect(commands).toBe(1);
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
    await openProposalApply(user);
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "作品全体に適用する" }),
    );
    expect(await screen.findByText("基準の適用を受け付けました")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("region", { name: "採点境界" })).toHaveTextContent("2026/09/01 09:01");
    refreshGate.resolve();
  });

  it("requires refresh after an apply conflict and exposes stale comparison rebuilding", async () => {
    const user = userEvent.setup();
    let stale = false;
    const commands: string[] = [];
    server.use(
      http.get("/api/admin/series-analysis/radar", () =>
        HttpResponse.json(makeReadyPlayerRadarState()),
      ),
      http.get("/api/admin/series-analysis/radar/preview", () =>
        HttpResponse.json({ ...makePlayerRadarPreview(), status: stale ? "stale" : "ready" }),
      ),
      http.post("/api/admin/series-analysis/radar/operations", async ({ request }) => {
        const { kind } = (await request.json()) as { kind: string };
        commands.push(kind);
        if (kind === "preview")
          return HttpResponse.json(makePlayerRadarOperation("preview"), { status: 202 });
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
    await openProposalApply(user);
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "作品全体に適用する" }));
    expect(await within(dialog).findByText(/基準の状態を更新.*最新の比較/u)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "作品全体に適用する" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "キャンセル" }));
    await user.click(screen.getByRole("button", { name: "基準の状態を更新" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "変更を適用" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "変更を適用" }));
    await waitFor(() => expect(commands).toEqual(["apply", "preview"]));
    expect(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "作品全体に適用する" }),
    ).toBeDisabled();
    expect(screen.queryByRole("button", { name: "この変更案を適用する" })).not.toBeInTheDocument();
  });

  it("removes old values while a new scope loads and keeps an empty map selected", async () => {
    const user = userEvent.setup();
    const gate = createDeferred();
    let mapMissingFromDirectory = false;
    server.use(
      http.get("/api/analytics/series-comparison/v2/scope-status", ({ request }) => {
        const params = new URL(request.url).searchParams;
        const mapMasterId = params.get("mapMasterId");
        return HttpResponse.json(
          makeSeriesAnalysisScopeStatus({
            gameTitleId: params.get("gameTitleId")!,
            artifactId: params.get("artifactId"),
            mapMasterId,
            mapName: mapMasterId ? "東日本編" : null,
            state: mapMasterId ? "empty" : "available",
            currentHasMatches: !mapMasterId,
            publishedHasMatches: !mapMasterId,
          }),
        );
      }),
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
    await enterProposal(user);
    await screen.findByRole("table", { name: "採点基準変更前後の比較" });
    await selectOption(user, screen.getByRole("combobox", { name: "比較するマップ" }), "map_east");
    expect(screen.queryByRole("table", { name: "採点基準変更前後の比較" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "平均順位 10点の境界（位以下）" })).toHaveValue("1");
    gate.resolve();
    expect(await screen.findByText(/この比較条件に対象試合はありません/u)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "平均順位 10点の境界（位以下）" })).toHaveValue("1");
    expect(screen.getByRole("combobox", { name: "比較するマップ" })).toHaveTextContent("東日本編");
    mapMissingFromDirectory = true;
    await user.click(await screen.findByRole("button", { name: "基準の状態を更新" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "基準の状態を更新" })).toBeEnabled(),
    );
    expect(screen.getByRole("combobox", { name: "比較するマップ" })).toHaveTextContent("東日本編");
    await selectOption(user, screen.getByRole("combobox", { name: "比較するマップ" }), "");
    expect(
      await screen.findByRole("table", { name: "採点基準変更前後の比較" }),
    ).toBeInTheDocument();
  });
});

import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeAll, describe, expect, it } from "vitest";

import { AchievementsPage } from "@/features/achievements/AchievementsPage";
import type {
  AddMatchAchievementsRequest,
  CorrectAchievementClaimRequest,
} from "@/shared/api/achievements";
import { decodeSeriesAnalysisArtifact } from "@/shared/api/seriesAnalysisArtifactDecoder";
import { decodeSeriesAnalysisStatus } from "@/shared/api/seriesAnalysisEnvelopeSchemas";
import { setDevUser } from "@/test/auth";
import {
  makeAchievementCatalog,
  makeAchievementClaim,
  makeAchievementItem,
  makeAchievementResource,
  makeAchievedResource,
} from "@/test/msw/achievementFixtures";
import { setupMsw } from "@/test/msw/lifecycle";
import { makeSeriesAnalysisStatus } from "@/test/msw/seriesAnalysisFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";
import { selectOption } from "@/test/selectOption";

setupMsw();
beforeAll(() =>
  Promise.all([
    decodeSeriesAnalysisArtifact("achievements", makeAchievedResource()),
    decodeSeriesAnalysisStatus(makeSeriesAnalysisStatus()),
  ]),
);

function renderPage(entry = "/achievements?gameTitleId=gt_momotetsu_2") {
  setDevUser();
  const client = createTestQueryClient();
  const router = createMemoryRouter(
    [
      { path: "/achievements", element: <AchievementsPage /> },
      { path: "/matches/:matchId", element: <p>根拠の試合</p> },
    ],
    { initialEntries: [entry] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { client, router };
}

function installRecords() {
  const catalog = makeAchievementCatalog({
    items: [makeAchievementItem()],
    claims: [makeAchievementClaim()],
  });
  server.use(
    http.get("/api/achievements/catalog", () => HttpResponse.json(catalog)),
    http.get("/api/achievements", () => HttpResponse.json(makeAchievedResource())),
  );
  return catalog;
}

function installUnrecordedManualItem() {
  const item = makeAchievementItem({ version: "5" });
  const catalog = makeAchievementCatalog({ items: [item] });
  const resource = makeAchievedResource();
  resource.items[0]!.players.forEach((player) => {
    player.status = "not_recorded";
    player.dateUnknown = false;
    player.proofs = [];
  });
  resource.summaries.forEach((summary) => {
    summary.players.forEach((player) => {
      player.earnedPoints = 0;
      player.score = 1;
    });
  });
  const identity = {
    matchId: "match-1",
    gameTitleId: item.gameTitleId,
    mapMasterId: "map_east",
    version: "7",
    matchNoInEvent: 1,
    playedAt: "2026-04-04T12:34:56.000Z",
    gameTitleName: "桃太郎電鉄2",
    seasonName: "今シーズン",
  };
  server.use(
    http.get("/api/achievements/catalog", () => HttpResponse.json(catalog)),
    http.get("/api/achievements", () => HttpResponse.json(resource)),
    http.get("/api/matches/match-1/identity", () => HttpResponse.json(identity)),
  );
  return { item, catalog, identity };
}

async function openPlayerRecord(
  user: ReturnType<typeof userEvent.setup>,
  itemName = "手入力のテスト実績",
) {
  await user.click(await screen.findByRole("button", { name: `${itemName}の記録を見る` }));
  const details = await screen.findByRole("dialog", { name: itemName });
  await user.click(within(details).getByRole("tab", { name: "ぽんた" }));
  return details;
}

async function openCorrection(user: ReturnType<typeof userEvent.setup>) {
  const details = await openPlayerRecord(user);
  await user.click(within(details).getByRole("button", { name: "記録を直す" }));
  await user.click(
    within(details).getByRole("button", { name: "試合で入力した記録：日時・試合・達成を直す" }),
  );
  return screen.findByRole("dialog", { name: "手入力のテスト実績・ぽんたの記録を訂正" });
}

describe("AchievementsPage", () => {
  it.each([
    { notes: "カードを1回使ったときの枚数。\n別々の試合は合算しません。", present: true },
    { notes: " \n ", present: false },
  ])(
    "shows supplied notes with a label and omits empty notes ($present)",
    async ({ notes, present }) => {
      const user = userEvent.setup();
      const catalog = installRecords();
      catalog.items[0]!.notes = notes;
      const resource = makeAchievedResource();
      resource.items[0]!.notes = notes;
      server.use(http.get("/api/achievements", () => HttpResponse.json(resource)));
      renderPage();
      const details = await openPlayerRecord(user);
      if (present) {
        expect(within(details).getByText("備考")).toBeVisible();
        expect(within(details).getByText(/カードを1回使ったときの枚数。/u)).toHaveTextContent(
          "別々の試合は合算しません。",
        );
      } else {
        expect(within(details).queryByText("備考")).not.toBeInTheDocument();
      }
    },
  );

  it("records an unrecorded manual achievement against the selected match with exact versions and returns to the same player", async () => {
    const user = userEvent.setup();
    const { item, catalog, identity } = installUnrecordedManualItem();
    const submitted: AddMatchAchievementsRequest[] = [];
    server.use(
      http.post("/api/matches/match-1/achievements", async ({ request }) => {
        submitted.push((await request.json()) as AddMatchAchievementsRequest);
        catalog.claims.push(
          makeAchievementClaim({ matchId: identity.matchId, achievedAt: identity.playedAt }),
        );
        return HttpResponse.json({ saved: true });
      }),
    );
    const { router } = renderPage();
    const details = await openPlayerRecord(user);
    await user.click(within(details).getByRole("button", { name: "達成を記録する" }));
    const editor = await screen.findByRole("dialog", {
      name: `${item.name}・ぽんたの達成を記録`,
    });
    expect(within(editor).getByRole("button", { name: "達成を保存" })).toBeDisabled();
    await user.click(await within(editor).findByRole("button", { name: "この試合を選ぶ" }));
    await waitFor(() =>
      expect(within(editor).getByRole("button", { name: "達成を保存" })).toBeEnabled(),
    );
    await user.click(within(editor).getByRole("button", { name: "達成を保存" }));
    await waitFor(() =>
      expect(submitted).toEqual([
        {
          expectedMatchVersion: "7",
          achievements: [
            {
              achievementId: item.achievementId,
              memberId: "member_ponta",
              expectedItemVersion: "5",
              expectedClaimVersion: null,
            },
          ],
        },
      ]),
    );
    const returnedDetails = await screen.findByRole("dialog", { name: item.name });
    expect(within(returnedDetails).getByRole("tab", { name: "ぽんた" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(new URLSearchParams(router.state.location.search).get("achievementId")).toBe(
      item.achievementId,
    );
    expect(new URLSearchParams(router.state.location.search).get("memberId")).toBe("member_ponta");
    expect(
      await within(returnedDetails).findByRole("button", { name: "記録を直す" }),
    ).toBeVisible();
    expect(
      within(returnedDetails).queryByRole("button", { name: "達成を記録する" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the selected match after a registration conflict and requires an explicit refresh before saving updated versions", async () => {
    const user = userEvent.setup();
    const { item, catalog, identity } = installUnrecordedManualItem();
    const submitted: AddMatchAchievementsRequest[] = [];
    server.use(
      http.post("/api/matches/match-1/achievements", async ({ request }) => {
        submitted.push((await request.json()) as AddMatchAchievementsRequest);
        if (submitted.length === 1) {
          catalog.items[0] = { ...item, version: "6" };
          identity.version = "8";
          return HttpResponse.json(
            {
              type: "about:blank",
              title: "Conflict",
              status: 409,
              code: "CONFLICT",
              detail: "実績または試合が更新されました。",
            },
            { status: 409 },
          );
        }
        catalog.claims.push(
          makeAchievementClaim({ matchId: identity.matchId, achievedAt: identity.playedAt }),
        );
        return HttpResponse.json({ saved: true });
      }),
    );
    renderPage();
    const details = await openPlayerRecord(user);
    await user.click(within(details).getByRole("button", { name: "達成を記録する" }));
    const editor = await screen.findByRole("dialog", {
      name: `${item.name}・ぽんたの達成を記録`,
    });
    await user.click(await within(editor).findByRole("button", { name: "この試合を選ぶ" }));
    await waitFor(() =>
      expect(within(editor).getByRole("button", { name: "達成を保存" })).toBeEnabled(),
    );
    const selectedMatch = within(editor).getByLabelText("選択した試合").textContent;
    await user.click(within(editor).getByRole("button", { name: "達成を保存" }));
    expect(await within(editor).findByText("実績または試合が更新されています")).toBeVisible();
    expect(within(editor).getByLabelText("選択した試合").textContent).toBe(selectedMatch);
    expect(within(editor).getByRole("button", { name: "達成を保存" })).toBeDisabled();
    expect(submitted).toHaveLength(1);
    await user.click(within(editor).getByRole("button", { name: "最新内容を読み込む" }));
    await waitFor(() =>
      expect(within(editor).getByRole("button", { name: "達成を保存" })).toBeEnabled(),
    );
    expect(within(editor).getByLabelText("選択した試合").textContent).toBe(selectedMatch);
    expect(submitted).toHaveLength(1);
    await user.click(within(editor).getByRole("button", { name: "達成を保存" }));
    await waitFor(() =>
      expect(submitted).toEqual([
        {
          expectedMatchVersion: "7",
          achievements: [
            {
              achievementId: item.achievementId,
              memberId: "member_ponta",
              expectedItemVersion: "5",
              expectedClaimVersion: null,
            },
          ],
        },
        {
          expectedMatchVersion: "8",
          achievements: [
            {
              achievementId: item.achievementId,
              memberId: "member_ponta",
              expectedItemVersion: "6",
              expectedClaimVersion: null,
            },
          ],
        },
      ]),
    );
    expect(await screen.findByRole("dialog", { name: item.name })).toBeVisible();
  });

  it("keeps automatic achievements read-only despite retained imported claims and links to the source match", async () => {
    const user = userEvent.setup();
    const item = makeAchievementItem({
      ruleKind: "total_assets",
      threshold: "200000",
      name: "総資産20億円以上",
    });
    const catalog = makeAchievementCatalog({
      items: [item],
      claims: [
        makeAchievementClaim({ sourceKind: "import" }),
        makeAchievementClaim({
          claimId: "claim-unconfirmed",
          memberId: "member_eu",
          sourceKind: "import",
          state: "unconfirmed",
        }),
      ],
    });
    const resource = makeAchievedResource();
    const published = resource.items[0]!;
    published.name = item.name;
    published.ruleKind = "total_assets";
    published.threshold = item.threshold;
    const player = published.players.find((entry) => entry.memberId === "member_ponta")!;
    player.firstAchievedAt = "2026-04-04T12:34:56.000Z";
    player.dateUnknown = false;
    player.proofs = [
      {
        ...player.proofs[0]!,
        kind: "automatic",
        claimId: null,
        generationId: null,
        achievedAt: player.firstAchievedAt,
        matchId: "match-automatic",
        matchAvailable: true,
      },
    ];
    server.use(
      http.get("/api/achievements/catalog", () => HttpResponse.json(catalog)),
      http.get("/api/achievements", () => HttpResponse.json(resource)),
    );
    const { router } = renderPage();
    await user.click(await screen.findByRole("button", { name: `${item.name}の記録を見る` }));
    const details = await screen.findByRole("dialog", { name: item.name });
    expect(within(details).getByText("まだ記録なし")).toBeVisible();
    expect(
      within(details).queryByRole("button", { name: "達成を記録する" }),
    ).not.toBeInTheDocument();
    expect(
      within(details).queryByRole("button", { name: "以前の記録：達成を確認する" }),
    ).not.toBeInTheDocument();
    await user.click(within(details).getByRole("tab", { name: "ぽんた" }));
    expect(within(details).getByText("4ポイント獲得")).toBeVisible();
    expect(within(details).queryByRole("button", { name: "記録を直す" })).not.toBeInTheDocument();
    expect(
      within(details).queryByRole("button", { name: "達成を記録する" }),
    ).not.toBeInTheDocument();
    expect(within(details).queryByText("以前の実績リストから")).not.toBeInTheDocument();
    await user.click(within(details).getByRole("link", { name: "試合を振り返る" }));
    expect(router.state.location.pathname).toBe("/matches/match-automatic");
  });

  it("uses one record action per row, switches players, and honors retired player links", async () => {
    const user = userEvent.setup();
    const resource = makeAchievedResource();
    const source = resource.items[0]!;
    resource.items = [
      {
        ...source,
        achievementId: "second-name",
        name: "到着8回",
        common: false,
        mapMasterIds: ["map_east"],
      },
      { ...source, achievementId: "first-name", name: "到着4回" },
      { ...source, achievementId: "retired", name: "以前の実績", retired: true },
    ];
    const catalog = makeAchievementCatalog({
      items: resource.items.map((item) =>
        makeAchievementItem({
          achievementId: item.achievementId,
          name: item.name,
          retiredAt: item.retired ? "2026-04-01T00:00:00Z" : null,
        }),
      ),
      claims: [makeAchievementClaim({ achievementId: "retired" })],
    });
    server.use(
      http.get("/api/achievements/catalog", () => HttpResponse.json(catalog)),
      http.get("/api/achievements", () => HttpResponse.json(resource)),
    );
    const { router } = renderPage("/achievements?gameTitleId=gt_momotetsu_2&mapMasterId=map_empty");
    const table = await screen.findByRole("table", { name: "実績と4人の達成状況" });
    expect(
      within(table)
        .getAllByRole("rowheader")
        .map((cell) => cell.textContent),
    ).toEqual([expect.stringContaining("到着8回"), expect.stringContaining("到着4回")]);
    expect(screen.queryByRole("combobox", { name: "対象マップ" })).not.toBeInTheDocument();
    expect(screen.queryByText("以前の実績")).not.toBeInTheDocument();
    for (const row of within(table).getAllByRole("row").slice(1)) {
      expect(within(row).getAllByRole("button")).toHaveLength(1);
    }
    await user.click(within(table).getByRole("button", { name: "到着8回の記録を見る" }));
    const currentDetails = await screen.findByRole("dialog", { name: "到着8回" });
    expect(within(currentDetails).getByRole("tab", { name: "いーゆー" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(currentDetails).getByText("まだ記録なし")).toBeVisible();
    expect(within(currentDetails).queryByText("4ポイント獲得")).not.toBeInTheDocument();
    await user.click(within(currentDetails).getByRole("tab", { name: "ぽんた" }));
    expect(within(currentDetails).getByText("4ポイント獲得")).toBeVisible();
    expect(new URLSearchParams(router.state.location.search).get("memberId")).toBe("member_ponta");
    await act(() =>
      router.navigate(
        "/achievements?gameTitleId=gt_momotetsu_2&achievementId=retired&memberId=member_ponta",
      ),
    );
    const details = await screen.findByRole("dialog", { name: "以前の実績" });
    expect(within(details).getByRole("tab", { name: "ぽんた" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(details).getByText("廃止した実績の記録です。")).toBeVisible();
    await user.click(within(details).getByRole("button", { name: "記録を直す" }));
    expect(
      within(details).getByRole("button", { name: "試合で入力した記録：日時・試合・達成を直す" }),
    ).toBeEnabled();
  });

  it("requires an explicit result before saving an unconfirmed import", async () => {
    const user = userEvent.setup();
    const claim = makeAchievementClaim({
      sourceKind: "import",
      state: "unconfirmed",
      achievedAt: null,
    });
    const catalog = makeAchievementCatalog({ items: [makeAchievementItem()], claims: [claim] });
    const resource = makeAchievedResource();
    const player = resource.items[0]!.players.find((entry) => entry.memberId === claim.memberId)!;
    player.status = "unconfirmed";
    player.dateUnknown = false;
    player.proofs = [{ ...player.proofs[0]!, kind: "import", state: "unconfirmed" }];
    resource.summaries.forEach((summary) => {
      summary.players.forEach((entry) => {
        entry.earnedPoints = 0;
        entry.score = 1;
      });
    });
    const submitted: CorrectAchievementClaimRequest[] = [];
    server.use(
      http.get("/api/achievements/catalog", () => HttpResponse.json(catalog)),
      http.get("/api/achievements", () => HttpResponse.json(resource)),
      http.put("/api/achievements/claims/claim-direct", async ({ request }) => {
        const body = (await request.json()) as CorrectAchievementClaimRequest;
        submitted.push(body);
        catalog.claims[0] = { ...claim, ...body, version: "3" };
        return HttpResponse.json(catalog.claims[0]);
      }),
    );
    const { router } = renderPage();
    await openPlayerRecord(user);
    await user.click(await screen.findByRole("button", { name: "以前の記録：達成を確認する" }));
    const editor = await screen.findByRole("dialog", { name: /記録を訂正/u });
    // jsdom has no native datetime keyboard editor; change only this native control.
    fireEvent.change(within(editor).getByLabelText("達成日時（日本時間）"), {
      target: { value: "2026-04-04T12:00" },
    });
    expect(within(editor).getByRole("button", { name: "記録を保存" })).toBeDisabled();
    expect(submitted).toEqual([]);
    await selectOption(
      user,
      within(editor).getByRole("combobox", { name: "達成の確認" }),
      "achieved",
    );
    await user.click(within(editor).getByRole("button", { name: "記録を保存" }));
    await waitFor(() =>
      expect(submitted).toEqual([
        {
          expectedVersion: "2",
          expectedItemVersion: "1",
          state: "achieved",
          matchId: null,
          achievedAt: "2026-04-04T03:00:00.000Z",
          expectedMatchVersion: null,
        },
      ]),
    );
    const returnedDetails = await screen.findByRole("dialog", {
      name: "手入力のテスト実績",
    });
    expect(within(returnedDetails).getByRole("tab", { name: "ぽんた" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(new URLSearchParams(router.state.location.search).get("achievementId")).toBe(
      claim.achievementId,
    );
    expect(new URLSearchParams(router.state.location.search).get("memberId")).toBe(claim.memberId);
  });

  it.each([
    { scenario: "before the first publication", hasPublication: false },
    { scenario: "while a new item is absent from the publication", hasPublication: true },
  ])(
    "keeps imported records reachable $scenario without inventing a result",
    async ({ hasPublication }) => {
      const user = userEvent.setup();
      const item = makeAchievementItem({
        achievementId: "catalog-only",
        name: "まだ集計されていない実績",
      });
      const claim = makeAchievementClaim({
        achievementId: item.achievementId,
        sourceKind: "import",
        state: "unconfirmed",
        achievedAt: null,
      });
      const catalog = makeAchievementCatalog({ items: [item], claims: [claim] });
      const resource = hasPublication ? makeAchievedResource() : makeAchievementResource();
      const status = makeSeriesAnalysisStatus({
        artifactFreshness: hasPublication ? "stale" : "unavailable",
        calculation: {
          finishedAt: null,
          requestedAt: "2026-08-09T02:00:00.000Z",
          startedAt: null,
          status: "queued",
          trigger: "achievement_mutation",
        },
      });
      if (!hasPublication) status.currentArtifact = null;
      const submitted: CorrectAchievementClaimRequest[] = [];
      server.use(
        http.get("/api/achievements/catalog", () => HttpResponse.json(catalog)),
        http.get("/api/analytics/series-comparison/v2/status", () => HttpResponse.json(status)),
        http.get("/api/achievements", () => HttpResponse.json(resource)),
        http.put("/api/achievements/claims/claim-direct", async ({ request }) => {
          const body = (await request.json()) as CorrectAchievementClaimRequest;
          submitted.push(body);
          catalog.claims[0] = { ...claim, ...body, version: "3" };
          return HttpResponse.json(catalog.claims[0]);
        }),
      );
      renderPage();
      const details = await openPlayerRecord(user, item.name);
      expect(within(details).getByText("達成状況は未取得")).toBeVisible();
      expect(within(details).queryByText("達成！")).not.toBeInTheDocument();
      expect(within(details).queryByText(/ポイント獲得/u)).not.toBeInTheDocument();
      await user.click(within(details).getByRole("button", { name: "以前の記録：達成を確認する" }));
      const editor = await screen.findByRole("dialog", {
        name: `${item.name}・ぽんたの記録を訂正`,
      });
      await selectOption(
        user,
        within(editor).getByRole("combobox", { name: "達成の確認" }),
        "achieved",
      );
      await user.click(within(editor).getByRole("button", { name: "記録を保存" }));
      await waitFor(() =>
        expect(submitted).toEqual([
          {
            expectedVersion: "2",
            expectedItemVersion: "1",
            state: "achieved",
            matchId: null,
            achievedAt: null,
            expectedMatchVersion: null,
          },
        ]),
      );
      const returnedDetails = await screen.findByRole("dialog", { name: item.name });
      expect(within(returnedDetails).getByText("達成状況は未取得")).toBeVisible();
      expect(within(returnedDetails).queryByText("達成！")).not.toBeInTheDocument();
    },
  );

  it("retains the last successful publication when a newly published artifact cannot be fetched", async () => {
    const user = userEvent.setup();
    installRecords();
    let advanced = false;
    server.use(
      http.get("/api/analytics/series-comparison/v2/status", () => {
        const response = makeSeriesAnalysisStatus();
        if (advanced && response.currentArtifact)
          response.currentArtifact = {
            ...response.currentArtifact,
            artifactId: "artifact-next",
            inputRevision: "13",
          };
        return HttpResponse.json(response);
      }),
      http.get("/api/achievements", ({ request }) =>
        new URL(request.url).searchParams.get("artifactId") === "artifact-next"
          ? HttpResponse.json(
              {
                type: "about:blank",
                title: "Unavailable",
                code: "SERVICE_UNAVAILABLE",
                status: 503,
                detail: "unavailable",
              },
              { status: 503 },
            )
          : HttpResponse.json(makeAchievedResource()),
      ),
    );
    renderPage();
    expect(await screen.findByLabelText("獲得／対象ポイント")).toHaveTextContent(
      /ぽんた4／4ポイント/u,
    );
    advanced = true;
    await user.click(await screen.findByRole("button", { name: "表示を更新" }));
    expect(await screen.findByText("実績を更新できません")).toBeVisible();
    expect(screen.getByLabelText("獲得／対象ポイント")).toHaveTextContent(/ぽんた4／4ポイント/u);
    expect(screen.getByRole("button", { name: "手入力のテスト実績の記録を見る" })).toBeVisible();
  });

  it("can restore a cancelled record without published proofs and return to the same player after cancelling the editor", async () => {
    const user = userEvent.setup();
    const claim = makeAchievementClaim({ state: "cancelled" });
    const resource = makeAchievedResource();
    const player = resource.items[0]!.players.find((entry) => entry.memberId === claim.memberId)!;
    player.status = "not_recorded";
    player.dateUnknown = false;
    player.proofs = [];
    const catalog = makeAchievementCatalog({ items: [makeAchievementItem()], claims: [claim] });
    server.use(
      http.get("/api/achievements/catalog", () => HttpResponse.json(catalog)),
      http.get("/api/achievements", () => HttpResponse.json(resource)),
    );
    const { router } = renderPage();
    const details = await openPlayerRecord(user);
    expect(
      within(details).queryByRole("button", { name: "達成を記録する" }),
    ).not.toBeInTheDocument();
    await user.click(within(details).getByRole("button", { name: "記録を直す" }));
    await user.click(
      within(details).getByRole("button", { name: "試合で入力した記録：記録を戻す" }),
    );
    const editor = await screen.findByRole("dialog", { name: /記録を訂正/u });
    expect(within(editor).getByRole("combobox", { name: "達成の確認" })).toHaveTextContent(
      "この記録の達成を取り消す",
    );
    await selectOption(
      user,
      within(editor).getByRole("combobox", { name: "達成の確認" }),
      "achieved",
    );
    expect(within(editor).getByRole("button", { name: "記録を保存" })).toBeEnabled();
    await user.click(within(editor).getByRole("button", { name: "キャンセル" }));
    await user.click(
      within(
        await screen.findByRole("alertdialog", { name: "未保存の訂正を破棄しますか？" }),
      ).getByRole("button", { name: "破棄して閉じる" }),
    );
    const returnedDetails = await screen.findByRole("dialog", {
      name: "手入力のテスト実績",
    });
    expect(within(returnedDetails).getByRole("tab", { name: "ぽんた" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(new URLSearchParams(router.state.location.search).get("achievementId")).toBe(
      claim.achievementId,
    );
    expect(new URLSearchParams(router.state.location.search).get("memberId")).toBe(claim.memberId);
  });

  it("keeps published stars and points together while newer edits wait for calculation", async () => {
    const catalog = installRecords();
    catalog.items[0]!.stars = 5;
    server.use(
      http.get("/api/analytics/series-comparison/v2/status", () =>
        HttpResponse.json(
          makeSeriesAnalysisStatus({
            artifactFreshness: "stale",
            calculation: {
              status: "running",
              trigger: "achievement_mutation",
              requestedAt: "2026-04-05T12:00:00.000Z",
              startedAt: "2026-04-05T12:00:01.000Z",
              finishedAt: null,
            },
          }),
        ),
      ),
    );
    renderPage();
    expect(await screen.findByText("保存された変更の集計を待っています")).toBeVisible();
    const points = await screen.findByLabelText("獲得／対象ポイント");
    expect(points).toHaveTextContent(/ぽんた4／4ポイント/u);
    const achievements = screen.getByRole("table", { name: "実績と4人の達成状況" });
    expect(within(achievements).getByLabelText("難易度：星2")).toBeVisible();
    expect(within(achievements).queryByLabelText("難易度：星5")).not.toBeInTheDocument();
    const user = userEvent.setup();
    const details = await openPlayerRecord(user);
    expect(within(details).getByText("日付の記録なし")).toBeVisible();
    expect(within(details).getByText("保存された変更の集計を待っています")).toBeVisible();
    expect(within(details).getByText("4ポイント獲得")).toBeVisible();
  });

  it("cancels a linked source even when its match is unavailable and preserves its exact timestamp", async () => {
    const user = userEvent.setup();
    const catalog = installRecords();
    catalog.claims[0]!.matchId = "match-1";
    const submitted: CorrectAchievementClaimRequest[] = [];
    server.use(
      http.get("/api/matches/match-1/identity", () =>
        HttpResponse.json(
          {
            type: "about:blank",
            title: "Not Found",
            status: 404,
            code: "NOT_FOUND",
            detail: "試合が見つかりません。",
          },
          { status: 404 },
        ),
      ),
      http.put("/api/achievements/claims/claim-direct", async ({ request }) => {
        const body = (await request.json()) as CorrectAchievementClaimRequest;
        submitted.push(body);
        catalog.claims[0] = { ...catalog.claims[0]!, ...body, version: "3" };
        return HttpResponse.json(catalog.claims[0]);
      }),
    );
    renderPage();
    const editor = await openCorrection(user);
    expect(await within(editor).findByText("達成した試合が見つかりません")).toBeVisible();
    await selectOption(
      user,
      within(editor).getByRole("combobox", { name: "達成の確認" }),
      "cancelled",
    );
    await user.click(within(editor).getByRole("button", { name: "記録を保存" }));
    const confirm = await screen.findByRole("alertdialog", {
      name: "この記録の達成を取り消しますか？",
    });
    expect(submitted).toEqual([]);
    await user.click(within(confirm).getByRole("button", { name: "この記録を取り消す" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /記録を訂正/u })).not.toBeInTheDocument(),
    );
    expect(submitted).toEqual([
      {
        expectedVersion: "2",
        expectedItemVersion: "1",
        expectedMatchVersion: null,
        matchId: null,
        state: "cancelled",
        achievedAt: "2026-04-04T12:34:56.000Z",
      },
    ]);
    expect(await screen.findByLabelText("獲得／対象ポイント")).toHaveTextContent(
      /ぽんた4／4ポイント/u,
    );
  });

  it("retains unsaved correction after a conflict and explicitly reloads the latest source", async () => {
    const user = userEvent.setup();
    const catalog = installRecords();
    server.use(
      http.put("/api/achievements/claims/claim-direct", () => {
        catalog.claims[0] = { ...catalog.claims[0]!, version: "3" };
        return HttpResponse.json(
          {
            type: "about:blank",
            title: "Conflict",
            status: 409,
            code: "CONFLICT",
            detail: "記録が更新されました。",
          },
          { status: 409 },
        );
      }),
    );
    renderPage();
    const editor = await openCorrection(user);
    await selectOption(
      user,
      within(editor).getByRole("combobox", { name: "達成の確認" }),
      "cancelled",
    );
    await user.click(within(editor).getByRole("button", { name: "記録を保存" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "この記録を取り消す",
      }),
    );
    expect(await screen.findByText("保存済みの記録が更新されています")).toBeVisible();
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "キャンセル" }),
    );
    expect(within(editor).getByRole("combobox", { name: "達成の確認" })).toHaveTextContent(
      "この記録の達成を取り消す",
    );
    expect(within(editor).getByRole("button", { name: "記録を保存" })).toBeDisabled();
    await user.click(within(editor).getByRole("button", { name: "最新内容を読み込む" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "破棄して読み込む",
      }),
    );
    expect(within(editor).getByRole("combobox", { name: "達成の確認" })).toHaveTextContent(
      "達成した",
    );
    expect(screen.queryByText("保存済みの記録が更新されています")).not.toBeInTheDocument();
  });
});

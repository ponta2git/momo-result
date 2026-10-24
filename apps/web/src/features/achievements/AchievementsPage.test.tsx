import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeAll, describe, expect, it } from "vitest";

import { AchievementsPage } from "@/features/achievements/AchievementsPage";
import type { CorrectAchievementClaimRequest } from "@/shared/api/achievements";
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

function renderPage() {
  setDevUser();
  const client = createTestQueryClient();
  const router = createMemoryRouter(
    [
      { path: "/achievements", element: <AchievementsPage /> },
      { path: "/matches/:matchId", element: <p>根拠の試合</p> },
    ],
    { initialEntries: ["/achievements?gameTitleId=gt_momotetsu_2"] },
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

async function openCorrection(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole("button", { name: "手入力のテスト実績・ぽんたの達成済み" }),
  );
  await user.click(await screen.findByRole("button", { name: "ぽんたの手入力を訂正" }));
  return screen.findByRole("dialog", { name: "手入力のテスト実績・ぽんたの記録を訂正" });
}

describe("AchievementsPage", () => {
  it("requires an explicit result before saving an unconfirmed import", async () => {
    const user = userEvent.setup();
    const claim = makeAchievementClaim({
      sourceKind: "import",
      state: "unconfirmed",
      achievedAt: null,
    });
    const catalog = makeAchievementCatalog({ items: [makeAchievementItem()], claims: [claim] });
    const submitted: CorrectAchievementClaimRequest[] = [];
    server.use(
      http.get("/api/achievements/catalog", () => HttpResponse.json(catalog)),
      http.get("/api/achievements", () => HttpResponse.json(makeAchievementResource())),
      http.put("/api/achievements/claims/claim-direct", async ({ request }) => {
        const body = (await request.json()) as CorrectAchievementClaimRequest;
        submitted.push(body);
        catalog.claims[0] = { ...claim, ...body, version: "3" };
        return HttpResponse.json(catalog.claims[0]);
      }),
    );
    renderPage();
    await user.click(screen.getByRole("button", { name: "保存済みの実績記録を訂正" }));
    await user.click(
      await screen.findByRole("button", { name: "手入力のテスト実績・ぽんたの移行記録を訂正" }),
    );
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
  });

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
    expect(await screen.findByRole("row", { name: /ぽんた 10点 4／4/u })).toBeVisible();
    advanced = true;
    await user.click(await screen.findByRole("button", { name: "表示を更新" }));
    expect(await screen.findByText("実績を更新できません")).toBeVisible();
    expect(screen.getByRole("row", { name: /ぽんた 10点 4／4/u })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "手入力のテスト実績・ぽんたの達成済み" }),
    ).toBeVisible();
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
    const points = await screen.findByRole("table", { name: "実績達成・作品通算" });
    expect(within(points).getByRole("row", { name: /ぽんた 10点 4／4/u })).toBeVisible();
    const achievements = screen.getByRole("table", { name: "実績と4人の達成状況" });
    expect(within(achievements).getByText("★★・共通")).toBeVisible();
    expect(within(achievements).queryByText("★★★★★・共通")).not.toBeInTheDocument();
    expect(within(achievements).getByText("日時不明")).toBeVisible();
  });

  it("cancels only the chosen source with its versions and preserves an unchanged exact timestamp", async () => {
    const user = userEvent.setup();
    const catalog = installRecords();
    catalog.claims[0]!.matchId = "match-1";
    const submitted: CorrectAchievementClaimRequest[] = [];
    server.use(
      http.put("/api/achievements/claims/claim-direct", async ({ request }) => {
        const body = (await request.json()) as CorrectAchievementClaimRequest;
        submitted.push(body);
        catalog.claims[0] = { ...catalog.claims[0]!, ...body, version: "3" };
        return HttpResponse.json(catalog.claims[0]);
      }),
    );
    renderPage();
    const editor = await openCorrection(user);
    await user.click(within(editor).getByRole("button", { name: "根拠の紐づけを外す" }));
    expect(within(editor).getByLabelText("達成日時（日本時間）")).toHaveValue("2026-04-04T21:34");
    expect(within(editor).getByLabelText("達成日時（日本時間）")).toHaveAttribute("readonly");
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
    expect(await screen.findByRole("row", { name: /ぽんた 10点 4／4/u })).toBeVisible();
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
      "達成済み",
    );
    expect(screen.queryByText("保存済みの記録が更新されています")).not.toBeInTheDocument();
  });
});

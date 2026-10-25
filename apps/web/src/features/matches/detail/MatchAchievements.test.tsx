import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it } from "vitest";

import { MatchAchievements } from "@/features/matches/detail/MatchAchievements";
import { decodeSeriesAnalysisArtifact } from "@/shared/api/seriesAnalysisArtifactDecoder";
import { decodeSeriesAnalysisStatus } from "@/shared/api/seriesAnalysisEnvelopeSchemas";
import { makeAchievedResource } from "@/test/msw/achievementFixtures";
import { setupMsw } from "@/test/msw/lifecycle";
import { makeSeriesAnalysisStatus } from "@/test/msw/seriesAnalysisFixtures";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();
beforeAll(() =>
  Promise.all([
    decodeSeriesAnalysisArtifact("achievements", makeAchievedResource()),
    decodeSeriesAnalysisStatus(makeSeriesAnalysisStatus()),
  ]),
);

function renderAchievements() {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter>
        <MatchAchievements matchId="match-1" gameTitleId="gt_momotetsu_2" heldEventId="held-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function makeMatchAchievements() {
  const resource = makeAchievedResource();
  const item = resource.items[0]!;
  item.stars = 5;
  const proof = item.players.find((player) => player.memberId === "member_ponta")!.proofs[0]!;
  item.players.forEach((player) => {
    player.status = "achieved";
    player.firstAchievedAt = "2026-04-04T12:34:56.000Z";
    player.dateUnknown = false;
    player.proofs = [
      {
        ...proof,
        claimId: `claim-${player.memberId}`,
        matchId: player.memberId === "member_akane_mami" ? "another-match" : "match-1",
        matchAvailable: player.memberId !== "member_otaka",
        achievedAt: player.firstAchievedAt,
      },
    ];
  });
  resource.summaries.forEach((summary) => {
    summary.totalPoints = 25;
    summary.players.forEach((player) => {
      player.earnedPoints = 25;
      player.score = 10;
    });
  });
  return resource;
}

describe("MatchAchievements", () => {
  it("groups a shared achievement once with difficulty and matching member record links", async () => {
    const resource = makeMatchAchievements();
    server.use(http.get("/api/achievements", () => HttpResponse.json(resource)));
    renderAchievements();

    const section = screen.getByRole("region", { name: "この試合・開催の実績" });
    expect(
      await within(section).findByRole("heading", { name: "手入力のテスト実績", level: 3 }),
    ).toBeVisible();
    expect(within(section).getAllByRole("heading", { level: 3 })).toHaveLength(1);
    expect(within(section).getByRole("img", { name: "難易度：星5" })).toBeVisible();
    const members = within(section).getByRole("list", { name: "手入力のテスト実績の達成者" });
    const links = within(members).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["いーゆー", "ぽんた"]);
    expect(links[0]).toHaveAttribute(
      "href",
      "/achievements?gameTitleId=gt_momotetsu_2&achievementId=achievement-manual&memberId=member_eu",
    );
    expect(links[1]).toHaveAttribute(
      "href",
      "/achievements?gameTitleId=gt_momotetsu_2&achievementId=achievement-manual&memberId=member_ponta",
    );
    expect(within(section).queryByRole("button")).not.toBeInTheDocument();
    expect(
      within(section).queryByRole("link", { name: "実績リストを開く" }),
    ).not.toBeInTheDocument();
  });

  it("keeps published achievements during calculation and gives recovery advice without the removed refresh action", async () => {
    const resource = makeMatchAchievements();
    server.use(
      http.get("/api/achievements", () => HttpResponse.json(resource)),
      http.get("/api/analytics/series-comparison/v2/status", () =>
        HttpResponse.json(
          makeSeriesAnalysisStatus({
            artifactFreshness: "stale",
            calculation: {
              status: "running",
              trigger: "achievement_mutation",
              requestedAt: "2026-08-09T02:00:00.000Z",
              startedAt: "2026-08-09T02:00:01.000Z",
              finishedAt: null,
            },
          }),
        ),
      ),
    );
    renderAchievements();

    expect(await screen.findByText("保存された変更の集計を待っています")).toBeVisible();
    expect(await screen.findByRole("heading", { name: "手入力のテスト実績" })).toBeVisible();
    expect(screen.getByText(/集計前の実績を表示しています。/u)).toHaveTextContent(
      "集計後にページを開き直すと反映されます。",
    );
    expect(screen.queryByText(/表示を更新/u)).not.toBeInTheDocument();
  });

  it("does not present a failed initial fetch as no achievements or refer to the removed action", async () => {
    server.use(
      http.get("/api/achievements", () =>
        HttpResponse.json(
          {
            type: "about:blank",
            title: "Unavailable",
            status: 503,
            code: "SERVICE_UNAVAILABLE",
            detail: "unavailable",
          },
          { status: 503 },
        ),
      ),
    );
    renderAchievements();

    expect(await screen.findByText("実績を更新できません")).toBeVisible();
    expect(screen.getByText(/達成状況を取得できませんでした。/u)).toHaveTextContent(
      "通信状態を確認してページを開き直してください。",
    );
    expect(
      screen.queryByText("この試合・開催を根拠とする実績はありません。"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/表示を更新/u)).not.toBeInTheDocument();
  });
});

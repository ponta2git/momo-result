import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { queryClient } from "@/app/queryClient";
import { masterQueryKeys } from "@/features/masters/masterApi";
import {
  createDraftReviewHandoffPayload,
  saveMasterHandoff,
} from "@/features/masters/masterReturnHandoff";
import { MastersPage } from "@/features/masters/MastersPage";
import { server } from "@/shared/api/msw/server";

function renderPage(entry = "/admin/masters") {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <MastersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("MastersPage", () => {
  afterEach(() => {
    queryClient.clear();
    window.sessionStorage.clear();
  });

  it("renders relation board headings", async () => {
    window.localStorage.setItem("momoresult.devUser", "ponta");
    renderPage();

    expect(await screen.findByRole("heading", { name: "マスタ管理" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "作品マスタ" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "マップマスタ" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "シーズンマスタ" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "事件簿マスタ（読み取り専用）" }),
    ).toBeInTheDocument();
  });

  it("creates a new game title and selects it", async () => {
    window.localStorage.setItem("momoresult.devUser", "ponta");
    renderPage();

    await waitFor(() => expect(screen.getAllByText("桃太郎電鉄2").length).toBeGreaterThan(0));

    await userEvent.type(screen.getByPlaceholderText("例: 桃太郎電鉄2"), "桃太郎電鉄ワールド");
    await userEvent.click(screen.getByRole("button", { name: "作品を追加" }));

    await waitFor(() =>
      expect(screen.getAllByText("桃太郎電鉄ワールド").length).toBeGreaterThan(0),
    );
  });

  it("invalidates consumer-facing master caches after creating a game title", async () => {
    window.localStorage.setItem("momoresult.devUser", "ponta");
    queryClient.setQueryData(["masters", "game-titles", "workspace"], { items: [] });
    queryClient.setQueryData(["game-titles"], { items: [] });
    renderPage();

    await waitFor(() => expect(screen.getAllByText("桃太郎電鉄2").length).toBeGreaterThan(0));

    await userEvent.type(screen.getByPlaceholderText("例: 桃太郎電鉄2"), "桃太郎電鉄ワールド");
    await userEvent.click(screen.getByRole("button", { name: "作品を追加" }));

    await waitFor(() => {
      expect(
        queryClient.getQueryState(["masters", "game-titles", "workspace"])?.isInvalidated,
      ).toBe(true);
      expect(queryClient.getQueryState(["game-titles"])?.isInvalidated).toBe(true);
    });
  });

  it("shows the six fixed incident masters", async () => {
    window.localStorage.setItem("momoresult.devUser", "ponta");
    renderPage();

    expect(await screen.findByText("目的地")).toBeInTheDocument();
    expect(screen.getByText("プラス駅")).toBeInTheDocument();
    expect(screen.getByText("マイナス駅")).toBeInTheDocument();
    expect(screen.getByText("カード駅")).toBeInTheDocument();
    expect(screen.getByText("カード売り場")).toBeInTheDocument();
    expect(screen.getByText("スリの銀次")).toBeInTheDocument();
  });

  it("shows return action with handoff notice when returnTo is provided", async () => {
    window.localStorage.setItem("momoresult.devUser", "ponta");

    const handoffId = saveMasterHandoff(
      createDraftReviewHandoffPayload({
        matchSessionId: "session-1",
        returnTo: "/review/session-1?totalAssets=draft-1",
        values: {
          draftIds: { totalAssets: "draft-1" },
          gameTitleId: "gt_momotetsu_2",
          heldEventId: "event-1",
          mapMasterId: "map_east",
          matchNoInEvent: 1,
          ownerMemberId: "member_ponta",
          playedAt: "2026-01-01T00:00:00.000Z",
          players: [
            {
              incidents: {
                cardShop: 0,
                cardStation: 0,
                destination: 0,
                minusStation: 0,
                plusStation: 0,
                suriNoGinji: 0,
              },
              memberId: "member_ponta",
              playOrder: 1,
              rank: 1,
              revenueManYen: 0,
              totalAssetsManYen: 0,
            },
          ],
          seasonMasterId: "season_current",
        },
      }),
    );

    renderPage(
      `/admin/masters?returnTo=${encodeURIComponent("/review/session-1?totalAssets=draft-1")}&handoffId=${handoffId}`,
    );

    expect(await screen.findByRole("button", { name: "元の入力画面へ戻る" })).toBeInTheDocument();
    expect(screen.getByText(/戻り先情報を引き継いでいます/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "戻り先を確認" })).toHaveAttribute(
      "href",
      expect.stringContaining("handoffId="),
    );
  });

  it("does not show cached load error after remount while refetch is running", async () => {
    window.localStorage.setItem("momoresult.devUser", "ponta");
    await queryClient
      .fetchQuery({
        queryKey: masterQueryKeys.gameTitles("ponta"),
        queryFn: async () => {
          throw new Error("cached load error");
        },
      })
      .catch(() => undefined);

    server.use(
      http.get("/api/game-titles", async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json({
          items: [
            {
              id: "gt_recovered",
              name: "復旧済み作品",
              layoutFamily: "momotetsu_2",
              displayOrder: 1,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      }),
    );

    renderPage();

    expect(screen.queryByText("作品マスタの読み込みに失敗しました")).not.toBeInTheDocument();
    expect(await screen.findByText("復旧済み作品")).toBeInTheDocument();
  });

  it("does not reuse list-response cache entries from OCR setup queries", async () => {
    window.localStorage.setItem("momoresult.devUser", "ponta");
    queryClient.setQueryData(["masters", "game-titles", "ponta"], {
      items: [
        {
          id: "gt_cached_response",
          name: "別画面キャッシュ",
          layoutFamily: "momotetsu_2",
          displayOrder: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    renderPage();

    expect(await screen.findByRole("heading", { name: "マスタ管理" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("別画面キャッシュ")).not.toBeInTheDocument());
  });
});

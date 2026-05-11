import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse, delay } from "msw";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { masterQueryKeys } from "@/features/masters/masterApi";
import {
  createDraftReviewHandoffPayload,
  saveMasterHandoff,
} from "@/features/masters/masterReturnHandoff";
import { MastersPage } from "@/features/masters/MastersPage";
import { server } from "@/shared/api/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

let queryClient: QueryClient;

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
  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  it("renders relation board headings", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    renderPage();

    expect(await screen.findByRole("heading", { name: "設定管理" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "作品" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "マップ" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "シーズン" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "事件簿" })).toBeInTheDocument();
  });

  it("creates a new game title and selects it", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    renderPage();

    expect(await screen.findByRole("button", { name: /桃太郎電鉄2/u })).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("例: 桃太郎電鉄2"), "桃太郎電鉄ワールド");
    await userEvent.click(screen.getByRole("button", { name: "作品を追加" }));

    expect(await screen.findByRole("button", { name: /桃太郎電鉄ワールド/u })).toBeInTheDocument();
  });

  it("invalidates consumer-facing master caches after creating a game title", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    queryClient.setQueryData(["masters", "game-titles", "workspace"], { items: [] });
    queryClient.setQueryData(["game-titles"], { items: [] });
    renderPage();

    expect(await screen.findByRole("button", { name: /桃太郎電鉄2/u })).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("例: 桃太郎電鉄2"), "桃太郎電鉄ワールド");
    await userEvent.click(screen.getByRole("button", { name: "作品を追加" }));

    await waitFor(() => {
      expect(
        queryClient.getQueryState(["masters", "game-titles", "workspace"])?.isInvalidated,
      ).toBe(true);
      expect(queryClient.getQueryState(["game-titles"])?.isInvalidated).toBe(true);
    });
  });

  it("shows the new game title optimistically while the server is responding", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    server.use(
      http.post("/api/game-titles", async ({ request }) => {
        const body = (await request.json()) as { id: string; name: string; layoutFamily: string };
        await delay(120);
        const created = {
          ...body,
          displayOrder: 99,
          createdAt: "2026-01-01T00:00:00.000Z",
        };
        return HttpResponse.json(created);
      }),
    );

    renderPage();
    expect(await screen.findByRole("button", { name: /桃太郎電鉄2/u })).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("例: 桃太郎電鉄2"), "桃鉄DX");
    await userEvent.click(screen.getByRole("button", { name: "作品を追加" }));

    expect(await screen.findByText("(追加中…)")).toBeInTheDocument();
    expect(
      screen.getByText((_, node) => node?.textContent === "桃鉄DX(追加中…)"),
    ).toBeInTheDocument();

    await waitFor(() => expect(screen.queryByText("(追加中…)")).not.toBeInTheDocument());
  });

  it("shows the six fixed incident masters", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "事件簿" }));
    expect(await screen.findByText("目的地")).toBeInTheDocument();
    expect(screen.getByText("プラス駅")).toBeInTheDocument();
    expect(screen.getByText("マイナス駅")).toBeInTheDocument();
    expect(screen.getByText("カード駅")).toBeInTheDocument();
    expect(screen.getByText("カード売り場")).toBeInTheDocument();
    expect(screen.getByText("スリの銀次")).toBeInTheDocument();
  });

  it("updates a game title from the admin controls", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    renderPage();

    expect(await screen.findByRole("button", { name: /桃太郎電鉄2/u })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "作品を編集" }));
    const nameInput = screen.getByDisplayValue("桃太郎電鉄2");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "桃太郎電鉄2 DX");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByRole("button", { name: /桃太郎電鉄2 DX/u })).toBeInTheDocument();
  });

  it("creates and deletes member aliases", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "メンバー名寄せ" }));
    expect(await screen.findByRole("heading", { name: "プレーヤー名の別名" })).toBeInTheDocument();
    expect(screen.getByText("NO11")).toBeInTheDocument();
    const aliasPanel = screen
      .getByRole("heading", { name: "プレーヤー名の別名" })
      .closest("section");
    if (!aliasPanel) {
      throw new Error("alias panel was not rendered");
    }
    const aliasPanelScreen = within(aliasPanel);

    await userEvent.type(aliasPanelScreen.getByPlaceholderText("例: NO11社長"), "ポン太");
    await userEvent.click(aliasPanelScreen.getByRole("button", { name: "追加" }));
    expect(await screen.findByText("ポン太")).toBeInTheDocument();

    const no11Row = screen.getByText("NO11").closest("li");
    if (!no11Row) {
      throw new Error("NO11 alias row was not rendered");
    }
    await userEvent.click(within(no11Row).getByRole("button", { name: "別名を削除" }));
    await userEvent.click(screen.getByRole("button", { name: "削除" }));

    await waitFor(() => expect(screen.queryByText("NO11")).not.toBeInTheDocument());
  });

  it("shows return action with handoff notice when returnTo is provided", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");

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
    expect(
      screen.getByText(/現在の入力内容を保ったまま戻れるようにしています/u),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "戻り先を確認" })).toHaveAttribute(
      "href",
      expect.stringContaining("handoffId="),
    );
  });

  it("does not show cached load error after remount while refetch is running", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    await queryClient
      .fetchQuery({
        queryKey: masterQueryKeys.gameTitles("account_ponta"),
        queryFn: async () => {
          throw new Error("cached load error");
        },
      })
      .catch(() => undefined);

    let resolveResponse!: () => void;
    const requestStarted = new Promise<void>((requestSeen) => {
      server.use(
        http.get("/api/game-titles", async () => {
          requestSeen();
          await new Promise<void>((resolve) => {
            resolveResponse = resolve;
          });
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
    });

    renderPage();

    await requestStarted;
    expect(screen.queryByText("作品を読み込めませんでした")).not.toBeInTheDocument();
    resolveResponse();
    expect(await screen.findByText("復旧済み作品")).toBeInTheDocument();
  });

  it("does not reuse list-response cache entries from OCR setup queries", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    queryClient.setQueryData(["masters", "game-titles", "account_ponta"], {
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

    expect(await screen.findByRole("heading", { name: "設定管理" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("別画面キャッシュ")).not.toBeInTheDocument());
  });
});

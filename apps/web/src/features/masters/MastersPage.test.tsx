import { QueryClientProvider, QueryErrorResetBoundary } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { masterQueryKeys } from "@/features/masters/masterQueries";
import { MastersPage } from "@/features/masters/MastersPage";
import { masterKeys } from "@/shared/api/queryKeys";
import { authQueryOptions } from "@/shared/auth/authQueries";
import {
  createMatchWorkspaceMasterHandoffPayload,
  saveMasterHandoff,
} from "@/shared/workflows/matchWorkspaceMasterHandoff";
import { setDevUser, testDevUserAccountId } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { makeMatchWorkspaceMasterHandoffValues } from "@/test/factories";
import { mswState } from "@/test/msw/fixtures";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="current location">{`${location.pathname}${location.search}`}</output>;
}

let queryClient: QueryClient;
let user: ReturnType<typeof userEvent.setup>;

function renderPage(entry = "/admin/masters") {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <MastersPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openGameTitleCreateDialog() {
  await user.click(screen.getByRole("button", { name: "作品を追加" }));
  return screen.findByRole("dialog", { name: "作品を追加" });
}

function createMasterReturnEntry() {
  const returnTo = "/review/session-1?totalAssets=draft-1";
  const handoffId = saveMasterHandoff(
    createMatchWorkspaceMasterHandoffPayload({
      accountId: testDevUserAccountId,
      matchSessionId: "session-1",
      returnTo,
      values: makeMatchWorkspaceMasterHandoffValues({
        draftIds: { totalAssets: "draft-1" },
        gameTitleId: "gt_momotetsu_2",
        heldEventId: "event-1",
        mapMasterId: "map_east",
        matchNoInEvent: 1,
        ownerMemberId: "member_ponta",
        playedAt: "2026-01-01T00:00:00.000Z",
        seasonMasterId: "season_current",
      }),
    }),
  );

  return `/admin/masters?returnTo=${encodeURIComponent(returnTo)}&handoffId=${handoffId}`;
}

describe("MastersPage", () => {
  beforeEach(() => {
    queryClient = createTestQueryClient();
    user = userEvent.setup();
  });

  it("exposes the master categories through one labeled tab set", async () => {
    setDevUser();
    renderPage();

    expect(await screen.findByRole("region", { name: "設定管理" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "設定管理の表示切替" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "作品" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "マップ" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "シーズン" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "事件簿" })).toBeInTheDocument();
  });

  it("starts independent master directory requests in parallel", async () => {
    setDevUser();
    const responseGate = createDeferred();
    const requested = new Set<string>();
    server.use(
      http.get("/api/game-titles", async () => {
        requested.add("game-titles");
        await responseGate.promise;
        return HttpResponse.json({ items: [] });
      }),
      http.get("/api/incident-masters", async () => {
        requested.add("incident-masters");
        await responseGate.promise;
        return HttpResponse.json({ items: [] });
      }),
      http.get("/api/member-aliases", async () => {
        requested.add("member-aliases");
        await responseGate.promise;
        return HttpResponse.json({ items: [] });
      }),
    );

    renderPage();

    await waitFor(() =>
      expect(requested).toEqual(new Set(["game-titles", "incident-masters", "member-aliases"])),
    );
    responseGate.resolve();
    expect(await screen.findByRole("region", { name: "設定管理" })).toBeInTheDocument();
  });

  it("shows scoped skeletons while maps and seasons are loading", async () => {
    setDevUser();
    const responseGate = createDeferred();
    server.use(
      http.get("/api/map-masters", async () => {
        await responseGate.promise;
        return HttpResponse.json({ items: [] });
      }),
      http.get("/api/season-masters", async () => {
        await responseGate.promise;
        return HttpResponse.json({ items: [] });
      }),
    );

    renderPage();

    expect(await screen.findByRole("region", { name: "設定管理" })).toBeInTheDocument();
    expect(await screen.findByLabelText("マップを読み込み中")).toHaveAttribute("aria-busy", "true");
    expect(await screen.findByLabelText("シーズンを読み込み中")).toHaveAttribute(
      "aria-busy",
      "true",
    );

    responseGate.resolve();
    await waitFor(() =>
      expect(screen.queryByLabelText("マップを読み込み中")).not.toBeInTheDocument(),
    );
    expect(screen.queryByLabelText("シーズンを読み込み中")).not.toBeInTheDocument();
  });

  it("keeps a scoped master failure out of the empty state and retries locally", async () => {
    setDevUser();
    let attempts = 0;
    let shouldFail = true;
    server.use(
      http.get("/api/map-masters", () => {
        attempts += 1;
        return shouldFail
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 })
          : HttpResponse.json({ items: [] });
      }),
    );

    renderPage();

    expect(await screen.findByText("マップを読み込めません")).toBeInTheDocument();
    shouldFail = false;
    await user.click(screen.getByRole("button", { name: "マップを再読み込み" }));

    await waitFor(() =>
      expect(screen.queryByText("マップを読み込めません")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("マップはまだありません")).toBeInTheDocument();
    expect(attempts).toBeGreaterThanOrEqual(2);
  });

  it("keeps cached empty scoped masters visible while retrying stale data", async () => {
    setDevUser();
    queryClient.setQueryData(
      masterQueryKeys.mapMasters(testDevUserAccountId, "gt_momotetsu_2"),
      [],
    );
    let attempts = 0;
    let shouldFail = true;
    server.use(
      http.get("/api/map-masters", () => {
        attempts += 1;
        return shouldFail
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 })
          : HttpResponse.json({ items: [] });
      }),
    );

    renderPage();

    const mapPanel = (await screen.findByRole("heading", { name: "マップ" })).closest("section");
    expect(mapPanel).not.toBeNull();
    expect(await within(mapPanel!).findByText("最新のマップを取得できません")).toBeInTheDocument();
    expect(within(mapPanel!).getByText("マップはまだありません")).toBeInTheDocument();
    expect(within(mapPanel!).queryByText("マップを読み込めません")).not.toBeInTheDocument();
    const retryButton = within(mapPanel!).getByRole("button", { name: "マップを再読み込み" });
    expect(within(mapPanel!).getByRole("button", { name: "追加" })).toBeEnabled();

    shouldFail = false;
    await user.click(retryButton);

    await waitFor(() =>
      expect(within(mapPanel!).queryByText("最新のマップを取得できません")).not.toBeInTheDocument(),
    );
    expect(within(mapPanel!).getByText("マップはまだありません")).toBeInTheDocument();
    expect(attempts).toBeGreaterThanOrEqual(2);
  });

  it("keeps cached empty master directories visible during local retries", async () => {
    setDevUser();
    await queryClient.fetchQuery(authQueryOptions(testDevUserAccountId));
    const staleUpdatedAt = Date.now() - 2_000;
    queryClient.setQueryData(masterQueryKeys.gameTitles(testDevUserAccountId), [], {
      updatedAt: staleUpdatedAt,
    });
    queryClient.setQueryData(masterQueryKeys.incidentMasters(testDevUserAccountId), [], {
      updatedAt: staleUpdatedAt,
    });
    queryClient.setQueryData(masterQueryKeys.memberAliases(testDevUserAccountId), [], {
      updatedAt: staleUpdatedAt,
    });
    let shouldFail = true;
    const attempts = {
      aliases: 0,
      gameTitles: 0,
      incidents: 0,
    };
    server.use(
      http.get("/api/game-titles", () => {
        attempts.gameTitles += 1;
        return shouldFail
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 })
          : HttpResponse.json({ items: [] });
      }),
      http.get("/api/incident-masters", () => {
        attempts.incidents += 1;
        return shouldFail
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 })
          : HttpResponse.json({ items: [] });
      }),
      http.get("/api/member-aliases", () => {
        attempts.aliases += 1;
        return shouldFail
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 })
          : HttpResponse.json({ items: [] });
      }),
    );

    renderPage();

    await waitFor(() => expect(attempts).toEqual({ aliases: 1, gameTitles: 1, incidents: 1 }));
    await waitFor(() =>
      expect(
        queryClient.getQueryState(masterQueryKeys.gameTitles(testDevUserAccountId)),
      ).toMatchObject({ status: "error" }),
    );

    expect(await screen.findByText("最新の作品を取得できません")).toBeInTheDocument();
    expect(screen.getByText("作品はまだありません")).toBeInTheDocument();
    const gameTitleRetry = screen.getByRole("button", { name: "作品を再読み込み" });
    expect(screen.getByRole("button", { name: "作品を追加" })).toBeEnabled();

    await user.click(screen.getByRole("tab", { name: "メンバー名寄せ" }));
    expect(await screen.findByText("最新の別名を取得できません")).toBeInTheDocument();
    expect(screen.getAllByText("別名なし")).toHaveLength(4);
    const aliasPanel = screen
      .getByRole("heading", { name: "プレーヤー名の別名" })
      .closest("section");
    expect(aliasPanel).not.toBeNull();
    const aliasRetry = within(aliasPanel!).getByRole("button", { name: "別名を再読み込み" });
    expect(within(aliasPanel!).getByRole("button", { name: "追加" })).toBeEnabled();

    await user.click(screen.getByRole("tab", { name: "事件簿" }));
    expect(await screen.findByText("最新の事件簿を取得できません")).toBeInTheDocument();
    expect(screen.queryByText("事件簿の項目数を確認してください")).not.toBeInTheDocument();
    const incidentPanel = screen.getByRole("heading", { name: "事件簿" }).closest("section");
    expect(incidentPanel).not.toBeNull();
    const incidentRetry = within(incidentPanel!).getByRole("button", {
      name: "事件簿を再読み込み",
    });

    shouldFail = false;
    await user.click(incidentRetry);
    await user.click(screen.getByRole("tab", { name: "メンバー名寄せ" }));
    await user.click(aliasRetry);
    await user.click(screen.getByRole("tab", { name: "作品・マップ・シーズン" }));
    await user.click(gameTitleRetry);

    await waitFor(() => {
      expect(screen.queryByText("最新の作品を取得できません")).not.toBeInTheDocument();
      expect(screen.queryByText("最新の別名を取得できません")).not.toBeInTheDocument();
      expect(screen.queryByText("最新の事件簿を取得できません")).not.toBeInTheDocument();
    });
    expect(attempts).toEqual({ aliases: 2, gameTitles: 2, incidents: 2 });
  });

  it("reports an alias refresh failure after the alias was created successfully", async () => {
    setDevUser();
    let failRefresh = false;
    const aliases = [
      {
        alias: "NO11",
        createdAt: "2026-01-01T00:00:00.000Z",
        id: "alias-existing",
        memberId: "member_ponta",
      },
    ];
    server.use(
      http.get("/api/member-aliases", () =>
        failRefresh
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 })
          : HttpResponse.json({ items: aliases }),
      ),
      http.post("/api/member-aliases", async ({ request }) => {
        const body = (await request.json()) as { alias: string; memberId: string };
        aliases.push({
          ...body,
          createdAt: "2026-01-01T00:00:00.000Z",
          id: "alias-created",
        });
        failRefresh = true;
        return HttpResponse.json(aliases.at(-1));
      }),
    );

    renderPage("/admin/masters?tab=aliases");

    expect(await screen.findByText("NO11")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("例: NO11社長"), "ポン太");
    await user.click(screen.getByRole("button", { name: "追加" }));

    expect(await screen.findByText("最新の別名を取得できません")).toBeInTheDocument();
    expect(screen.getByText("NO11")).toBeInTheDocument();
    expect(screen.queryByText("別名の追加に失敗しました")).not.toBeInTheDocument();
    const retryButton = screen.getByRole("button", { name: "別名を再読み込み" });

    failRefresh = false;
    await user.click(retryButton);

    expect(await screen.findByText("ポン太")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("最新の別名を取得できません")).not.toBeInTheDocument(),
    );
  });

  it("creates a new game title and selects it", async () => {
    setDevUser();
    renderPage();

    expect(await screen.findByRole("radio", { name: "桃太郎電鉄2" })).toBeChecked();
    expect(screen.queryByPlaceholderText("例: 桃太郎電鉄2")).not.toBeInTheDocument();

    const dialog = await openGameTitleCreateDialog();
    await user.type(within(dialog).getByPlaceholderText("例: 桃太郎電鉄2"), "桃太郎電鉄ワールド");
    await user.click(within(dialog).getByRole("button", { name: "追加" }));

    expect(await screen.findByRole("radio", { name: "桃太郎電鉄ワールド" })).toBeChecked();
    expect(screen.queryByRole("dialog", { name: "作品を追加" })).not.toBeInTheDocument();
  });

  it("invalidates consumer-facing master caches after creating a game title", async () => {
    setDevUser();
    queryClient.setQueryData(masterKeys.gameTitles.list(), { items: [] });
    renderPage();

    expect(await screen.findByRole("radio", { name: "桃太郎電鉄2" })).toBeChecked();

    const dialog = await openGameTitleCreateDialog();
    await user.type(within(dialog).getByPlaceholderText("例: 桃太郎電鉄2"), "桃太郎電鉄ワールド");
    await user.click(within(dialog).getByRole("button", { name: "追加" }));

    await waitFor(() => {
      expect(queryClient.getQueryState(masterKeys.gameTitles.list())?.isInvalidated).toBe(true);
    });
  });

  it("shows the new game title optimistically while the server is responding", async () => {
    setDevUser();
    const responseGate = createDeferred();
    server.use(
      http.post("/api/game-titles", async ({ request }) => {
        const body = (await request.json()) as { id: string; name: string; layoutFamily: string };
        await responseGate.promise;
        const created = {
          ...body,
          displayOrder: 99,
          createdAt: "2026-01-01T00:00:00.000Z",
        };
        return HttpResponse.json(created);
      }),
    );

    renderPage();
    expect(await screen.findByRole("radio", { name: "桃太郎電鉄2" })).toBeChecked();

    const dialog = await openGameTitleCreateDialog();
    await user.type(within(dialog).getByPlaceholderText("例: 桃太郎電鉄2"), "桃鉄DX");
    await user.click(within(dialog).getByRole("button", { name: "追加" }));

    expect(await screen.findByText("(追加中…)")).toBeInTheDocument();
    expect(
      screen.getByText((_, node) => node?.textContent === "桃鉄DX(追加中…)"),
    ).toBeInTheDocument();
    const pendingChoice = screen.getByRole("radio", { name: "桃鉄DX（追加中）", hidden: true });
    expect(pendingChoice).toBeDisabled();
    expect(pendingChoice).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "桃太郎電鉄2", hidden: true })).toBeChecked();
    expect(within(dialog).getByRole("button", { name: "追加中" })).toBeDisabled();

    responseGate.resolve();
    await waitFor(() => expect(screen.queryByText("(追加中…)")).not.toBeInTheDocument());
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "作品を追加" })).not.toBeInTheDocument(),
    );
  });

  it("keeps the created game title selected while its canonical list is reloading", async () => {
    setDevUser();
    const refreshStarted = createDeferred();
    const refreshGate = createDeferred();
    const initialGameTitle = {
      createdAt: "2026-01-01T00:00:00.000Z",
      displayOrder: 1,
      id: "gt_momotetsu_2",
      layoutFamily: "momotetsu_2",
      name: "桃太郎電鉄2",
    };
    let createdGameTitle: typeof initialGameTitle | undefined;
    server.use(
      http.get("/api/game-titles", async () => {
        if (createdGameTitle) {
          refreshStarted.resolve();
          await refreshGate.promise;
        }
        return HttpResponse.json({
          items: createdGameTitle ? [initialGameTitle, createdGameTitle] : [initialGameTitle],
        });
      }),
      http.post("/api/game-titles", async ({ request }) => {
        const body = (await request.json()) as {
          id: string;
          layoutFamily: string;
          name: string;
        };
        createdGameTitle = {
          ...body,
          createdAt: "2026-01-01T00:00:00.000Z",
          displayOrder: 2,
        };
        return HttpResponse.json(createdGameTitle);
      }),
    );

    renderPage();
    expect(await screen.findByRole("radio", { name: "桃太郎電鉄2" })).toBeChecked();

    const dialog = await openGameTitleCreateDialog();
    await user.type(within(dialog).getByPlaceholderText("例: 桃太郎電鉄2"), "桃鉄DX");
    await user.click(within(dialog).getByRole("button", { name: "追加" }));

    await refreshStarted.promise;
    expect(screen.getByRole("radio", { name: "桃鉄DX（追加中）", hidden: true })).toBeChecked();

    refreshGate.resolve();
    expect(await screen.findByRole("radio", { name: "桃鉄DX" })).toBeChecked();
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "作品を追加" })).not.toBeInTheDocument(),
    );
  });

  it("shows the six fixed incident masters", async () => {
    setDevUser();
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "事件簿" }));
    expect(await screen.findByText("目的地")).toBeInTheDocument();
    expect(screen.getByText("プラス駅")).toBeInTheDocument();
    expect(screen.getByText("マイナス駅")).toBeInTheDocument();
    expect(screen.getByText("カード駅")).toBeInTheDocument();
    expect(screen.getByText("カード売り場")).toBeInTheDocument();
    expect(screen.getByText("スリの銀次")).toBeInTheDocument();
  });

  it("restores the selected tab from the URL and preserves return context", async () => {
    setDevUser();
    renderPage("/admin/masters?tab=aliases&returnTo=%2Fmatches%3Fpage%3D2");

    expect(await screen.findByRole("heading", { name: "プレーヤー名の別名" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "メンバー名寄せ" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.click(screen.getByRole("tab", { name: "事件簿" }));
    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent(
        "/admin/masters?tab=incidents&returnTo=%2Fmatches%3Fpage%3D2",
      ),
    );
  });

  it("updates a game title from the admin controls", async () => {
    setDevUser();
    let idempotencyKey: string | null = null;
    server.use(
      http.patch("/api/game-titles/:id", async ({ params, request }) => {
        idempotencyKey = request.headers.get("Idempotency-Key");
        const body = (await request.json()) as { layoutFamily: string; name: string };
        const id = String(params["id"]);
        mswState.gameTitles = mswState.gameTitles.map((item) =>
          item.id === id ? { ...item, ...body } : item,
        );
        return HttpResponse.json(mswState.gameTitles.find((item) => item.id === id));
      }),
    );
    renderPage();

    const gameTitleChoice = await screen.findByRole("radio", { name: "桃太郎電鉄2" });
    expect(gameTitleChoice).toBeChecked();

    const editButton = screen.getByRole("button", { name: "作品を編集" });
    const deleteButton = screen.getByRole("button", { name: "作品を削除" });
    expect(gameTitleChoice.closest("label")).not.toContainElement(editButton);
    expect(gameTitleChoice.closest("label")).not.toContainElement(deleteButton);
    await user.click(editButton);
    expect(gameTitleChoice).toBeChecked();
    const editDialog = screen.getByRole("dialog", { name: "作品を編集" });
    const nameInput = screen.getByDisplayValue("桃太郎電鉄2");
    expect(editDialog).toContainElement(nameInput);
    await user.clear(nameInput);
    await user.type(nameInput, "桃太郎電鉄2 DX");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByRole("radio", { name: "桃太郎電鉄2 DX" })).toBeChecked();
    expect(idempotencyKey).toMatch(/\S/u);
  });

  it("keeps a failed master deletion in its dialog after the dialog closes", async () => {
    setDevUser();
    server.use(
      http.delete("/api/game-titles/:id", () =>
        HttpResponse.json(
          {
            code: "CONFLICT",
            detail: "作品は試合から参照されています。",
            status: 409,
            title: "Conflict",
            type: "about:blank",
          },
          { status: 409 },
        ),
      ),
    );
    renderPage();

    await screen.findByRole("radio", { name: "桃太郎電鉄2" });
    await user.click(screen.getByRole("button", { name: "作品を削除" }));
    await user.click(screen.getByRole("button", { name: "削除" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "保存済みの状態が変わっています。内容を確認して、もう一度実行してください。",
    );
    await user.click(screen.getByRole("button", { name: "キャンセル" }));

    await waitFor(() => expect(screen.queryByText("作品を削除しますか？")).not.toBeInTheDocument());
    expect(screen.queryByText("作品は試合から参照されています。")).not.toBeInTheDocument();
    expect(screen.queryByText("設定の変更に失敗しました")).not.toBeInTheDocument();
  });

  it("creates and deletes member aliases", async () => {
    setDevUser();
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "メンバー名寄せ" }));
    expect(await screen.findByRole("heading", { name: "プレーヤー名の別名" })).toBeInTheDocument();
    expect(screen.getByText("NO11")).toBeInTheDocument();
    const aliasPanel = screen
      .getByRole("heading", { name: "プレーヤー名の別名" })
      .closest("section");
    if (!aliasPanel) {
      throw new Error("alias panel was not rendered");
    }
    const aliasPanelScreen = within(aliasPanel);
    await user.type(aliasPanelScreen.getByPlaceholderText("例: NO11社長"), "ポン太");
    await user.click(aliasPanelScreen.getByRole("button", { name: "追加" }));
    expect(await screen.findByText("ポン太")).toBeInTheDocument();

    const no11Row = screen.getByText("NO11").closest("li");
    if (!no11Row) {
      throw new Error("NO11 alias row was not rendered");
    }
    await user.click(within(no11Row).getByRole("button", { name: "別名を削除" }));
    await user.click(screen.getByRole("button", { name: "削除" }));

    await waitFor(() => expect(screen.queryByText("NO11")).not.toBeInTheDocument());
  });

  it("shows return action with handoff notice when returnTo is provided", async () => {
    setDevUser();
    renderPage(createMasterReturnEntry());

    expect(await screen.findByRole("button", { name: "元の入力画面へ戻る" })).toBeInTheDocument();
    expect(await screen.findByText(/現在の入力内容を保ったまま戻れます/u)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "戻り先を確認" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "元の入力画面へ戻る" })).toHaveLength(1);
  });

  it("keeps an invalid return destination notice in the settings owner surface", async () => {
    setDevUser();
    renderPage("/admin/masters?returnTo=https%3A%2F%2Fexample.com%2Freview");

    const surface = await screen.findByRole("region", { name: "設定管理" });
    expect(within(surface).getByText("戻り先を確認できませんでした")).toBeInTheDocument();
    expect(within(surface).getByText(/試合一覧へ戻る導線だけ/u)).toBeInTheDocument();
  });

  it("disables the only return action while a master edit is pending", async () => {
    setDevUser();
    const requestStarted = createDeferred();
    const responseGate = createDeferred();
    server.use(
      http.patch("/api/game-titles/:id", async ({ request }) => {
        const body = (await request.json()) as { layoutFamily: string; name: string };
        requestStarted.resolve();
        await responseGate.promise;
        return HttpResponse.json({
          ...body,
          createdAt: "2026-01-01T00:00:00.000Z",
          displayOrder: 1,
          id: "gt_momotetsu_2",
        });
      }),
    );

    renderPage(createMasterReturnEntry());

    const returnButton = await screen.findByRole("button", { name: "元の入力画面へ戻る" });
    await screen.findByRole("radio", { name: "桃太郎電鉄2" });
    await user.click(screen.getByRole("button", { name: "作品を編集" }));
    const nameInput = screen.getByDisplayValue("桃太郎電鉄2");
    await user.clear(nameInput);
    await user.type(nameInput, "桃太郎電鉄2 DX");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await requestStarted.promise;
    expect(returnButton).toBeDisabled();
    expect(screen.getByText("設定の追加・保存・削除が完了すると戻れます。")).toBeInTheDocument();

    responseGate.resolve();
    await waitFor(() => expect(returnButton).toBeEnabled());
    expect(
      screen.queryByText("設定の追加・保存・削除が完了すると戻れます。"),
    ).not.toBeInTheDocument();
  });

  it("does not show cached load error after the route error boundary resets it", async () => {
    setDevUser();
    await queryClient.fetchQuery(authQueryOptions(testDevUserAccountId));
    await queryClient
      .fetchQuery({
        queryKey: masterQueryKeys.gameTitles("account_ponta"),
        queryFn: async () => {
          throw new Error("cached load error");
        },
      })
      .catch(() => undefined);

    const requestStarted = createDeferred();
    const responseGate = createDeferred();
    server.use(
      http.get("/api/game-titles", async () => {
        requestStarted.resolve();
        await responseGate.promise;
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

    let resetQueryErrors: (() => void) | undefined;
    function MasterRouteHarness({ showPage }: { showPage: boolean }) {
      return (
        <QueryClientProvider client={queryClient}>
          <QueryErrorResetBoundary>
            {({ reset }) => {
              resetQueryErrors = reset;
              return showPage ? (
                <MemoryRouter initialEntries={["/admin/masters"]}>
                  <MastersPage />
                </MemoryRouter>
              ) : null;
            }}
          </QueryErrorResetBoundary>
        </QueryClientProvider>
      );
    }

    const view = render(<MasterRouteHarness showPage={false} />);
    const resetRouteQueryErrors = resetQueryErrors;
    if (!resetRouteQueryErrors) {
      throw new Error("query error reset was not registered");
    }
    act(() => resetRouteQueryErrors());
    view.rerender(<MasterRouteHarness showPage />);

    await requestStarted.promise;
    expect(screen.queryByText("作品を読み込めませんでした")).not.toBeInTheDocument();
    responseGate.resolve();
    expect(await screen.findByRole("radio", { name: "復旧済み作品" })).toBeChecked();
  });

  it("does not reuse list-response cache entries from OCR setup queries", async () => {
    setDevUser();
    queryClient.setQueryData(masterKeys.gameTitles.list(), {
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

    expect(await screen.findByRole("region", { name: "設定管理" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("別画面キャッシュ")).not.toBeInTheDocument());
  });
});

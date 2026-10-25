import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { MastersPage } from "@/features/masters/MastersPage";
import type { CreateAchievementRequest, UpdateAchievementRequest } from "@/shared/api/achievements";
import { setDevUser } from "@/test/auth";
import { makeAchievementCatalog, makeAchievementItem } from "@/test/msw/achievementFixtures";
import { mswState } from "@/test/msw/fixtures";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";
import { selectOption } from "@/test/selectOption";

setupMsw();

function renderPanel() {
  setDevUser();
  const router = createMemoryRouter([{ path: "/admin/masters", element: <MastersPage /> }], {
    initialEntries: ["/admin/masters?tab=achievements"],
  });
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("Achievement catalog management", () => {
  it("lets an operator create an automatic item with explicit map identity and threshold", async () => {
    const user = userEvent.setup();
    mswState.loginAccounts.find((account) => account.accountId === "account_ponta")!.role =
      "operator";
    const catalog = makeAchievementCatalog();
    const requests: CreateAchievementRequest[] = [];
    server.use(
      http.get("/api/achievements/catalog", () => HttpResponse.json(catalog)),
      http.post("/api/achievements/items", async ({ request }) => {
        const body = (await request.json()) as CreateAchievementRequest;
        requests.push(body);
        const item = makeAchievementItem({ ...body, mapMasterIds: body.mapMasterIds ?? [] });
        catalog.items.push(item);
        return HttpResponse.json(item);
      }),
    );
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "実績項目を追加" }));
    const editor = await screen.findByRole("dialog", { name: "実績項目を追加" });
    await user.type(
      within(editor).getByRole("textbox", { name: "達成内容" }),
      "東日本で総資産20億円",
    );
    await selectOption(
      user,
      within(editor).getByRole("combobox", { name: "判定方法" }),
      "total_assets",
    );
    await user.type(
      within(editor).getByRole("textbox", { name: "総資産の下限（万円）" }),
      "200000",
    );
    await selectOption(user, within(editor).getByRole("combobox", { name: "難易度" }), "4");
    await user.click(within(editor).getByRole("checkbox", { name: "作品内の全マップで共通" }));
    await user.click(within(editor).getByRole("checkbox", { name: "東日本編" }));
    await user.click(within(editor).getByRole("button", { name: "項目を追加" }));
    expect(await screen.findByRole("button", { name: "東日本で総資産20億円を編集" })).toBeVisible();
    expect(requests).toEqual([
      {
        name: "東日本で総資産20億円",
        notes: "",
        stars: 4,
        gameTitleId: "gt_momotetsu_2",
        common: false,
        mapMasterIds: ["map_east"],
        ruleKind: "total_assets",
        threshold: "200000",
      },
    ]);
  });

  it("keeps conditions fixed while editing the name and stars, then retains an actionable retirement failure", async () => {
    const user = userEvent.setup();
    const catalog = makeAchievementCatalog({
      items: [makeAchievementItem({ ruleKind: "destination", threshold: "4" })],
    });
    const updates: UpdateAchievementRequest[] = [];
    const retirements: unknown[] = [];
    server.use(
      http.get("/api/achievements/catalog", () => HttpResponse.json(catalog)),
      http.put("/api/achievements/items/achievement-manual", async ({ request }) => {
        const body = (await request.json()) as UpdateAchievementRequest;
        updates.push(body);
        catalog.items[0] = { ...catalog.items[0]!, ...body, version: "2" };
        return HttpResponse.json(catalog.items[0]);
      }),
      http.post("/api/achievements/items/achievement-manual/retire", async ({ request }) => {
        retirements.push(await request.json());
        return HttpResponse.json(
          {
            type: "about:blank",
            title: "Conflict",
            code: "CONFLICT",
            status: 409,
            detail: "最新の集計が完了してから再試行してください。",
          },
          { status: 409 },
        );
      }),
    );
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "手入力のテスト実績を編集" }));
    const editor = await screen.findByRole("dialog", { name: "実績項目を編集" });
    expect(within(editor).queryByRole("combobox", { name: "判定方法" })).not.toBeInTheDocument();
    await user.clear(within(editor).getByRole("textbox", { name: "達成内容" }));
    await user.type(within(editor).getByRole("textbox", { name: "達成内容" }), "到着4回");
    await selectOption(user, within(editor).getByRole("combobox", { name: "難易度" }), "3");
    await user.click(within(editor).getByRole("button", { name: "変更を保存" }));
    await user.click(await screen.findByRole("button", { name: "到着4回を廃止" }));
    const retirement = await screen.findByRole("alertdialog", { name: "実績項目を廃止しますか？" });
    expect(retirements).toEqual([]);
    await user.click(within(retirement).getByRole("button", { name: "廃止する" }));
    expect(
      await within(retirement).findByText(
        "項目または集計の状態が変わっています。最新の項目と集計を確認してから、廃止し直してください。",
      ),
    ).toBeVisible();
    await waitFor(() =>
      expect(within(retirement).getByRole("button", { name: "廃止する" })).toBeEnabled(),
    );
    expect(updates).toEqual([
      { name: "到着4回", notes: "条件を確認して入力します。", stars: 3, expectedVersion: "1" },
    ]);
    expect(retirements).toEqual([{ expectedVersion: "2" }]);
  });

  it("preserves an edited order after a failed save and publishes the saved order", async () => {
    const user = userEvent.setup();
    const catalog = makeAchievementCatalog({
      items: [
        makeAchievementItem({ achievementId: "first", name: "最初の実績", sortOrder: 0 }),
        makeAchievementItem({ achievementId: "second", name: "次の実績", sortOrder: 1 }),
        makeAchievementItem({
          achievementId: "retired",
          name: "以前の実績",
          sortOrder: 2,
          retiredAt: "2026-10-01T00:00:00Z",
        }),
      ],
    });
    const originalOrderRevision = catalog.orderRevision;
    const requests: unknown[] = [];
    server.use(
      http.get("/api/achievements/catalog", () => HttpResponse.json(catalog)),
      http.put("/api/achievements/catalog/order", async ({ request }) => {
        requests.push(await request.json());
        if (requests.length === 1)
          return HttpResponse.json(
            {
              type: "about:blank",
              title: "Unavailable",
              status: 503,
              code: "UNAVAILABLE",
              detail: "保存に失敗しました。",
            },
            { status: 503 },
          );
        catalog.items = [catalog.items[1]!, catalog.items[0]!, catalog.items[2]!].map(
          (item, sortOrder) => ({ ...item, sortOrder }),
        );
        catalog.orderRevision = "saved-order";
        return HttpResponse.json(catalog);
      }),
    );
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "表示順を変更" }));
    const editor = screen.getByRole("dialog", { name: "実績の表示順" });
    expect(within(editor).queryByText("以前の実績")).not.toBeInTheDocument();
    await user.click(within(editor).getByRole("button", { name: "次の実績（共通）を上へ" }));
    expect(within(editor).getByRole("button", { name: "次の実績（共通）を下へ" })).toHaveFocus();
    await user.click(within(editor).getByRole("button", { name: "表示順を保存" }));
    expect(await within(editor).findByText("表示順を保存できませんでした")).toBeVisible();
    expect(within(editor).getAllByRole("listitem")[0]).toHaveTextContent("次の実績");
    await user.click(within(editor).getByRole("button", { name: "表示順を保存" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "実績の表示順" })).not.toBeInTheDocument(),
    );
    const table = screen.getByRole("table", { name: "実績項目の管理" });
    expect(within(table).getAllByRole("rowheader")[0]).toHaveTextContent("次の実績");
    expect(within(table).getAllByRole("rowheader")[1]).toHaveTextContent("最初の実績");
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual({
      gameTitleId: catalog.gameTitleId,
      expectedOrderRevision: originalOrderRevision,
      achievementIds: ["second", "first", "retired"],
    });
    expect(requests[1]).toEqual(requests[0]);
  });
});

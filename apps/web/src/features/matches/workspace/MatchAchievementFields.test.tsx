import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { MatchAchievementFields } from "@/features/matches/workspace/MatchAchievementFields";
import type { MatchAchievementSelection } from "@/features/matches/workspace/matchAchievementSelection";
import { createEmptyMatchForm } from "@/features/matches/workspace/matchFormTypes";
import { achievementKeys } from "@/shared/api/achievementQueryOptions";
import {
  makeAchievementCatalog,
  makeAchievementClaim,
  makeAchievementItem,
} from "@/test/msw/achievementFixtures";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

function renderFields(playedAt = "2025-12-31T15:00:00.000Z") {
  const client = createTestQueryClient();
  function Editor() {
    const [values, setValues] = useState<MatchAchievementSelection[]>([]);
    return (
      <>
        <MatchAchievementFields
          setup={{
            ...createEmptyMatchForm(playedAt),
            gameTitleId: "gt_momotetsu_2",
            mapMasterId: "map_east",
          }}
          values={values}
          disabled={false}
          onChange={setValues}
        />
        <output aria-label="追加する実績">{JSON.stringify(values)}</output>
      </>
    );
  }
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Editor />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

describe("MatchAchievementFields", () => {
  it("offers same-JST-day manual achievements, keeps saved direct claims read-only, and permits an independent imported claim", async () => {
    const user = userEvent.setup();
    const catalog = makeAchievementCatalog({
      items: [
        makeAchievementItem(),
        makeAchievementItem({
          achievementId: "future",
          name: "翌日の実績",
          appliesFrom: "2026-01-02",
        }),
        makeAchievementItem({
          achievementId: "other-map",
          name: "別マップの実績",
          common: false,
          mapMasterIds: ["map_west"],
        }),
        makeAchievementItem({
          achievementId: "auto",
          name: "自動実績",
          ruleKind: "total_assets",
          threshold: "200000",
        }),
        makeAchievementItem({
          achievementId: "retired",
          name: "廃止済みの実績",
          retiredAt: "2026-01-01T00:00:00.000Z",
        }),
      ],
      claims: [
        makeAchievementClaim({ memberId: "member_eu" }),
        makeAchievementClaim({ claimId: "claim-import", sourceKind: "import" }),
      ],
    });
    server.use(http.get("/api/achievements/catalog", () => HttpResponse.json(catalog)));
    renderFields();
    await user.click(screen.getByRole("button", { name: "試合と一緒に実績を記録" }));
    expect(
      await screen.findByRole("link", { name: "手入力のテスト実績・いーゆーの保存済み実績を見る" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("checkbox", { name: "手入力のテスト実績・いーゆー" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("翌日の実績")).not.toBeInTheDocument();
    expect(screen.queryByText("別マップの実績")).not.toBeInTheDocument();
    expect(screen.queryByText("自動実績")).not.toBeInTheDocument();
    expect(screen.queryByText("廃止済みの実績")).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "手入力のテスト実績・ぽんた" }));
    expect(JSON.parse(screen.getByLabelText("追加する実績").textContent!)).toEqual([
      {
        achievementId: "achievement-manual",
        achievementName: "手入力のテスト実績",
        memberId: "member_ponta",
        expectedItemVersion: "1",
        expectedClaimVersion: null,
      },
    ]);
  });

  it("retains a stale selection and requires an explicit choice of its current version", async () => {
    const user = userEvent.setup();
    const catalog = makeAchievementCatalog({ items: [makeAchievementItem()] });
    server.use(http.get("/api/achievements/catalog", () => HttpResponse.json(catalog)));
    const client = renderFields();
    await user.click(screen.getByRole("button", { name: "試合と一緒に実績を記録" }));
    await user.click(await screen.findByRole("checkbox", { name: "手入力のテスト実績・ぽんた" }));
    catalog.items[0]!.version = "2";
    await act(() =>
      client.invalidateQueries({ queryKey: achievementKeys.catalog("gt_momotetsu_2") }),
    );
    expect(await screen.findByText("選択した実績を確認してください")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "手入力のテスト実績・ぽんた" })).toBeChecked();
    expect(
      JSON.parse(screen.getByLabelText("追加する実績").textContent!)[0].expectedItemVersion,
    ).toBe("1");
    await user.click(screen.getByRole("button", { name: "最新内容で選び直す" }));
    expect(screen.queryByText("選択した実績を確認してください")).not.toBeInTheDocument();
    expect(
      JSON.parse(screen.getByLabelText("追加する実績").textContent!)[0].expectedItemVersion,
    ).toBe("2");
  });
});

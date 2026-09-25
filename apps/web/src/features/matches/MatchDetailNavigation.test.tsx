import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { MatchDetailPage } from "@/features/matches/MatchDetailPage";
import { invalidateAfterMatchUpdated } from "@/shared/api/cacheInvalidation";
import type { MatchNeighbor } from "@/shared/api/detailReadResult";
import type { MatchDetailResponse } from "@/shared/api/matches";
import { matchKeys } from "@/shared/api/queryKeys";
import { withReturnTo } from "@/shared/navigation/returnTo";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { makeFourPlayerResults, makeMatchDetail } from "@/test/factories";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

function neighbor(match: MatchDetailResponse): MatchNeighbor {
  return {
    matchId: match.matchId,
    heldEventId: match.heldEventId,
    heldAt: match.heldAt ?? match.playedAt,
    playedAt: match.playedAt,
    matchNoInEvent: match.matchNoInEvent,
  };
}

function makeJourney() {
  const a = makeMatchDetail({
    matchId: "journey-a",
    heldEventId: "held-a",
    matchNoInEvent: 7,
    playedAt: "2026-05-01T12:00:00Z",
    heldAt: "2026-05-01T10:00:00Z",
    note: { body: "開催Aのメモ", version: "note-a" },
    players: makeFourPlayerResults(),
  });
  const b = makeMatchDetail({
    matchId: "journey-b",
    heldEventId: "held-b",
    matchNoInEvent: 7,
    gameTitleId: "game-b",
    seasonMasterId: "season-b",
    mapMasterId: "map-b",
    gameTitleName: "別の作品",
    seasonName: "別のシーズン",
    mapName: "別のマップ",
    playedAt: "2026-05-02T12:00:00Z",
    heldAt: "2026-05-02T10:00:00Z",
    note: { body: "開催Bのメモ", version: "note-b" },
    players: makeFourPlayerResults(),
  });
  const c = makeMatchDetail({
    matchId: "journey-c",
    heldEventId: "held-c",
    matchNoInEvent: 2,
    playedAt: "2026-05-03T12:00:00Z",
    heldAt: "2026-05-03T10:00:00Z",
    note: { body: "開催Cのメモ", version: "note-c" },
    players: makeFourPlayerResults(),
  });
  a.navigation = { next: neighbor(b) };
  b.navigation = { previous: neighbor(a), next: neighbor(c) };
  c.navigation = { previous: neighbor(b) };
  return { a, b, c };
}

const origin = "/matches?status=confirmed&cursor=cursor-alpha#results";
function detailHref(id: string) {
  return withReturnTo(`/matches/${id}`, origin);
}

function notFound() {
  return HttpResponse.json(
    {
      type: "about:blank",
      title: "Not Found",
      status: 404,
      code: "NOT_FOUND",
      detail: "match was not found",
    },
    { status: 404 },
  );
}

function installDetails(records: MatchDetailResponse[]) {
  const details = new Map(records.map((match) => [match.matchId, match]));
  server.use(
    http.get("/api/matches/:matchId", ({ params }) => {
      const match = details.get(String(params["matchId"]));
      return match ? HttpResponse.json(match) : notFound();
    }),
  );
  return details;
}

function renderJourney(firstId = "journey-a") {
  const queryClient = createTestQueryClient();
  const router = createMemoryRouter(
    [
      { path: "/matches/:matchId", element: <MatchDetailPage /> },
      { path: "/matches", element: <p>元の試合一覧</p> },
      { path: "/held-events/:heldEventId", element: <p>所属開催</p> },
    ],
    { initialEntries: [origin, detailHref(firstId)], initialIndex: 1 },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { queryClient, router };
}

function nextMatch() {
  return screen.getByRole("link", { name: /^後の試合/u });
}
function currentHref(router: ReturnType<typeof createMemoryRouter>) {
  const { pathname, search, hash } = router.state.location;
  return `${pathname}${search}${hash}`;
}

async function editNote(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "編集" }));
  const input = screen.getByRole("textbox", { name: "試合メモ" });
  await user.clear(input);
  await user.type(input, "まだ保存していない本文");
  return input;
}

describe("MatchDetail adjacent navigation", () => {
  beforeEach(() => setDevUser());

  it("crosses held events and comparison scopes while keeping origin, current actions and history", async () => {
    const user = userEvent.setup();
    const { a, b, c } = makeJourney();
    installDetails([a, b, c]);
    const { router } = renderJourney();
    await screen.findByText("開催Aのメモ");
    expect(nextMatch()).toHaveAttribute("href", detailHref(b.matchId));
    await user.click(nextMatch());
    await screen.findByText("開催Bのメモ");
    expect(currentHref(router)).toBe(detailHref(b.matchId));
    expect(screen.queryByText("開催Aのメモ")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "試合一覧へ戻る" })).toHaveAttribute("href", origin);
    expect(screen.getByRole("link", { name: "この試合の開催を見る" })).toHaveAttribute(
      "href",
      "/held-events/held-b",
    );
    expect(screen.getByRole("link", { name: "試合結果を編集" })).toHaveAttribute(
      "href",
      withReturnTo("/matches/journey-b/edit", detailHref(b.matchId)),
    );
    expect(screen.getByRole("link", { name: "この試合を出力" })).toHaveAttribute(
      "href",
      withReturnTo("/exports?matchId=journey-b", detailHref(b.matchId)),
    );
    const comparison = new URL(
      screen.getByRole("link", { name: "前後の戦績を見る" }).getAttribute("href") ?? "",
      "https://momo-result.local",
    );
    expect(Object.fromEntries(comparison.searchParams)).toMatchObject({
      gameTitleId: "game-b",
      seasonMasterId: "season-b",
      mapMasterId: "map-b",
      focusMatchId: "journey-b",
      returnTo: detailHref(b.matchId),
    });
    const heading = screen.getByRole("heading", { level: 1, name: "第7試合の結果" });
    expect(heading).toHaveFocus();
    expect(heading).toHaveAccessibleDescription(/2026\/05\/02/u);
    await user.click(nextMatch());
    await screen.findByText("開催Cのメモ");
    expect(screen.queryByRole("link", { name: /^後の試合/u })).not.toBeInTheDocument();
    await act(async () => {
      await router.navigate(-1);
    });
    await screen.findByText("開催Bのメモ");
    expect(currentHref(router)).toBe(detailHref(b.matchId));
    await user.click(screen.getByRole("link", { name: "試合一覧へ戻る" }));
    expect(await screen.findByText("元の試合一覧")).toBeInTheDocument();
    expect(currentHref(router)).toBe(origin);
  });

  it("keeps dirty notes on cancel, protects a sent save, and never carries the note to the next match", async () => {
    const user = userEvent.setup();
    const { a, b } = makeJourney();
    const records = installDetails([a, b]);
    const saved = createDeferred();
    server.use(
      http.put("/api/matches/:matchId/note", async () => {
        await saved.promise;
        records.set(a.matchId, {
          ...a,
          note: {
            body: "まだ保存していない本文",
            version: "saved",
            updatedByDisplayName: "ぽんた",
            updatedAt: "2026-05-04T12:00:00Z",
          },
        });
        return HttpResponse.json({ matchId: a.matchId, version: "saved" });
      }),
    );
    renderJourney();
    await screen.findByText("開催Aのメモ");
    const input = await editNote(user);
    await user.click(nextMatch());
    const discard = await screen.findByRole("alertdialog", {
      name: "未保存の変更を破棄しますか？",
    });
    await user.click(within(discard).getByRole("button", { name: "キャンセル" }));
    expect(input).toHaveValue("まだ保存していない本文");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await user.click(nextMatch());
    const pending = await screen.findByRole("dialog", { name: "処理結果を確認しています" });
    expect(within(pending).queryByRole("button", { name: "破棄して移動" })).not.toBeInTheDocument();
    await act(async () => saved.resolve());
    await screen.findByText("保存しました");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(nextMatch()).toHaveAttribute("href", detailHref(b.matchId)));
    await user.click(nextMatch());
    await screen.findByText("開催Bのメモ");
    expect(screen.queryByText("まだ保存していない本文")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "試合メモ" })).not.toBeInTheDocument();
  });

  it("prevents deleting a match while its note is dirty or awaiting a write result", async () => {
    const user = userEvent.setup();
    const { a } = makeJourney();
    const records = installDetails([a]);
    const saved = createDeferred();
    let deleteRequests = 0;
    server.use(
      http.put("/api/matches/:matchId/note", async () => {
        await saved.promise;
        records.set(a.matchId, {
          ...a,
          note: { body: "まだ保存していない本文", version: "saved" },
        });
        return HttpResponse.json({ matchId: a.matchId, version: "saved" });
      }),
      http.delete("/api/matches/:matchId", () => {
        deleteRequests += 1;
        records.delete(a.matchId);
        return HttpResponse.json({ deleted: true, matchId: a.matchId });
      }),
    );
    const { router } = renderJourney();
    await screen.findByText("開催Aのメモ");
    await user.click(screen.getByRole("button", { name: "削除" }));
    const dialog = await screen.findByRole("alertdialog", { name: "試合を削除しますか？" });
    expect(screen.queryByRole("button", { name: "編集" })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "キャンセル" }));

    await editNote(user);
    const deleteButton = screen.getByRole("button", { name: "削除" });
    expect(deleteButton).toBeDisabled();
    expect(deleteButton).toHaveAccessibleDescription(
      "メモを保存するか、編集をキャンセルすると試合を削除できます。",
    );
    await user.click(deleteButton);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(deleteButton).toBeEnabled();

    await editNote(user);
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(deleteButton).toBeDisabled();
    expect(deleteButton).toHaveAccessibleDescription(
      "メモの保存・削除が完了するまで、試合は削除できません。",
    );
    await user.click(deleteButton);
    expect(deleteRequests).toBe(0);
    await act(async () => saved.resolve());
    await waitFor(() => expect(deleteButton).toBeEnabled());
    await user.click(deleteButton);
    await user.click(
      within(await screen.findByRole("alertdialog", { name: "試合を削除しますか？" })).getByRole(
        "button",
        { name: "削除する" },
      ),
    );
    expect(await screen.findByText("元の試合一覧")).toBeInTheDocument();
    expect(deleteRequests).toBe(1);
    expect(currentHref(router)).toBe(origin);
  });

  it("does not resurrect a confirmed missing detail on delayed and failed revisits", async () => {
    const { a, b } = makeJourney();
    const records = installDetails([a, b]);
    const { queryClient, router } = renderJourney();
    await screen.findByText("開催Aのメモ");
    records.delete(a.matchId);
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: matchKeys.detail(a.matchId), exact: true });
    });
    await screen.findByRole("heading", { name: "試合が見つかりません" });
    await act(async () => {
      await router.navigate(detailHref(b.matchId));
    });
    await screen.findByText("開催Bのメモ");
    const retry = createDeferred();
    let recover = false;
    server.use(
      http.get("/api/matches/journey-a", async () => {
        if (recover) return HttpResponse.json(a);
        await retry.promise;
        return HttpResponse.json({ detail: "unavailable" }, { status: 500 });
      }),
    );
    await act(async () => {
      await router.navigate(detailHref(a.matchId));
    });
    expect(
      await screen.findByRole("heading", { name: "試合が見つかりません" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("開催Aのメモ")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "前後の試合" })).not.toBeInTheDocument();
    await act(async () => retry.resolve());
    await waitFor(() =>
      expect(queryClient.isFetching({ queryKey: matchKeys.detail(a.matchId) })).toBe(0),
    );
    expect(screen.getByRole("heading", { name: "試合が見つかりません" })).toBeInTheDocument();
    recover = true;
    await userEvent.setup().click(screen.getByRole("button", { name: "再取得" }));
    await screen.findByText("開催Aのメモ");
    expect(nextMatch()).toHaveAttribute("href", detailHref(b.matchId));
  });

  it("retains the local unsaved note when a 404 removes the result and adjacent links", async () => {
    const user = userEvent.setup();
    const { a, b } = makeJourney();
    const records = installDetails([a, b]);
    const { queryClient } = renderJourney();
    await screen.findByText("開催Aのメモ");
    await editNote(user);
    records.delete(a.matchId);
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: matchKeys.detail(a.matchId), exact: true });
    });
    await screen.findByRole("heading", { name: "試合が見つかりません" });
    expect(screen.getByRole("textbox", { name: "退避した未保存の試合メモ" })).toHaveValue(
      "まだ保存していない本文",
    );
    expect(screen.queryByRole("heading", { name: "順位・総資産" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "前後の試合" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "試合一覧へ戻る" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "破棄して移動" }));
    expect(await screen.findByText("元の試合一覧")).toBeInTheDocument();
  });

  it("revalidates inactive details after another match moves and exposes the new destination", async () => {
    const user = userEvent.setup();
    const { a, b, c } = makeJourney();
    installDetails([a, b, c]);
    const { queryClient, router } = renderJourney();
    await screen.findByText("開催Aのメモ");
    await user.click(nextMatch());
    await screen.findByText("開催Bのメモ");
    const updatedA = { ...a, navigation: { next: neighbor(c) } };
    const refresh = createDeferred();
    server.use(
      http.get("/api/matches/journey-a", async () => {
        await refresh.promise;
        return HttpResponse.json(updatedA);
      }),
    );
    await act(async () => {
      await invalidateAfterMatchUpdated(queryClient, b.matchId);
    });
    await act(async () => {
      await router.navigate(detailHref(a.matchId));
    });
    await screen.findByText("開催Aのメモ");
    const paused = nextMatch();
    expect(paused).not.toHaveAttribute("href");
    expect(paused).toHaveAttribute("aria-disabled", "true");
    await act(async () => refresh.resolve());
    await waitFor(() => expect(nextMatch()).toHaveAttribute("href", detailHref(c.matchId)));
    await user.click(nextMatch());
    expect(await screen.findByText("開催Cのメモ")).toBeInTheDocument();
  });
});

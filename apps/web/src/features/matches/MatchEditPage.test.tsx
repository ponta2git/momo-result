import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { lazy, Suspense } from "react";
import {
  createMemoryRouter,
  Link,
  MemoryRouter,
  Route,
  RouterProvider,
  Routes,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MatchEditPage } from "@/features/matches/MatchEditPage";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { installMatchMediaController } from "@/test/doubles/dom";
import type { MatchMediaController } from "@/test/doubles/dom";
import { makeMatchDetail } from "@/test/factories";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

let user: ReturnType<typeof userEvent.setup>;

async function waitForMatchEditReady() {
  expect(await screen.findByRole("button", { name: "開催（必須）を変更" })).toBeEnabled();
}

describe("MatchEditPage", () => {
  let queryClient: QueryClient;
  let matchMedia: MatchMediaController | undefined;
  afterEach(() => {
    matchMedia?.restore();
    matchMedia = undefined;
  });
  beforeEach(() => {
    queryClient = createTestQueryClient();
    user = userEvent.setup();
  });

  it("starts the match detail and independent directories before any directory resolves", async () => {
    setDevUser();
    const directoryGate = createDeferred();
    const requested = new Set<string>();
    server.use(
      http.get("/api/held-events", async () => {
        requested.add("held-events");
        await directoryGate.promise;
        return HttpResponse.json({ items: [] });
      }),
      http.get("/api/game-titles", async () => {
        requested.add("game-titles");
        await directoryGate.promise;
        return HttpResponse.json({ items: [] });
      }),
      http.get("/api/member-aliases", async () => {
        requested.add("member-aliases");
        await directoryGate.promise;
        return HttpResponse.json({ items: [] });
      }),
      http.get("/api/matches/:matchId", ({ params }) => {
        requested.add("match-detail");
        return HttpResponse.json(makeMatchDetail({ matchId: String(params["matchId"]) }));
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/match-1/edit"]}>
          <Routes>
            <Route path="/matches/:matchId/edit" element={<MatchEditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(requested).toEqual(
        new Set(["held-events", "game-titles", "member-aliases", "match-detail"]),
      ),
    );
    directoryGate.resolve();
    await waitForMatchEditReady();
  });

  it("shows a structured loading shell while the saved match is loading", async () => {
    setDevUser();
    const responseGate = createDeferred();
    server.use(
      http.get("/api/matches/:matchId", async ({ params }) => {
        await responseGate.promise;
        return HttpResponse.json(makeMatchDetail({ matchId: String(params["matchId"]) }));
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={["/matches/match-1/edit?returnTo=%2Fmatches%3Fcursor%3Dcursor-2"]}
        >
          <Routes>
            <Route path="/matches/:matchId/edit" element={<MatchEditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByLabelText("試合編集を読み込み中")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "試合内容" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();

    responseGate.resolve();
    await waitForMatchEditReady();
    expect(screen.getByLabelText("試合番号")).toHaveValue("1");
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "編集をやめる" })).toHaveAttribute(
      "href",
      "/matches?cursor=cursor-2",
    );
  });

  it("loads the next match instead of retaining edited state when the route id changes", async () => {
    setDevUser();
    const secondMatchGate = createDeferred();
    server.use(
      http.get("/api/matches/:matchId", async ({ params }) => {
        const matchId = String(params["matchId"]);
        if (matchId === "match-2") {
          await secondMatchGate.promise;
        }
        return HttpResponse.json(
          makeMatchDetail({ matchId, matchNoInEvent: matchId === "match-2" ? 2 : 1 }),
        );
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/match-1/edit"]}>
          <Link to="/matches/match-2/edit">別の試合を編集</Link>
          <Routes>
            <Route path="/matches/:matchId/edit" element={<MatchEditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitForMatchEditReady();
    const matchNumber = screen.getByLabelText("試合番号");
    await user.clear(matchNumber);
    await user.type(matchNumber, "9");

    await user.click(screen.getByRole("link", { name: "別の試合を編集" }));

    expect(await screen.findByLabelText("試合編集を読み込み中")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "開催（必須）を変更" })).not.toBeInTheDocument();

    secondMatchGate.resolve();
    await waitForMatchEditReady();
    expect(screen.getByLabelText("試合番号")).toHaveValue("2");
  });

  it("offers retry when the saved match cannot be loaded", async () => {
    setDevUser();
    queryClient.setDefaultOptions({ queries: { retry: false } });
    server.use(
      http.get("/api/matches/:matchId", () =>
        HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 }),
      ),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/match-1/edit"]}>
          <Routes>
            <Route path="/matches/:matchId/edit" element={<MatchEditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const failureHeading = await screen.findByRole("heading", {
      name: "試合編集を読み込めませんでした",
    });
    expect(failureHeading.closest("section")).not.toBeNull();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "試合編集を再読み込み" })).toBeEnabled();
  });

  it("distinguishes a missing match from a retryable edit load failure", async () => {
    setDevUser();
    queryClient.setDefaultOptions({ queries: { retry: false } });
    server.use(
      http.get("/api/matches/:matchId", () =>
        HttpResponse.json(
          {
            type: "about:blank",
            title: "Not Found",
            status: 404,
            code: "NOT_FOUND",
            detail: "match not found",
          },
          { status: 404 },
        ),
      ),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/missing/edit"]}>
          <Routes>
            <Route path="/matches/:matchId/edit" element={<MatchEditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const missingHeading = await screen.findByRole("heading", {
      name: "試合が見つかりませんでした",
    });
    expect(missingHeading.closest("section")).not.toBeNull();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "試合編集を再読み込み" })).not.toBeInTheDocument();
  });

  it.each(["loader", "component"] as const)(
    "keeps save unavailable until the destination %s is ready",
    async (delayKind) => {
      setDevUser();
      const destinationGate = createDeferred();
      let destinationStarted = false;
      let saveCount = 0;
      const waitForDestination = async () => {
        destinationStarted = true;
        await destinationGate.promise;
        return null;
      };
      const LazyDetail = lazy(async () => {
        await waitForDestination();
        return { default: () => <p>保存済みの試合</p> };
      });
      server.use(
        http.put("/api/matches/:matchId", ({ params }) => {
          saveCount += 1;
          return HttpResponse.json(makeMatchDetail({ matchId: String(params["matchId"]) }));
        }),
      );
      const router = createMemoryRouter(
        [
          { path: "/matches/:matchId/edit", element: <MatchEditPage /> },
          delayKind === "loader"
            ? {
                path: "/matches/:matchId",
                loader: waitForDestination,
                element: <p>保存済みの試合</p>,
              }
            : { path: "/matches/:matchId", element: <LazyDetail /> },
        ],
        { initialEntries: ["/matches/match-1/edit"] },
      );
      render(
        <QueryClientProvider client={queryClient}>
          <Suspense fallback={<p>移動先を準備中</p>}>
            <RouterProvider router={router} />
          </Suspense>
        </QueryClientProvider>,
      );
      await waitForMatchEditReady();
      await user.click(screen.getByRole("button", { name: "保存" }));
      await waitFor(() => expect(destinationStarted).toBe(true));
      await waitFor(() => expect(queryClient.isMutating()).toBe(0));
      const saving = screen.getByRole("button", { name: "保存中…" });
      expect(saving).toBeDisabled();
      await user.click(saving);
      expect(saveCount).toBe(1);

      destinationGate.resolve();
      expect(await screen.findByText("保存済みの試合")).toBeInTheDocument();
    },
  );

  it.each([false, true])(
    "rejects incomplete input and reveals its editor before saving (mobile: %s)",
    async (mobile) => {
      matchMedia = installMatchMediaController(mobile);
      setDevUser();
      const savedValues: unknown[] = [];
      server.use(
        http.put("/api/matches/:matchId", async ({ request, params }) => {
          savedValues.push(await request.json());
          return HttpResponse.json(makeMatchDetail({ matchId: String(params["matchId"]) }));
        }),
      );
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/matches/match-1/edit"]}>
            <Routes>
              <Route path="/matches/:matchId/edit" element={<MatchEditPage />} />
              <Route path="/matches/:matchId" element={<p>保存済みの試合</p>} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
      await waitForMatchEditReady();
      const revenue = screen.getByRole("textbox", { name: "ぽんた 収益（万円）" });
      await user.clear(revenue);
      await user.type(revenue, "-");
      if (mobile) {
        await user.click(screen.getByRole("button", { name: /^ぽんた.*閉じる/u }));
        expect(
          screen.queryByRole("textbox", { name: "ぽんた 収益（万円）" }),
        ).not.toBeInTheDocument();
      }
      await user.click(screen.getByRole("button", { name: "保存" }));

      expect(
        await screen.findByRole("heading", { name: "入力内容を確認してください" }),
      ).toBeVisible();
      const invalidRevenue = screen.getByRole("textbox", { name: "ぽんた 収益（万円）" });
      expect(invalidRevenue).toHaveValue("-");
      expect(invalidRevenue).toHaveAttribute("aria-invalid", "true");
      expect(invalidRevenue).toHaveFocus();
      expect(savedValues).toEqual([]);

      await user.type(invalidRevenue, "42");
      await user.click(screen.getByRole("button", { name: "保存" }));
      expect(await screen.findByText("保存済みの試合")).toBeInTheDocument();
      expect(savedValues).toEqual([
        expect.objectContaining({
          players: expect.arrayContaining([
            expect.objectContaining({ memberId: "member_ponta", revenueManYen: -42 }),
          ]),
        }),
      ]);
    },
  );

  it("keeps in-flight input and navigation locked, then restores editing after failure", async () => {
    setDevUser();
    const response = createDeferred();
    const submissions: unknown[] = [];
    server.use(
      http.put("/api/matches/:matchId", async ({ params, request }) => {
        submissions.push(await request.json());
        if (submissions.length === 1) {
          await response.promise;
          return HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 });
        }
        return HttpResponse.json(makeMatchDetail({ matchId: String(params["matchId"]) }));
      }),
    );
    const router = createMemoryRouter(
      [
        { path: "/matches/:matchId/edit", element: <MatchEditPage /> },
        { path: "/matches/:matchId", element: <p>保存済みの試合</p> },
        { path: "/outside", element: <p>別の作業</p> },
      ],
      { initialEntries: ["/matches/match-1/edit"] },
    );
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await waitForMatchEditReady();
    const matchNumber = screen.getByLabelText("試合番号");
    await user.clear(matchNumber);
    await user.type(matchNumber, "9");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(submissions[0]).toEqual(expect.objectContaining({ matchNoInEvent: 9 }));
    expect(matchNumber).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "ぽんた 収益（万円）" })).toBeDisabled();
    const unloading = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unloading);
    expect(unloading.defaultPrevented).toBe(true);
    act(() => {
      void router.navigate("/outside");
    });
    expect(await screen.findByRole("dialog", { name: "処理結果を確認しています" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "破棄して移動" })).not.toBeInTheDocument();

    response.resolve();
    expect(
      await screen.findByRole("heading", { name: "変更を保存できませんでした" }),
    ).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/matches/match-1/edit");
    expect(matchNumber).toHaveValue("9");
    expect(matchNumber).toBeEnabled();
    const executionArea = screen.getByRole("region", { name: "入力内容の確定" });
    expect(within(executionArea).getByRole("alert")).toHaveTextContent("入力内容は保持しています");
    expect(within(executionArea).getByRole("button", { name: "保存" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("保存済みの試合")).toBeInTheDocument();
    expect(submissions).toHaveLength(2);
    expect(submissions[1]).toEqual(submissions[0]);
  });

  it("recovers incomplete input only for the same match even when saved values are identical", async () => {
    setDevUser();
    server.use(
      http.get("/api/matches/:matchId", ({ params }) =>
        HttpResponse.json(makeMatchDetail({ matchId: String(params["matchId"]) })),
      ),
    );
    function mountEditor(matchId: string) {
      return render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[`/matches/${matchId}/edit`]}>
            <Routes>
              <Route path="/matches/:matchId/edit" element={<MatchEditPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    }
    const first = mountEditor("match-a");
    await waitForMatchEditReady();
    const revenue = screen.getByRole("textbox", { name: "ぽんた 収益（万円）" });
    await user.clear(revenue);
    await user.type(revenue, "-");
    first.unmount();
    const second = mountEditor("match-b");
    await waitForMatchEditReady();
    expect(screen.queryByRole("button", { name: "一時保存を復元" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "ぽんた 収益（万円）" })).not.toHaveValue("-");
    second.unmount();
    mountEditor("match-a");
    await user.click(await screen.findByRole("button", { name: "一時保存を復元" }));
    expect(screen.getByRole("textbox", { name: "ぽんた 収益（万円）" })).toHaveValue("-");
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { ErrorBoundary } from "@/app/ErrorBoundary";
import { appRoutes } from "@/app/router";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

function renderApp(initialEntry: string) {
  const queryClient = createTestQueryClient();
  const router = createMemoryRouter(appRoutes, {
    initialEntries: [initialEntry],
  });

  render(
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <RouterProvider router={router} />
      </ErrorBoundary>
    </QueryClientProvider>,
  );

  return { queryClient, router };
}

describe("app routing", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("redirects / to /login when unauthenticated", async () => {
    const { router } = renderApp("/");

    expect(await screen.findByRole("heading", { name: "ログイン" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ログイン" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("redirects / to /matches when authenticated", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    const { router } = renderApp("/");

    expect(await screen.findByRole("heading", { name: "試合" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/matches");
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeInTheDocument();
  });

  it("redirects protected routes to /login with next query when unauthenticated", async () => {
    const { router } = renderApp("/exports");

    expect(await screen.findByRole("heading", { name: "ログイン" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toContain("next=%2Fexports");
  });

  it("redirects /login to /matches when authenticated", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    const { router } = renderApp("/login");

    expect(await screen.findByRole("heading", { name: "試合" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/matches");
  });

  it("renders edit mode at /matches/:matchId/edit", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    const { router } = renderApp("/matches/match-1/edit");

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/matches/match-1/edit");
    });
  });
});

import { QueryClientProvider, useSuspenseQuery } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "@/app/AppShell";
import { createTestQueryClient } from "@/test/queryClient";

vi.mock("@/app/AppGlobalNav", () => ({
  AppGlobalNav: () => <nav aria-label="グローバルナビゲーション" />,
}));

vi.mock("@/shared/ui/feedback/ToastHost", () => ({
  ToastHost: () => <div data-testid="toast-host" />,
}));

function StatefulRoute() {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount((value) => value + 1)}>
      操作回数 {count}
    </button>
  );
}

function BrokenRoute(): ReactNode {
  throw new Error("route failed");
}

describe("AppShell", () => {
  it("renders route content without depending on an animation lifecycle", async () => {
    const router = createMemoryRouter(
      [
        {
          element: <AppShell />,
          children: [{ element: <h1>ルート本文</h1>, index: true }],
          path: "/",
        },
      ],
      { initialEntries: ["/"] },
    );

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("toast-host")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "ルート本文" })).toBeVisible();
    expect(screen.queryByTestId("blocked-animation-lifecycle")).not.toBeInTheDocument();
  });

  it("resets a cached query error before rendering a newly selected route", async () => {
    const queryClient = createTestQueryClient();
    const queryKey = ["app-shell", "route-recovery"] as const;
    await queryClient
      .fetchQuery({
        queryKey,
        queryFn: async () => {
          throw new Error("cached route error");
        },
      })
      .catch(() => undefined);
    let recoveryAttempts = 0;

    function RecoveredRoute() {
      const query = useSuspenseQuery({
        queryKey,
        queryFn: async () => {
          recoveryAttempts += 1;
          return "復旧したルート";
        },
      });
      return <h1>{query.data}</h1>;
    }

    const router = createMemoryRouter(
      [
        {
          element: <AppShell />,
          children: [
            { element: <h1>移動前のルート</h1>, index: true },
            { element: <RecoveredRoute />, path: "recovered" },
          ],
          path: "/",
        },
      ],
      { initialEntries: ["/"] },
    );

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "移動前のルート" })).toBeVisible();
    await act(async () => {
      await router.navigate("/recovered");
    });

    expect(await screen.findByRole("heading", { name: "復旧したルート" })).toBeVisible();
    expect(screen.queryByText("cached route error")).not.toBeInTheDocument();
    expect(recoveryAttempts).toBe(1);
  });

  it("preserves route-local state across a same-path search change", async () => {
    const user = userEvent.setup();

    const router = createMemoryRouter(
      [
        {
          element: <AppShell />,
          children: [{ element: <StatefulRoute />, index: true }],
          path: "/",
        },
      ],
      { initialEntries: ["/?view=first"] },
    );

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "操作回数 0" }));
    expect(screen.getByRole("button", { name: "操作回数 1" })).toBeInTheDocument();

    await act(async () => {
      await router.navigate("/?view=second");
    });

    expect(screen.getByRole("button", { name: "操作回数 1" })).toBeInTheDocument();
    expect(router.state.location.search).toBe("?view=second");
  });

  it("resets the query and route error boundary together on retry", async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const queryClient = createTestQueryClient();
    const queryKey = ["app-shell", "retry-recovery"] as const;
    let attempts = 0;

    function RetryRoute() {
      const query = useSuspenseQuery({
        queryKey,
        queryFn: async () => {
          attempts += 1;
          if (attempts === 1) {
            throw new Error("first route request failed");
          }
          return "再試行で復旧";
        },
      });
      return <h1>{query.data}</h1>;
    }

    const router = createMemoryRouter(
      [
        {
          element: <AppShell />,
          children: [{ element: <RetryRoute />, index: true }],
          path: "/",
        },
      ],
      { initialEntries: ["/"] },
    );

    try {
      render(
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      );

      await user.click(await screen.findByRole("button", { name: "もう一度読み込む" }));

      expect(await screen.findByRole("heading", { name: "再試行で復旧" })).toBeVisible();
      expect(attempts).toBe(2);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("passes safe return context from the location to the route error boundary", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const router = createMemoryRouter(
      [
        {
          element: <AppShell />,
          children: [{ element: <BrokenRoute />, path: "analytics/series" }],
          path: "/",
        },
      ],
      { initialEntries: ["/analytics/series?returnTo=%2Fmatches%2Fmatch-1"] },
    );

    try {
      render(
        <QueryClientProvider client={createTestQueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      );

      const surface = await screen.findByRole("region", {
        name: "画面の読み込みに失敗しました",
      });
      const returnLink = screen.getByRole("link", { name: "前の画面へ戻る" });
      expect(surface).toContainElement(returnLink);
      expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
      expect(returnLink).toHaveAttribute("href", "/matches/match-1");
    } finally {
      consoleError.mockRestore();
    }
  });
});

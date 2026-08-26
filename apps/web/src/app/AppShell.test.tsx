import { QueryClientProvider, useSuspenseQuery } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "@/app/AppShell";
import { createTestQueryClient } from "@/test/queryClient";

vi.mock("@/shared/auth/useAuth", () => ({
  useAuth: () => ({
    auth: { displayName: "テストユーザー", isAdmin: false },
    isAuthenticated: true,
    isLogoutPending: false,
    logout: () => undefined,
  }),
}));

vi.mock("@/shared/ui/feedback/ToastHost", () => ({
  ToastHost: () => null,
}));

vi.mock("@/shared/ui/layout/GlobalNav", () => ({
  GlobalNav: () => <nav aria-label="グローバルナビゲーション" />,
}));

function StatefulRoute() {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount((value) => value + 1)}>
      操作回数 {count}
    </button>
  );
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
});

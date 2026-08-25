import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "@/app/AppShell";
import { createTestQueryClient } from "@/test/queryClient";

vi.mock("motion/react", () => ({
  AnimatePresence: () => <div data-testid="blocked-animation-lifecycle" />,
  motion: {
    div: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  },
}));

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

vi.mock("@/shared/ui/motion/MotionProvider", () => ({
  MotionProvider: ({ children }: { children: ReactNode }) => children,
}));

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
});

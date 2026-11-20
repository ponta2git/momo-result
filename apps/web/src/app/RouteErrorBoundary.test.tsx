import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { lazy, Suspense } from "react";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { RouteErrorBoundary } from "@/app/RouteErrorBoundary";
import { appRoutes } from "@/app/router";
import { loadLazyModule, reloadCurrentPage } from "@/shared/lib/moduleLoadError";
import { createTestQueryClient } from "@/test/queryClient";

vi.mock("@/shared/auth/DevUserPicker", () => {
  throw new TypeError("Development account picker could not load");
});

vi.mock("@/shared/lib/moduleLoadError", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, reloadCurrentPage: vi.fn() };
});

function MaybeBroken({ shouldThrow }: { shouldThrow: () => boolean }) {
  if (shouldThrow()) throw new Error("route failed");
  return <p>回復しました</p>;
}

describe("RouteErrorBoundary", () => {
  it("keeps the login destination and provides recovery when the development account picker cannot load", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("VITE_DEV_USER", "");
    const router = createMemoryRouter(appRoutes, { initialEntries: ["/login?next=%2Fexports"] });
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("button", { name: "画面を再読み込み" })).toBeVisible();
    expect(screen.getByRole("main")).toContainElement(screen.getByRole("alert"));
    expect(router.state.location.search).toBe("?next=%2Fexports");
  });

  it("reloads the page when an actual React.lazy loader rejects", async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onReset = vi.fn();
    let attempts = 0;
    const loader = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new TypeError("Failed to fetch dynamically imported module: /assets/route.js");
      }
      return { default: () => <p>遅延ルートを読み込みました</p> };
    });
    const LazyRoute = lazy(() => loadLazyModule(loader));

    try {
      render(
        <MemoryRouter>
          <RouteErrorBoundary onReset={onReset} pathname="/matches">
            <Suspense fallback={<p>ルートを読み込み中</p>}>
              <LazyRoute />
            </Suspense>
          </RouteErrorBoundary>
        </MemoryRouter>,
      );

      expect(
        await screen.findByText("画面を構成するファイルを取得できませんでした。", {
          exact: false,
        }),
      ).toBeInTheDocument();
      expect(loader).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole("button", { name: "画面を再読み込み" }));

      expect(reloadCurrentPage).toHaveBeenCalledTimes(1);
      expect(onReset).not.toHaveBeenCalled();
      expect(loader).toHaveBeenCalledTimes(1);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("recovers when navigation changes the failed route", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = render(
      <MemoryRouter>
        <RouteErrorBoundary pathname="/matches">
          <MaybeBroken shouldThrow={() => true} />
        </RouteErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("応答を受け取れませんでした。");

    view.rerender(
      <MemoryRouter>
        <RouteErrorBoundary pathname="/analytics/series">
          <MaybeBroken shouldThrow={() => false} />
        </RouteErrorBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByText("回復しました")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

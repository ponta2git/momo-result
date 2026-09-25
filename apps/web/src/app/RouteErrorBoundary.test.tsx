import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { lazy, Suspense } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { RouteErrorBoundary } from "@/app/RouteErrorBoundary";
import { loadLazyModule, reloadCurrentPage } from "@/shared/lib/moduleLoadError";

vi.mock("@/shared/lib/moduleLoadError", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, reloadCurrentPage: vi.fn() };
});

function MaybeBroken({ shouldThrow }: { shouldThrow: () => boolean }) {
  if (shouldThrow()) throw new Error("route failed");
  return <p>回復しました</p>;
}

describe("RouteErrorBoundary", () => {
  it("retries a recoverable route render failure in place", async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let shouldThrow = true;
    const onReset = vi.fn(() => {
      shouldThrow = false;
    });

    try {
      render(
        <RouteErrorBoundary onReset={onReset} pathname="/analytics/series">
          <MaybeBroken shouldThrow={() => shouldThrow} />
        </RouteErrorBoundary>,
      );

      const retry = await screen.findByRole("button", { name: "もう一度読み込む" });
      const surface = screen.getByRole("region", { name: "画面の読み込みに失敗しました" });
      expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
      expect(surface).toContainElement(retry);

      await user.click(retry);

      expect(onReset).toHaveBeenCalledTimes(1);
      expect(screen.getByText("回復しました")).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
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

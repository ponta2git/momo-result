import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { lazy, Suspense } from "react";
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
        <RouteErrorBoundary onReset={onReset}>
          <MaybeBroken shouldThrow={() => shouldThrow} />
        </RouteErrorBoundary>,
      );

      const retry = await screen.findByRole("button", { name: "もう一度読み込む" });
      expect(
        screen.getByRole("heading", { level: 1, name: "画面の読み込みに失敗しました" }),
      ).toBeInTheDocument();

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
        <RouteErrorBoundary onReset={onReset}>
          <Suspense fallback={<p>ルートを読み込み中</p>}>
            <LazyRoute />
          </Suspense>
        </RouteErrorBoundary>,
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
});

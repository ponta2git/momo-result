import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { lazy, Suspense } from "react";
import { describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "@/app/ErrorBoundary";
import { loadLazyModule, reloadCurrentPage } from "@/shared/lib/moduleLoadError";

vi.mock("@/shared/lib/moduleLoadError", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, reloadCurrentPage: vi.fn() };
});

function MaybeBroken({ shouldThrow }: { shouldThrow: () => boolean }) {
  if (shouldThrow()) throw new Error("app failed");
  return <p>アプリを再表示しました</p>;
}

describe("ErrorBoundary", () => {
  it("redisplays the application after a recoverable render failure", async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let shouldThrow = true;

    try {
      render(
        <ErrorBoundary>
          <MaybeBroken shouldThrow={() => shouldThrow} />
        </ErrorBoundary>,
      );

      const redisplay = await screen.findByRole("button", { name: "画面を再表示" });
      expect(screen.getByRole("heading", { name: "画面を表示できません" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();

      shouldThrow = false;
      await user.click(redisplay);

      expect(screen.getByText("アプリを再表示しました")).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("reloads the page when an actual React.lazy loader rejects", async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let attempts = 0;
    const loader = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("Loading chunk login-page failed.");
        error.name = "ChunkLoadError";
        throw error;
      }
      return { default: () => <p>遅延画面を読み込みました</p> };
    });
    const LazyPage = lazy(() => loadLazyModule(loader));

    try {
      render(
        <ErrorBoundary>
          <Suspense fallback={<p>画面を読み込み中</p>}>
            <LazyPage />
          </Suspense>
        </ErrorBoundary>,
      );

      expect(
        await screen.findByText("画面を構成するファイルを取得できませんでした。", {
          exact: false,
        }),
      ).toBeInTheDocument();
      expect(loader).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole("button", { name: "画面を再読み込み" }));

      expect(reloadCurrentPage).toHaveBeenCalledTimes(1);
      expect(loader).toHaveBeenCalledTimes(1);
    } finally {
      consoleError.mockRestore();
    }
  });
});

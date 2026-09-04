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
      const heading = screen.getByRole("heading", {
        level: 1,
        name: "画面の読み込みに失敗しました",
      });
      expect(heading).toBeInTheDocument();
      const frame = heading.closest(".mx-auto");
      expect(frame?.children).toHaveLength(2);
      expect(frame?.children.item(0)).toContainElement(heading);
      expect(frame?.children.item(1)).toContainElement(retry);

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

  it("keeps detail navigation and eyebrow ahead of the terminal surface", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      render(
        <MemoryRouter>
          <RouteErrorBoundary pathname="/held-events/held-1">
            <MaybeBroken shouldThrow={() => true} />
          </RouteErrorBoundary>
        </MemoryRouter>,
      );

      const heading = await screen.findByRole("heading", {
        level: 1,
        name: "画面の読み込みに失敗しました",
      });
      const header = heading.closest("header");
      const frame = header?.parentElement;
      const back = screen.getByRole("link", { name: "開催履歴へ戻る" });
      expect(back).toHaveAttribute("href", "/held-events");
      expect(header).toHaveTextContent("開催記録");
      expect(header).toHaveTextContent("試合数・下書き数は未取得です。");
      expect(screen.getByRole("navigation", { name: "この開催の関連操作" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "試合検索で見る" })).toHaveAttribute(
        "href",
        "/matches?heldEventId=held-1&sort=match_no_asc&returnTo=%2Fheld-events%2Fheld-1",
      );
      expect(frame?.children).toHaveLength(3);
      expect(frame?.children.item(0)).toContainElement(back);
      expect(frame?.children.item(1)).toBe(header);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("keeps workspace exit navigation in the header without a duplicate leading action", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      render(
        <MemoryRouter>
          <RouteErrorBoundary pathname="/matches/new">
            <MaybeBroken shouldThrow={() => true} />
          </RouteErrorBoundary>
        </MemoryRouter>,
      );

      const heading = await screen.findByRole("heading", {
        level: 1,
        name: "画面の読み込みに失敗しました",
      });
      const header = heading.closest("header");
      const exit = screen.getByRole("link", { name: "入力をやめる" });
      expect(exit).toHaveAttribute("href", "/matches");
      expect(header).toContainElement(exit);
      expect(header?.parentElement?.children).toHaveLength(2);
      expect(screen.getAllByRole("link", { name: "入力をやめる" })).toHaveLength(1);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("keeps query-known review context in the terminal header", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      render(
        <MemoryRouter>
          <RouteErrorBoundary pathname="/review/session-1" search="?sample=1">
            <MaybeBroken shouldThrow={() => true} />
          </RouteErrorBoundary>
        </MemoryRouter>,
      );

      const heading = await screen.findByRole("heading", {
        level: 1,
        name: "画面の読み込みに失敗しました",
      });
      expect(heading.closest("header")).toHaveTextContent("サンプルの読み取り結果で表示中");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("keeps a safe return context between the settings header and terminal surface", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      render(
        <MemoryRouter>
          <RouteErrorBoundary
            pathname="/admin/masters"
            search="?returnTo=%2Freview%2Fsession-1&handoffId=handoff-1"
          >
            <MaybeBroken shouldThrow={() => true} />
          </RouteErrorBoundary>
        </MemoryRouter>,
      );

      const heading = await screen.findByRole("heading", {
        level: 1,
        name: "画面の読み込みに失敗しました",
      });
      const header = heading.closest("header");
      const frame = header?.parentElement;
      const returnLink = screen.getByRole("link", { name: "元の画面へ戻る" });
      expect(header).toHaveTextContent("管理");
      expect(returnLink).toHaveAttribute("href", "/review/session-1?handoffId=handoff-1");
      expect(frame?.children).toHaveLength(3);
      expect(frame?.children.item(1)).toContainElement(returnLink);
      expect(frame?.children.item(2)).toContainElement(
        screen.getByRole("button", { name: "もう一度読み込む" }),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("keeps route-known match actions in a terminal header", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      render(
        <MemoryRouter>
          <RouteErrorBoundary pathname="/matches" search="?status=confirmed">
            <MaybeBroken shouldThrow={() => true} />
          </RouteErrorBoundary>
        </MemoryRouter>,
      );

      const heading = await screen.findByRole("heading", {
        level: 1,
        name: "画面の読み込みに失敗しました",
      });
      const header = heading.closest("header");
      const actionGroup = screen.getByRole("group", { name: "試合を登録" });
      expect(header).toContainElement(actionGroup);
      expect(screen.getByRole("link", { name: "OCR取り込み" })).toHaveAttribute(
        "href",
        "/ocr/new?returnTo=%2Fmatches%3Fstatus%3Dconfirmed",
      );
      expect(screen.getByRole("link", { name: "手入力で作成" })).toHaveAttribute(
        "href",
        "/matches/new?returnTo=%2Fmatches%3Fstatus%3Dconfirmed",
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});

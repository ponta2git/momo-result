import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ResourcePageState } from "@/shared/ui/feedback/ResourcePageState";

describe("ResourcePageState", () => {
  it("offers a local retry for transient resource failure", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <MemoryRouter>
        <ResourcePageState
          backHref="/matches"
          backLabel="試合一覧へ戻る"
          description="通信状態を確認してください。"
          kind="error"
          retryLabel="試合詳細を再読み込み"
          title="試合詳細を読み込めませんでした"
          onRetry={onRetry}
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "試合詳細を再読み込み" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    const heading = screen.getByRole("heading", {
      level: 1,
      name: "試合詳細を読み込めませんでした",
    });
    const backLink = screen.getByRole("link", { name: "試合一覧へ戻る" });
    expect(heading).toBeInTheDocument();
    expect(backLink).toHaveAttribute("href", "/matches");
    expect(
      backLink.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("does not present retry for a missing resource", () => {
    render(
      <MemoryRouter>
        <ResourcePageState
          backHref="/held-events"
          backLabel="開催履歴へ戻る"
          description="指定された開催は削除されたか、存在しません。開催履歴から別の開催を選んでください。"
          kind="not-found"
          title="開催が見つかりません"
        />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "開催が見つかりません" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "指定された開催は削除されたか、存在しません。開催履歴から別の開催を選んでください。",
    );
    expect(screen.getByRole("link", { name: "開催履歴へ戻る" })).toHaveAttribute(
      "href",
      "/held-events",
    );
  });
});

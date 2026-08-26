import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { createMemoryRouter, Link, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { MatchWorkspaceNavigationGuard } from "@/features/matches/workspace/MatchWorkspaceNavigationGuard";

describe("MatchWorkspaceNavigationGuard", () => {
  it("keeps the user on the page until discarding unsaved changes is confirmed", async () => {
    const user = userEvent.setup();
    const onDiscard = vi.fn();

    function DirtyPage() {
      const navigationAllowedRef = useRef(false);
      return (
        <>
          <p>編集中</p>
          <Link to="/next">次の画面へ</Link>
          <MatchWorkspaceNavigationGuard model={{ dirty: true, navigationAllowedRef, onDiscard }} />
        </>
      );
    }

    const router = createMemoryRouter(
      [
        { path: "/edit", element: <DirtyPage /> },
        { path: "/next", element: <p>移動後</p> },
      ],
      { initialEntries: ["/edit"] },
    );
    render(<RouterProvider router={router} />);

    await user.click(screen.getByRole("link", { name: "次の画面へ" }));
    expect(
      await screen.findByRole("alertdialog", { name: "未保存の変更を破棄しますか？" }),
    ).toBeInTheDocument();
    expect(screen.getByText("編集中")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByText("編集中")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "次の画面へ" }));
    await user.click(await screen.findByRole("button", { name: "破棄して移動" }));

    expect(await screen.findByText("移動後")).toBeInTheDocument();
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });
});

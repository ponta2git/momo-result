import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useActionState, useRef } from "react";
import { createMemoryRouter, Link, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { UnsavedChangesGuard } from "@/shared/navigation/UnsavedChangesGuard";
import { createDeferred } from "@/test/deferred";

describe("UnsavedChangesGuard", () => {
  it("keeps the user on the page until discarding unsaved changes is confirmed", async () => {
    const user = userEvent.setup();
    const onDiscard = vi.fn();

    function DirtyPage() {
      const navigationAllowedRef = useRef(false);
      return (
        <>
          <p>編集中</p>
          <Link to="/next">次の画面へ</Link>
          <UnsavedChangesGuard model={{ dirty: true, navigationAllowedRef, onDiscard }} />
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

  it("allows same-page tab context changes only when its owner preserves the input", async () => {
    const user = userEvent.setup();
    const onDiscard = vi.fn();
    function DirtyPage() {
      const navigationAllowedRef = useRef(false);
      return (
        <>
          <input aria-label="編集内容" defaultValue="入力中" />
          <Link to="/edit?tab=second#input">別のタブへ</Link>
          <Link to="/next">別の画面へ</Link>
          <UnsavedChangesGuard
            preservesInput={(current, next) => current.pathname === next.pathname}
            model={{ dirty: true, navigationAllowedRef, onDiscard }}
          />
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

    await user.type(screen.getByRole("textbox", { name: "編集内容" }), "のまま");
    await user.click(screen.getByRole("link", { name: "別のタブへ" }));
    expect(router.state.location.search).toBe("?tab=second");
    expect(router.state.location.hash).toBe("#input");
    expect(screen.getByRole("textbox", { name: "編集内容" })).toHaveValue("入力中のまま");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "別の画面へ" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it("keeps discard protection when saving for recovery fails", async () => {
    const user = userEvent.setup();
    const onDiscard = vi.fn();
    const saveBeforeLeave = vi.fn(() => false);
    const router = createMemoryRouter(
      [
        {
          path: "/edit",
          element: (
            <>
              <input aria-label="編集内容" defaultValue="保持する入力" />
              <Link to="/next">次の画面へ</Link>
              <UnsavedChangesGuard
                model={{
                  dirty: true,
                  navigationAllowedRef: { current: false },
                  onDiscard,
                  saveBeforeLeave,
                }}
              />
            </>
          ),
        },
        { path: "/next", element: <p>移動後</p> },
      ],
      { initialEntries: ["/edit"] },
    );
    render(<RouterProvider router={router} />);

    await user.click(screen.getByRole("link", { name: "次の画面へ" }));
    expect(await screen.findByRole("alertdialog")).toBeVisible();
    expect(saveBeforeLeave).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe("/edit");
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(screen.getByRole("textbox", { name: "編集内容" })).toHaveValue("保持する入力");
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "protects document unload unless the current input is recoverable (saved: %s)",
    (saved) => {
      const saveBeforeLeave = vi.fn(() => saved);
      render(
        <UnsavedChangesGuard
          model={{
            dirty: true,
            navigationAllowedRef: { current: false },
            onDiscard: vi.fn(),
            saveBeforeLeave,
          }}
        />,
      );
      const unloading = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(unloading);
      expect(unloading.defaultPrevented).toBe(!saved);
      expect(saveBeforeLeave).toHaveBeenCalledTimes(1);
    },
  );

  it("forgets navigation attempted during an Action even when its blocked render is delayed", async () => {
    const user = userEvent.setup();
    const responseGate = createDeferred();
    const onDiscard = vi.fn();
    const saveBeforeLeave = vi.fn(() => true);
    function PendingPage() {
      const navigationAllowedRef = useRef(false);
      const [, action, pending] = useActionState(async () => {
        await responseGate.promise;
      }, undefined);
      return (
        <>
          <form action={action}>
            <button disabled={pending} type="submit">
              {pending ? "保存中" : "保存"}
            </button>
          </form>
          <Link to="/next">次の画面へ</Link>
          <UnsavedChangesGuard
            model={{ dirty: true, navigationAllowedRef, onDiscard, saveBeforeLeave }}
            pending={pending}
            showPendingDialog={false}
          />
        </>
      );
    }
    const router = createMemoryRouter(
      [
        { path: "/edit", element: <PendingPage /> },
        { path: "/next", element: <p>移動後</p> },
      ],
      { initialEntries: ["/edit"] },
    );
    render(<RouterProvider router={router} />);

    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByRole("button", { name: "保存中" })).toBeDisabled();
    await user.click(screen.getByRole("link", { name: "次の画面へ" }));
    const unloading = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unloading);
    expect(unloading.defaultPrevented).toBe(true);
    expect(saveBeforeLeave).not.toHaveBeenCalled();
    await act(async () => responseGate.resolve());
    await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeEnabled());
    expect(router.state.location.pathname).toBe("/edit");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(saveBeforeLeave).not.toHaveBeenCalled();

    await user.click(screen.getByRole("link", { name: "次の画面へ" }));
    expect(await screen.findByText("移動後")).toBeInTheDocument();
    expect(saveBeforeLeave).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
  });
});

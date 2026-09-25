import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { LinkButton } from "@/shared/ui/actions/LinkButton";

function CurrentLocation() {
  const location = useLocation();
  return <output aria-label="現在地">{location.pathname}</output>;
}

function routerView(disabled: boolean) {
  return (
    <MemoryRouter>
      <LinkButton disabled={disabled} to="/exports">
        選択した試合を出力
      </LinkButton>
      <CurrentLocation />
    </MemoryRouter>
  );
}

describe("LinkButton", () => {
  it.each(["https://example.com/results", "//example.com/results", "mailto:help@example.com"])(
    "preserves an absolute destination %s for document navigation",
    (to) => {
      render(
        <MemoryRouter>
          <LinkButton to={to}>移動先を開く</LinkButton>
        </MemoryRouter>,
      );
      expect(screen.getByRole("link", { name: "移動先を開く" })).toHaveAttribute("href", to);
    },
  );

  it("keeps navigation semantics while presenting an action", () => {
    render(
      <MemoryRouter>
        <LinkButton to="/matches/new">手入力で作成</LinkButton>
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "手入力で作成" })).toHaveAttribute(
      "href",
      "/matches/new",
    );
    expect(screen.queryByRole("button", { name: "手入力で作成" })).not.toBeInTheDocument();
  });

  it("keeps an unavailable destination's name, explanation and anchor ref without activation", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    const ref = createRef<HTMLAnchorElement>();
    render(
      <MemoryRouter>
        <p id="reason">対象の試合を選択してください</p>
        <LinkButton
          aria-describedby="reason"
          aria-label="選択した試合を出力"
          disabled
          id="export-action"
          ref={ref}
          to="/exports"
          onClick={onActivate}
        >
          出力
        </LinkButton>
        <button type="button">次の操作</button>
      </MemoryRouter>,
    );

    const link = screen.getByRole("link", { name: "選択した試合を出力" });
    expect(link).toHaveAccessibleDescription("対象の試合を選択してください");
    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(link).toHaveAttribute("id", "export-action");
    expect(link).not.toHaveAttribute("href");
    expect(ref.current).toBe(link);
    await user.click(link);
    link.focus();
    await user.keyboard("{Enter} ");
    expect(onActivate).not.toHaveBeenCalled();
    await user.tab();
    expect(screen.getByRole("button", { name: "次の操作" })).toHaveFocus();
  });

  it("retains router focus across availability changes and navigates after recovery", async () => {
    const user = userEvent.setup();
    const { rerender } = render(routerView(false));
    const link = screen.getByRole("link", { name: "選択した試合を出力" });
    link.focus();

    rerender(routerView(true));
    expect(screen.getByRole("link", { name: "選択した試合を出力" })).toBe(link);
    expect(link).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("status", { name: "現在地" })).toHaveTextContent("/");

    rerender(routerView(false));
    expect(link).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("status", { name: "現在地" })).toHaveTextContent("/exports");
  });

  it("supports document navigation and keeps the same anchor while pending", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    const ref = createRef<HTMLAnchorElement>();
    const view = (pending: boolean) => (
      <LinkButton
        href="/auth/login"
        pending={pending}
        pendingLabel="ログイン先へ移動中"
        ref={ref}
        onClick={onActivate}
      >
        ログイン
      </LinkButton>
    );
    const { rerender, unmount } = render(view(false));
    const link = screen.getByRole("link", { name: "ログイン" });
    expect(link).toHaveAttribute("href", "/auth/login");
    expect(ref.current).toBe(link);

    rerender(view(true));
    expect(screen.getByRole("link", { name: "ログイン先へ移動中" })).toBe(link);
    expect(link).toHaveAttribute("aria-busy", "true");
    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(link).toHaveAttribute("href", "/auth/login");
    await user.click(link);
    expect(onActivate).not.toHaveBeenCalled();
    expect(fireEvent.contextMenu(link)).toBe(false);

    rerender(view(false));
    expect(screen.getByRole("link", { name: "ログイン" })).toBe(link);
    expect(link).toHaveAttribute("href", "/auth/login");
    expect(link).not.toHaveAttribute("aria-busy");
    unmount();
    expect(ref.current).toBeNull();
  });
});

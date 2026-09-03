import { render, screen, within } from "@testing-library/react";
import { BarChart3, Database, Trophy } from "lucide-react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { GlobalNav } from "@/shared/ui/layout/GlobalNav";

const items = [
  { icon: <Trophy />, label: "試合", to: "/matches" },
  { icon: <BarChart3 />, label: "戦績比較", to: "/analytics/series" },
] as const;

const managementItems = [{ icon: <Database />, label: "設定", to: "/admin/masters" }] as const;

describe("GlobalNav", () => {
  it("renders caller-owned navigation content with accessible names", () => {
    render(
      <MemoryRouter initialEntries={["/matches"]}>
        <GlobalNav
          brandTo="/matches"
          endContent={<p>テストユーザー</p>}
          environmentLabel="TEST"
          items={items}
          managementItems={managementItems}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("navigation", { name: "グローバルナビゲーション" })).toBeVisible();
    expect(screen.getByRole("link", { name: "momo-result" })).toHaveAttribute("href", "/matches");
    expect(screen.getByRole("link", { name: "momo-result" })).toHaveClass(
      "min-h-11",
      "pointer-fine:min-h-9",
    );
    expect(screen.getByText("TEST")).toBeVisible();
    expect(screen.getByText("テストユーザー")).toBeVisible();
    for (const name of ["試合", "戦績比較", "設定"]) {
      const link = screen.getByRole("link", { name });
      expect(within(link).getByText(name)).toBeVisible();
      expect(within(link).queryByRole("img")).not.toBeInTheDocument();
      expect(link).toHaveClass("min-h-11", "pointer-fine:min-h-9");
    }

    const navLayout = screen
      .getByRole("navigation", { name: "グローバルナビゲーション" })
      .querySelector(":scope > div");
    expect(navLayout).toHaveClass("py-2");
    expect(navLayout).not.toHaveClass("lg:py-2");
  });

  it("keeps the caller-named management group and active destination discoverable", () => {
    render(
      <MemoryRouter initialEntries={["/admin/masters"]}>
        <GlobalNav
          brandTo="/matches"
          items={items}
          managementItems={managementItems}
          managementLabel="管理機能"
        />
      </MemoryRouter>,
    );

    const management = screen.getByRole("group", { name: "管理機能" });
    expect(within(management).getByText("管理機能")).toBeVisible();
    expect(within(management).getByRole("link", { name: "設定" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("brings the active destination into the navigation viewport", () => {
    const scrollIntoView = vi.fn();
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    try {
      render(
        <MemoryRouter initialEntries={["/admin/masters"]}>
          <GlobalNav brandTo="/matches" items={items} managementItems={managementItems} />
        </MemoryRouter>,
      );

      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    } finally {
      if (original) {
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", original);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
      }
    }
  });
});

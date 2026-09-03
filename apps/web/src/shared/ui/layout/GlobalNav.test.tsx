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

function navigationRect(left: number, right: number): DOMRect {
  return {
    bottom: 44,
    height: 44,
    left,
    right,
    top: 0,
    width: right - left,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

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
    expect(screen.getByText("TEST")).toBeVisible();
    expect(screen.getByText("テストユーザー")).toBeVisible();
    for (const name of ["試合", "戦績比較", "設定"]) {
      const link = screen.getByRole("link", { name });
      expect(within(link).getByText(name)).toBeVisible();
      expect(within(link).queryByRole("img")).not.toBeInTheDocument();
    }
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
    const getBoundingClientRect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.matches("[data-nav-scroll]")) return navigationRect(0, 200);
        if (this.matches('[aria-current="page"]')) return navigationRect(240, 300);
        return navigationRect(0, 0);
      });

    try {
      render(
        <MemoryRouter initialEntries={["/admin/masters"]}>
          <GlobalNav brandTo="/matches" items={items} managementItems={managementItems} />
        </MemoryRouter>,
      );

      expect(screen.getByRole("navigation").querySelector("[data-nav-scroll]")?.scrollLeft).toBe(
        100,
      );
    } finally {
      getBoundingClientRect.mockRestore();
    }
  });

  it("leaves the navigation position unchanged when the active destination is visible", () => {
    const getBoundingClientRect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.matches("[data-nav-scroll]")) return navigationRect(0, 200);
        if (this.matches('[aria-current="page"]')) return navigationRect(80, 150);
        return navigationRect(0, 0);
      });

    try {
      render(
        <MemoryRouter initialEntries={["/admin/masters"]}>
          <GlobalNav brandTo="/matches" items={items} managementItems={managementItems} />
        </MemoryRouter>,
      );

      expect(screen.getByRole("navigation").querySelector("[data-nav-scroll]")?.scrollLeft).toBe(0);
    } finally {
      getBoundingClientRect.mockRestore();
    }
  });
});

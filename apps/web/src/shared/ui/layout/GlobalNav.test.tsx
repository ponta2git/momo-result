import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { GlobalNav } from "@/shared/ui/layout/GlobalNav";

describe("GlobalNav", () => {
  it("keeps every navigation target at least 44px square when labels collapse", () => {
    render(
      <MemoryRouter initialEntries={["/matches"]}>
        <GlobalNav authDisplayName="ぽんた" isAdmin />
      </MemoryRouter>,
    );

    for (const name of ["試合", "戦績比較", "OCR", "開催", "出力", "分析", "設定", "アカウント"]) {
      expect(screen.getByRole("link", { name })).toHaveClass("min-h-11", "min-w-11");
    }
  });
});

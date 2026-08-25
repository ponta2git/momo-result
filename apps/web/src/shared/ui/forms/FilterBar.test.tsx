import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "@/shared/ui/actions/Button";
import { FilterBar } from "@/shared/ui/forms/FilterBar";

describe("FilterBar", () => {
  it("keeps one labeled filter surface with summary, reset, and action", () => {
    render(
      <FilterBar
        busy
        action={<Button variant="quiet">更新</Button>}
        activeSummary="確定済み・第12回・新しい順"
        ariaLabel="試合の表示条件"
        meta="24件"
        primary={<label>並び順<select aria-label="並び順" /></label>}
        resetAction={<Button variant="quiet">表示条件をリセット</Button>}
      />,
    );

    const surface = screen.getByRole("region", { name: "試合の表示条件" });
    expect(surface).toHaveAttribute("aria-busy", "true");
    expect(surface).toHaveTextContent("確定済み・第12回・新しい順");
    expect(surface).toHaveTextContent("24件");
    expect(screen.getByRole("button", { name: "表示条件をリセット" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更新" })).toBeInTheDocument();
  });

  it("owns a controlled, mounted detail disclosure without owning filter state", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <FilterBar
        ariaLabel="比較条件"
        details={{
          controls: <label>マップ<select aria-label="マップ" /></label>,
          label: "詳細条件",
          onOpenChange,
          open: false,
          summary: "作品・シーズン・マップ",
        }}
        primary={<p>桃太郎電鉄2・総合</p>}
      />,
    );

    const trigger = screen.getByRole("button", { name: /詳細条件/u });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("マップ")).toBeInTheDocument();

    await user.click(trigger);
    expect(onOpenChange).toHaveBeenCalledWith(true);

    rerender(
      <FilterBar
        ariaLabel="比較条件"
        details={{
          controls: <label>マップ<select aria-label="マップ" /></label>,
          label: "詳細条件",
          onOpenChange,
          open: true,
        }}
        primary={<p>桃太郎電鉄2・総合</p>}
      />,
    );
    expect(screen.getByRole("button", { name: "詳細条件" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});

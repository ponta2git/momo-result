import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "@/shared/ui/actions/Button";
import { FilterBar } from "@/shared/ui/forms/FilterBar";

describe("FilterBar", () => {
  it("keeps one labeled filter region with summary, reset, and action", () => {
    render(
      <FilterBar
        busy
        action={<Button variant="quiet">更新</Button>}
        ariaLabel="試合の表示条件"
        meta="24件"
        primary={
          <label>
            並び順
            <select aria-label="並び順" />
          </label>
        }
        resetAction={<Button variant="quiet">表示条件をリセット</Button>}
      />,
    );

    const surface = screen.getByRole("region", { name: "試合の表示条件" });
    expect(surface).toHaveAttribute("aria-busy", "true");
    expect(surface).toHaveTextContent("24件");
    expect(screen.getByRole("button", { name: "表示条件をリセット" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更新" })).toBeInTheDocument();
  });

  it("preserves edited detail conditions through controlled close and reopen", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    function Filters() {
      const [open, setOpen] = useState(false);
      return (
        <FilterBar
          ariaLabel="比較条件"
          details={{
            controls: (
              <label>
                マップ
                <select defaultValue="east">
                  <option value="east">東日本</option>
                  <option value="west">西日本</option>
                </select>
              </label>
            ),
            label: "詳細条件",
            onOpenChange: (next) => {
              onOpenChange(next);
              setOpen(next);
            },
            open,
            summary: "作品・シーズン・マップ",
          }}
          primary={<p>桃太郎電鉄2・総合</p>}
        />
      );
    }
    render(<Filters />);
    const trigger = screen.getByRole("button", { name: /詳細条件/u });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveTextContent("作品・シーズン・マップ");

    await user.click(trigger);
    const map = screen.getByRole("combobox", { name: "マップ" });
    await user.selectOptions(map, "west");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(map).toBeInTheDocument();
    expect(map).not.toBeVisible();

    await user.click(trigger);
    expect(onOpenChange.mock.calls).toEqual([[true], [false], [true]]);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("combobox", { name: "マップ" })).toBe(map);
    expect(map).toHaveValue("west");
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { FilterBar } from "@/shared/ui/forms/FilterBar";

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
        onOpenChange: setOpen,
        open,
        summary: "作品・シーズン・マップ",
      }}
      primary={<p>桃太郎電鉄2・総合</p>}
    />
  );
}

describe("FilterBar", () => {
  it("preserves edited detail conditions through controlled close and reopen", async () => {
    const user = userEvent.setup();
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
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("combobox", { name: "マップ" })).toBe(map);
    expect(map).toHaveValue("west");
  });
});

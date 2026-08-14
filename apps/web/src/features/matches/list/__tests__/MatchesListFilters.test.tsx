import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MatchesListFilters } from "@/features/matches/list/MatchesListFilters";
import type { MatchListSearch } from "@/features/matches/list/matchListTypes";

const initialSearch: MatchListSearch = {
  gameTitleId: "",
  heldEventId: "",
  cursor: "",
  pageSize: 10,
  seasonMasterId: "",
  sort: "held_desc",
  status: "all",
};

describe("MatchesListFilters", () => {
  it("updates sort filter without reading the event inside the state updater", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();

    render(
      <MatchesListFilters
        actions={{ onApply, onClear: vi.fn() }}
        candidates={{ gameTitles: [], heldEvents: [], seasons: [] }}
        search={{ ...initialSearch, cursor: "opaque-cursor" }}
      />,
    );

    expect(screen.getByRole("region", { name: "表示条件" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "表示条件" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("並び順"), "updated_desc");

    expect(onApply).toHaveBeenCalledWith({
      ...initialSearch,
      cursor: "",
      sort: "updated_desc",
    });
  });

  it("summarizes active detail conditions in the accordion header", () => {
    const search = { ...initialSearch, gameTitleId: "game-1", seasonMasterId: "season-1" };

    render(
      <MatchesListFilters
        actions={{ onApply: vi.fn(), onClear: vi.fn() }}
        candidates={{
          gameTitles: [
            {
              createdAt: "2026-01-01T00:00:00.000Z",
              displayOrder: 1,
              id: "game-1",
              layoutFamily: "momotetsu_2",
              name: "桃太郎電鉄2",
            },
          ],
          heldEvents: [],
          seasons: [
            {
              createdAt: "2026-01-01T00:00:00.000Z",
              displayOrder: 1,
              gameTitleId: "game-1",
              id: "season-1",
              name: "今シーズン",
            },
          ],
        }}
        search={search}
      />,
    );

    expect(screen.queryByLabelText("状態")).not.toBeInTheDocument();
    const accordionLabel = screen.getByText("詳細条件");
    const trigger = accordionLabel.closest("button");
    expect(trigger).toHaveTextContent("作品 桃太郎電鉄2");
    expect(trigger).toHaveTextContent("シーズン 今シーズン");
    expect(trigger).not.toHaveTextContent("2件");
    expect(screen.queryByRole("button", { name: /条件を解除/u })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "詳細条件をクリア" })).not.toBeInTheDocument();
  });

  it("shows an accordion indicator without press animation and exposes one reset action", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();

    render(
      <MatchesListFilters
        actions={{ onApply: vi.fn(), onClear }}
        candidates={{ gameTitles: [], heldEvents: [], seasons: [] }}
        search={{ ...initialSearch, sort: "updated_desc" }}
      />,
    );

    const accordionLabel = screen.getByText("詳細条件");
    const trigger = accordionLabel.closest("button");
    if (!trigger) {
      throw new Error("expected the detail filters accordion");
    }
    expect(trigger.querySelector(".lucide-chevron-down")).not.toBeNull();
    expect(trigger).not.toHaveClass("momo-pressable");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const resetButton = screen.getByRole("button", {
      name: "確定状況・並び順・詳細条件を初期状態に戻す",
    });
    expect(resetButton).toHaveTextContent("表示条件をリセット");
    expect(screen.queryByRole("button", { name: "詳細条件をクリア" })).not.toBeInTheDocument();
    await user.click(resetButton);
    expect(onClear).toHaveBeenCalledOnce();
  });
});

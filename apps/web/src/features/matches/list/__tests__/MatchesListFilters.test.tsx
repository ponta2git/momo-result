import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  describeMatchListDetailFilters,
  MatchesListFilters,
} from "@/features/matches/list/MatchesListFilters";
import type {
  MatchListFilterCandidates,
  MatchListSearch,
} from "@/features/matches/list/matchListTypes";

const initialSearch: MatchListSearch = {
  cursor: "",
  gameTitleId: "",
  heldEventId: "",
  pageSize: 10,
  seasonMasterId: "",
  sort: "held_desc",
  status: "all",
};

const candidates: MatchListFilterCandidates = {
  gameTitles: [
    {
      createdAt: "2026-01-01T00:00:00.000Z",
      displayOrder: 1,
      id: "game-1",
      layoutFamily: "momotetsu_2",
      name: "桃太郎電鉄2",
    },
    {
      createdAt: "2026-01-02T00:00:00.000Z",
      displayOrder: 2,
      id: "game-2",
      layoutFamily: "momotetsu_2",
      name: "別の作品",
    },
  ],
  heldEvents: [
    {
      draftCount: 0,
      heldAt: "2026-08-09T00:00:00.000Z",
      id: "held-1",
      matchCount: 3,
      nextMatchNo: 4,
    },
  ],
  seasons: [
    {
      createdAt: "2026-01-01T00:00:00.000Z",
      displayOrder: 1,
      gameTitleId: "game-1",
      id: "season-1",
      name: "今シーズン",
    },
    {
      createdAt: "2026-01-02T00:00:00.000Z",
      displayOrder: 2,
      gameTitleId: "game-2",
      id: "season-2",
      name: "別シーズン",
    },
  ],
};

describe("MatchesListFilters", () => {
  it("keeps dependent season options with the selected game title", () => {
    render(
      <MatchesListFilters
        actions={{ onApply: vi.fn(), onClear: vi.fn() }}
        candidates={candidates}
        search={{ ...initialSearch, gameTitleId: "game-1", seasonMasterId: "season-1" }}
      />,
    );

    expect(screen.getByLabelText("シーズン")).toHaveTextContent("今シーズン");
    expect(screen.getByLabelText("シーズン")).not.toHaveTextContent("別シーズン");
  });

  it("clears cursor and an incompatible season when the game title changes", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const search = {
      ...initialSearch,
      cursor: "opaque-cursor",
      gameTitleId: "game-1",
      seasonMasterId: "season-1",
    };

    render(
      <MatchesListFilters
        actions={{ onApply, onClear: vi.fn() }}
        candidates={candidates}
        search={search}
      />,
    );

    await user.selectOptions(screen.getByLabelText("作品"), "game-2");

    expect(onApply).toHaveBeenCalledWith({
      ...search,
      cursor: "",
      gameTitleId: "game-2",
      seasonMasterId: "",
    });
  });

  it("selects a held event from the shared descriptive dialog", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();

    render(
      <MatchesListFilters
        actions={{ onApply, onClear: vi.fn() }}
        candidates={candidates}
        search={initialSearch}
      />,
    );

    await user.click(screen.getByRole("button", { name: "開催を変更" }));
    expect(screen.getByRole("dialog", { name: "開催を選択" })).toHaveTextContent(
      "確定 3試合・未完了 0件",
    );
    await user.click(screen.getByRole("radio", { name: /2026\/08\/09/u }));

    expect(onApply).toHaveBeenCalledWith({
      ...initialSearch,
      cursor: "",
      heldEventId: "held-1",
    });
  });

  it("describes all active details using the selected candidate labels", () => {
    expect(
      describeMatchListDetailFilters(candidates, {
        ...initialSearch,
        gameTitleId: "game-1",
        heldEventId: "held-1",
        seasonMasterId: "season-1",
      }),
    ).toEqual(["開催 2026/08/09", "作品 桃太郎電鉄2", "シーズン 今シーズン"]);
  });
});

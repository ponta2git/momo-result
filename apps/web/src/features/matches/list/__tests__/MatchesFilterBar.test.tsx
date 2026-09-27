import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MatchesFilterBar } from "@/features/matches/list/MatchesFilterBar";
import type {
  MatchListFilterCandidates,
  MatchListSearch,
} from "@/features/matches/list/matchListTypes";
import { selectOption } from "@/test/selectOption";

const initialSearch: MatchListSearch = {
  cursor: "",
  gameTitleId: "",
  heldEventId: "",
  pageSize: 10,
  seasonMasterId: "",
  sort: "held_desc",
  status: "all",
};

const counts = {
  incompleteCount: 8,
  needsReviewCount: 2,
  ocrRunningCount: 3,
  preConfirmCount: 5,
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
};

describe("MatchesFilterBar", () => {
  it("clears the cursor when status or sort changes", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const search = { ...initialSearch, cursor: "opaque-cursor", status: "incomplete" as const };

    const { rerender } = render(
      <MatchesFilterBar
        actions={{ onApply, onClear: vi.fn() }}
        candidates={candidates}
        counts={counts}
        search={search}
      />,
    );

    await selectOption(user, screen.getByLabelText("確定状況"), "ocr_running");
    expect(onApply).toHaveBeenLastCalledWith({ ...search, cursor: "", status: "ocr_running" });

    onApply.mockClear();
    rerender(
      <MatchesFilterBar
        actions={{ onApply, onClear: vi.fn() }}
        candidates={candidates}
        counts={counts}
        search={search}
      />,
    );
    await selectOption(user, screen.getByLabelText("並び順"), "updated_desc");
    expect(onApply).toHaveBeenLastCalledWith({ ...search, cursor: "", sort: "updated_desc" });
  });
});

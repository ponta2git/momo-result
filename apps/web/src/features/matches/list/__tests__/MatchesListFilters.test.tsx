import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MatchesListFilters } from "@/features/matches/list/MatchesListFilters";
import type { MatchListSearch } from "@/features/matches/list/matchListTypes";

const initialSearch: MatchListSearch = {
  gameTitleId: "",
  heldEventId: "",
  page: 1,
  pageSize: 25,
  seasonMasterId: "",
  sort: "status_priority",
  status: "all",
};

describe("MatchesListFilters", () => {
  it("updates sort filter without reading the event inside the state updater", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();

    render(
      <MatchesListFilters
        gameTitles={[]}
        heldEvents={[]}
        initialSearch={initialSearch}
        onApply={onApply}
        onClear={vi.fn()}
        seasons={[]}
      />,
    );

    await user.selectOptions(screen.getByLabelText("表の並び順"), "updated_desc");

    expect(onApply).toHaveBeenCalledWith({
      ...initialSearch,
      sort: "updated_desc",
    });
  });
});

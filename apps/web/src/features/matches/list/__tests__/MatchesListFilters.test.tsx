import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MatchesListFilters } from "@/features/matches/list/MatchesListFilters";
import type { MatchListSearch } from "@/features/matches/list/matchListTypes";

const initialSearch: MatchListSearch = {
  gameTitleId: "",
  heldEventId: "",
  seasonMasterId: "",
  sort: "status_priority",
  status: "all",
};

describe("MatchesListFilters", () => {
  it("updates sort filter without reading the event inside the state updater", async () => {
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

    await userEvent.selectOptions(screen.getByLabelText("ソート"), "updated_desc");
    await userEvent.click(screen.getByRole("button", { name: "絞り込む" }));

    expect(onApply).toHaveBeenCalledWith({
      ...initialSearch,
      sort: "updated_desc",
    });
  });
});

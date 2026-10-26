import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { MatchesFilterBar } from "@/features/matches/list/MatchesFilterBar";
import { defaultMatchListSearch } from "@/features/matches/list/matchListSearchParams";
import type {
  MatchListFilterCandidates,
  MatchListSearch,
} from "@/features/matches/list/matchListTypes";
import { selectOption } from "@/test/selectOption";

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
  maps: [
    {
      createdAt: "2026-01-01T00:00:00.000Z",
      displayOrder: 1,
      gameTitleId: "game-1",
      id: "map-1",
      name: "日本全国",
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
  ],
};

function renderFilterBar(search: MatchListSearch = defaultMatchListSearch) {
  const onChange = vi.fn();
  function Harness() {
    const [current, setCurrent] = useState(search);
    return (
      <>
        <MatchesFilterBar
          actions={{ onChange, onClear: vi.fn() }}
          candidates={candidates}
          hasConditions={false}
          search={current}
        />
        <button type="button" onClick={() => setCurrent(defaultMatchListSearch)}>
          external reset
        </button>
      </>
    );
  }
  render(<Harness />);
  return onChange;
}

describe("MatchesFilterBar", () => {
  it("sends visible scope and sort changes as field intents", async () => {
    const user = userEvent.setup();
    const onChange = renderFilterBar();

    await selectOption(user, screen.getByLabelText("マップ"), "map-1");
    expect(onChange).toHaveBeenLastCalledWith({ kind: "map", mapMasterId: "map-1" });
    await selectOption(user, screen.getByLabelText("並び順"), "held_asc");
    expect(onChange).toHaveBeenLastCalledWith({ kind: "sort", sort: "held_asc" });
  });

  it("searches the memo only when the reader commits the words", async () => {
    const user = userEvent.setup();
    const onChange = renderFilterBar();
    await user.click(screen.getByRole("button", { name: /詳細条件/u }));

    await user.type(screen.getByLabelText("メモに含む語句"), "  ボンビー ");
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith({ kind: "memo", q: "ボンビー" });
  });

  it("sends a player record only once it is complete, and keeps an invalid value editable", async () => {
    const user = userEvent.setup();
    const onChange = renderFilterBar();
    await user.click(screen.getByRole("button", { name: /詳細条件/u }));

    await selectOption(user, screen.getByLabelText("プレーヤー"), "member_ponta");
    await selectOption(user, screen.getByLabelText("記録"), "suri_no_ginji");
    expect(onChange).not.toHaveBeenCalled();

    const count = screen.getByLabelText("回数");
    await user.type(count, "-1");
    await user.tab();
    expect(onChange).not.toHaveBeenCalled();
    expect(count).toHaveAccessibleDescription(/0以上の整数/u);

    await user.clear(count);
    await user.type(count, "2{Enter}");
    expect(onChange).toHaveBeenLastCalledWith({
      kind: "record",
      record: { memberId: "member_ponta", range: "gte", record: "suri_no_ginji", value: "2" },
    });
  });

  it("replaces an uncommitted draft when the committed search changes elsewhere", async () => {
    const user = userEvent.setup();
    renderFilterBar({ ...defaultMatchListSearch, q: "ボンビー" });

    const memo = screen.getByLabelText("メモに含む語句");
    expect(memo).toHaveValue("ボンビー");
    await user.click(screen.getByRole("button", { name: "external reset" }));
    expect(memo).toHaveValue("");
  });
});

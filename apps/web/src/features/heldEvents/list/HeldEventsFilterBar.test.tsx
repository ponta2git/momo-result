import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { defaultHeldEventListSearch } from "@/features/heldEvents/list/heldEventListSearchParams";
import type {
  HeldEventListFilterCandidates,
  HeldEventListSearch,
} from "@/features/heldEvents/list/heldEventListTypes";
import { HeldEventsFilterBar } from "@/features/heldEvents/list/HeldEventsFilterBar";
import { selectOption } from "@/test/selectOption";

const candidates: HeldEventListFilterCandidates = {
  gameTitles: [
    {
      createdAt: "2026-01-01T00:00:00.000Z",
      displayOrder: 1,
      id: "game-1",
      layoutFamily: "momotetsu_2",
      name: "桃太郎電鉄2",
    },
  ],
  maps: [
    {
      createdAt: "2026-01-01T00:00:00.000Z",
      displayOrder: 1,
      gameTitleId: "game-1",
      id: "map-1",
      name: "日本全国",
    },
  ],
  seasons: [],
};

function renderFilterBar(search: HeldEventListSearch = defaultHeldEventListSearch) {
  const onChange = vi.fn();
  function Harness() {
    const [current, setCurrent] = useState(search);
    return (
      <>
        <HeldEventsFilterBar
          actions={{ onChange, onClear: vi.fn() }}
          candidates={candidates}
          hasConditions={false}
          search={current}
        />
        <button type="button" onClick={() => setCurrent(defaultHeldEventListSearch)}>
          external reset
        </button>
      </>
    );
  }
  render(<Harness />);
  return onChange;
}

describe("HeldEventsFilterBar", () => {
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

    const memo = screen.getByLabelText("メモに含む語句");
    expect(memo).toHaveAccessibleDescription(
      "開催内のどれかの試合メモに含まれる開催を探します。Enter またはフォーカスを外すと検索します。",
    );
    await user.type(memo, "  ボンビー ");
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith({ kind: "memo", q: "ボンビー" });
  });

  it("sends the match count as soon as it is chosen", async () => {
    const user = userEvent.setup();
    const onChange = renderFilterBar();
    await user.click(screen.getByRole("button", { name: /詳細条件/u }));

    await selectOption(user, screen.getByLabelText("確定試合数"), "3");
    expect(onChange).toHaveBeenLastCalledWith({ kind: "matchCount", minMatchCount: 3 });
  });

  it("sends a player metric only once it is complete, and keeps an invalid value editable", async () => {
    const user = userEvent.setup();
    const onChange = renderFilterBar();
    await user.click(screen.getByRole("button", { name: /詳細条件/u }));

    await selectOption(user, screen.getByLabelText("プレーヤー"), "member_ponta");
    await selectOption(user, screen.getByLabelText("指標"), "average_rank");
    expect(onChange).not.toHaveBeenCalled();

    const value = screen.getByLabelText("値");
    await user.type(value, "4.5");
    await user.tab();
    expect(onChange).not.toHaveBeenCalled();
    expect(value).toHaveAccessibleDescription(/1\.00〜4\.00/u);

    await user.clear(value);
    await user.type(value, "2.25{Enter}");
    expect(onChange).toHaveBeenLastCalledWith({
      kind: "metric",
      metric: { memberId: "member_ponta", metric: "average_rank", range: "gte", value: "2.25" },
    });
  });

  it("replaces an uncommitted draft when the committed search changes elsewhere", async () => {
    const user = userEvent.setup();
    renderFilterBar({ ...defaultHeldEventListSearch, q: "ボンビー" });

    const memo = screen.getByLabelText("メモに含む語句");
    expect(memo).toHaveValue("ボンビー");
    await user.click(screen.getByRole("button", { name: "external reset" }));
    expect(memo).toHaveValue("");
  });
});

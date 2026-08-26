import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MatchesFilterBar } from "@/features/matches/list/MatchesFilterBar";
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
  it("keeps the condition hierarchy and summarizes only non-default conditions", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();

    render(
      <MatchesFilterBar
        actions={{ onApply: vi.fn(), onClear }}
        candidates={candidates}
        counts={counts}
        search={{
          ...initialSearch,
          gameTitleId: "game-1",
          seasonMasterId: "season-1",
          sort: "updated_desc",
          status: "needs_review",
        }}
      />,
    );

    const surface = screen.getByRole("region", { name: "試合の表示条件" });
    expect(within(surface).getByLabelText("確定状況")).toHaveValue("needs_review");
    expect(within(surface).getByLabelText("並び順")).toHaveValue("updated_desc");
    expect(surface).not.toHaveTextContent("適用中:");

    const detailTrigger = within(surface).getByRole("button", { name: /^詳細条件/u });
    expect(detailTrigger).toHaveAttribute("aria-expanded", "true");
    expect(detailTrigger).toHaveTextContent("作品 桃太郎電鉄2・シーズン 今シーズン");
    expect(within(surface).getByLabelText("開催")).toBeInTheDocument();

    const resetButton = within(surface).getByRole("button", {
      name: "確定状況・並び順・詳細条件を初期状態に戻す",
    });
    expect(
      within(surface).getAllByRole("button", {
        name: "確定状況・並び順・詳細条件を初期状態に戻す",
      }),
    ).toHaveLength(1);
    await user.click(resetButton);
    expect(onClear).toHaveBeenCalledOnce();
  });

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

    await user.selectOptions(screen.getByLabelText("確定状況"), "ocr_running");
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
    await user.selectOptions(screen.getByLabelText("並び順"), "updated_desc");
    expect(onApply).toHaveBeenLastCalledWith({ ...search, cursor: "", sort: "updated_desc" });
  });

  it("keeps detail controls mounted while collapsed and exposes aggregate busy state", () => {
    render(
      <MatchesFilterBar
        actions={{ onApply: vi.fn(), onClear: vi.fn() }}
        candidates={candidates}
        counts={counts}
        search={initialSearch}
        summaryLoading
      />,
    );

    const surface = screen.getByRole("region", { name: "試合の表示条件" });
    expect(surface).toHaveAttribute("aria-busy", "true");
    expect(within(surface).getByRole("button", { name: /^詳細条件/u })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(within(surface).getByLabelText("開催")).toBeInTheDocument();
    expect(surface).not.toHaveTextContent("適用中:");
    expect(
      within(surface).queryByRole("button", {
        name: "確定状況・並び順・詳細条件を初期状態に戻す",
      }),
    ).not.toBeInTheDocument();
  });

  it("keeps status choices available when summary counts fail and retries nearby", async () => {
    const user = userEvent.setup();
    const onRetrySummary = vi.fn();

    render(
      <MatchesFilterBar
        actions={{ onApply: vi.fn(), onClear: vi.fn() }}
        candidates={candidates}
        onRetrySummary={onRetrySummary}
        search={initialSearch}
        summaryError
      />,
    );

    expect(screen.getByLabelText("確定状況")).toBeEnabled();
    expect(screen.queryByText(/0件/u)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "件数を再取得" }));
    expect(onRetrySummary).toHaveBeenCalledOnce();
  });
});

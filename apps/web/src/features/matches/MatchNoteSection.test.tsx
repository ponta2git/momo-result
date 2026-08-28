import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { MatchNoteSection } from "@/features/matches/MatchNoteSection";
import type { MatchDetailResponse } from "@/shared/api/matches";
import { makeMatchDetail } from "@/test/factories";
import { createTestQueryClient } from "@/test/queryClient";

function matchWithNote(body: string, version: string): MatchDetailResponse {
  return makeMatchDetail({
    note: {
      body,
      updatedAt: "2026-04-04T13:10:00.000Z",
      updatedByDisplayName: "ぽんた",
      version,
    },
  });
}

describe("MatchNoteSection", () => {
  it("keeps an editing snapshot while deriving the idle value from the latest match", async () => {
    const user = userEvent.setup();
    const queryClient = createTestQueryClient();
    const initialMatch = matchWithNote("保存済みメモ", "1");
    const latestMatch = matchWithNote("別画面から更新されたメモ", "2");
    const refetchMatch = async () => ({ data: latestMatch });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <MatchNoteSection match={initialMatch} refetchMatch={refetchMatch} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "編集" }));
    const editor = screen.getByRole("textbox", { name: "試合メモ" });
    await user.clear(editor);
    await user.type(editor, "編集中のメモ");

    view.rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <MatchNoteSection match={latestMatch} refetchMatch={refetchMatch} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("textbox", { name: "試合メモ" })).toHaveValue("編集中のメモ");

    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(screen.getByText("別画面から更新されたメモ")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "編集" }));
    expect(screen.getByRole("textbox", { name: "試合メモ" })).toHaveValue(
      "別画面から更新されたメモ",
    );
  });
});

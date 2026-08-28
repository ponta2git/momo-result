import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MatchConfirmDialog } from "@/features/matches/workspace/MatchConfirmDialog";
import { createEmptyMatchForm } from "@/features/matches/workspace/matchFormTypes";

describe("MatchConfirmDialog", () => {
  it("shows a player ledger and keeps unresolved OCR warnings as a soft gate", async () => {
    const values = createEmptyMatchForm("2026-08-03T12:00:00.000Z");
    values.matchNoInEvent = 3;
    values.players[0]!.totalAssetsManYen = 12_345;
    values.players[0]!.revenueManYen = -678;
    values.noteBody = "終盤のカード交換が決め手";

    render(
      <MatchConfirmDialog
        model={{
          actions: { onClose: vi.fn(), onConfirm: vi.fn() },
          feedback: { validationMessage: "" },
          pending: false,
          review: { changedCount: 2, totalCount: 3, unresolvedCount: 1 },
          summary: {
            gameTitleName: "桃太郎電鉄2",
            heldEvent: undefined,
            mapName: "東日本",
            seasonName: "シーズン1",
          },
          values,
        }}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "この内容で確定しますか？" });
    expect(within(dialog).getByText("修正 2件")).toBeInTheDocument();
    expect(within(dialog).getByText("確認済み2件／全3件")).toBeInTheDocument();
    expect(within(dialog).getByText(/未確認の強調項目が1件あります/u)).toBeInTheDocument();
    expect(within(dialog).getByRole("cell", { name: "12,345" })).toBeInTheDocument();
    expect(within(dialog).getByRole("cell", { name: "-678" })).toBeInTheDocument();
    expect(
      within(dialog)
        .getAllByRole("row")
        .slice(1)
        .map((row) => within(row).getByRole("rowheader").textContent),
    ).toEqual(["いーゆー", "ぽんた", "あかねまみ", "おーたか"]);
    expect(within(dialog).getByRole("button", { name: "確定する" })).toBeEnabled();
    expect(within(dialog).getByText("終盤のカード交換が決め手")).toBeInTheDocument();
  });
});

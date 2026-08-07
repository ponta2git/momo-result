import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createEmptyMatchForm } from "@/features/matches/workspace/matchFormTypes";
import { MatchSetupFields } from "@/features/matches/workspace/MatchSetupFields";

describe("MatchSetupFields", () => {
  it("associates every visible validation error with its control", () => {
    const paths = [
      "heldEventId",
      "matchNoInEvent",
      "playedAt",
      "gameTitleId",
      "seasonMasterId",
      "mapMasterId",
      "ownerMemberId",
    ];

    render(
      <MatchSetupFields
        actions={{ onGameTitleChange: vi.fn(), onPatchRoot: vi.fn() }}
        errorPathSet={new Set(paths)}
        options={{ gameTitleItems: [], heldEvents: [], mapItems: [], seasonItems: [] }}
        values={createEmptyMatchForm("2026-01-01T09:00:00.000Z")}
      />,
    );

    const controls = [
      screen.getByLabelText("開催履歴（必須）"),
      screen.getByLabelText("試合番号"),
      screen.getByLabelText("開催日時（必須）"),
      screen.getByLabelText("作品（必須）"),
      screen.getByLabelText("シーズン（必須）"),
      screen.getByLabelText("マップ（必須）"),
      screen.getByLabelText("オーナー（必須）"),
    ];

    expect(screen.getAllByRole("alert")).toHaveLength(paths.length);
    for (const control of controls) {
      expect(control).toHaveAttribute("aria-invalid", "true");
      const errorId = control.getAttribute("aria-describedby");
      expect(errorId).toBeTruthy();
      expect(document.getElementById(errorId ?? "")).toHaveTextContent("未入力です");
    }
  });
});

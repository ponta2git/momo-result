import { render, screen, within } from "@testing-library/react";
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
        model={{
          actions: { onGameTitleChange: vi.fn(), onPatchRoot: vi.fn() },
          options: {
            gameTitleItems: [],
            heldEventPicker: {
              error: undefined,
              heldEvents: [],
              pagination: undefined,
              pending: false,
              refetch: vi.fn(async () => undefined),
              selectedHeldEvent: undefined,
              onPageChange: vi.fn(),
            },
            heldEvents: [],
            mapItems: [],
            seasonItems: [],
          },
          validation: { errorPathSet: new Set(paths) },
          values: createEmptyMatchForm("2026-01-01T09:00:00.000Z"),
        }}
      />,
    );

    const controls = [
      screen.getByRole("button", { name: "開催履歴（必須）を変更" }),
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

    expect(
      within(screen.getByLabelText("オーナー（必須）"))
        .getAllByRole("option")
        .map((option) => option.textContent?.trim()),
    ).toEqual(["いーゆー", "ぽんた", "あかねまみ", "おーたか"]);
  });
});

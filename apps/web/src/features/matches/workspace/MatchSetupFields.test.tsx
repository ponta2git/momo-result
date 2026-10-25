import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createEmptyMatchForm } from "@/features/matches/workspace/matchFormTypes";
import { MatchSetupFields } from "@/features/matches/workspace/MatchSetupFields";
import type { MatchWorkspaceSetupFieldsView } from "@/features/matches/workspace/matchWorkspacePanelViews";

function createView(errorPathSet = new Set<string>()): MatchWorkspaceSetupFieldsView {
  return {
    actions: { onSelectHeldEvent: vi.fn(), onChangeField: vi.fn() },
    options: {
      gameTitleItems: [],
      heldEventPicker: {
        error: undefined,
        heldEvents: [],
        pagination: undefined,
        pending: false,
        refresh: vi.fn(async () => undefined),
        scopeChanging: false,
        selectedHeldEvent: undefined,
        onPageChange: vi.fn(),
      },
      heldEvents: [],
      mapItems: [],
      seasonItems: [],
    },
    validation: { errorPathSet },
    values: createEmptyMatchForm("2026-01-01T09:00:00.000Z"),
  };
}

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

    render(<MatchSetupFields view={createView(new Set(paths))} />);

    const controls = [
      screen.getByRole("button", { name: "開催（必須）を変更" }),
      screen.getByLabelText("試合番号"),
      screen.getByLabelText("対戦日時（必須）"),
      screen.getByLabelText("作品（必須）"),
      screen.getByLabelText("シーズン（必須）"),
      screen.getByLabelText("マップ（必須）"),
      screen.getByLabelText("オーナー（必須）"),
    ];

    expect(screen.getAllByRole("alert")).toHaveLength(paths.length);
    for (const control of controls) {
      expect(control).toHaveAttribute("aria-invalid", "true");
      expect(control).toHaveAccessibleDescription(expect.stringContaining("未入力です"));
    }
  });

  it("rejects match numbers that cannot be represented without losing their digits", () => {
    const view = createView();
    render(<MatchSetupFields view={view} />);
    const matchNumber = screen.getByLabelText("試合番号");

    for (const value of ["9007199254740993", "9".repeat(310)]) {
      fireEvent.change(matchNumber, { target: { value } });
    }
    expect(view.actions.onChangeField).not.toHaveBeenCalled();

    fireEvent.change(matchNumber, { target: { value: "31" } });
    expect(view.actions.onChangeField).toHaveBeenCalledExactlyOnceWith("matchNoInEvent", 31);
  });
});

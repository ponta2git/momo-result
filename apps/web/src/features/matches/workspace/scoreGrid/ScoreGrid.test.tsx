import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { IncidentKey, MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import { emptyPlayers } from "@/features/matches/workspace/matchFormTypes";
import { ScoreGrid } from "@/features/matches/workspace/scoreGrid/ScoreGrid";
import { ScoreGridReviewToolbar } from "@/features/matches/workspace/scoreGrid/ScoreGridReviewToolbar";
import { installMatchMediaController } from "@/test/doubles/dom";
import type { MatchMediaController } from "@/test/doubles/dom";

function ScoreGridHarness({
  onPlayerChange,
}: {
  onPlayerChange: (index: number, patch: Partial<MatchFormValues["players"][number]>) => void;
}) {
  const [players, setPlayers] = useState(emptyPlayers());

  return (
    <ScoreGrid
      actions={{
        onAcknowledgeReviewCell: () => undefined,
        onIncidentChange: (index, key, value) => {
          setPlayers((current) =>
            current.map((player, playerIndex) =>
              playerIndex === index
                ? {
                    ...player,
                    incidents: {
                      ...player.incidents,
                      [key]: value,
                    },
                  }
                : player,
            ),
          );
        },
        onPlayerChange: (index, patch) => {
          onPlayerChange(index, patch);
          setPlayers((current) =>
            current.map((player, playerIndex) =>
              playerIndex === index ? { ...player, ...patch } : player,
            ),
          );
        },
        onPlayOrderChange: (index, playOrder) => {
          setPlayers((current) =>
            current.map((player, playerIndex) =>
              playerIndex === index ? { ...player, playOrder } : player,
            ),
          );
        },
        onRequestSubmitFocus: () => undefined,
        onReviewCellFocus: () => undefined,
      }}
      data={{
        errorPathSet: new Set(),
        lastSyncedPlayerIndex: null,
        originalPlayers: undefined,
        players,
        review: { acknowledgedCellIds: [], activeCellId: null, items: [] },
      }}
    />
  );
}

describe("ScoreGrid", () => {
  let matchMedia: MatchMediaController | undefined;

  afterEach(() => {
    matchMedia?.restore();
    matchMedia = undefined;
  });

  it("keeps a mobile signed numeric draft local until the cell is committed", async () => {
    matchMedia = installMatchMediaController(true);
    const user = userEvent.setup();
    const onPlayerChange =
      vi.fn<(index: number, patch: Partial<MatchFormValues["players"][number]>) => void>();

    render(<ScoreGridHarness onPlayerChange={onPlayerChange} />);

    const revenueInput = screen.getByRole("textbox", {
      name: /ぽんた 収益/u,
    });

    await user.clear(revenueInput);
    await user.type(revenueInput, "-");

    expect(revenueInput).toHaveValue("-");
    expect(onPlayerChange).not.toHaveBeenCalled();

    await user.type(revenueInput, "42");

    expect(revenueInput).toHaveValue("-42");
    expect(onPlayerChange).not.toHaveBeenCalled();

    await user.tab();

    expect(onPlayerChange).toHaveBeenLastCalledWith(0, { revenueManYen: -42 });
  });

  it("normalizes mobile incident inputs with the same numeric policy as desktop", async () => {
    matchMedia = installMatchMediaController(true);
    const user = userEvent.setup();
    const incidentChanges: Array<[number, IncidentKey, number]> = [];

    function IncidentHarness() {
      const [players, setPlayers] = useState(emptyPlayers());
      return (
        <ScoreGrid
          actions={{
            onAcknowledgeReviewCell: () => undefined,
            onIncidentChange: (index, key, value) => {
              incidentChanges.push([index, key, value]);
              setPlayers((current) =>
                current.map((player, playerIndex) =>
                  playerIndex === index
                    ? {
                        ...player,
                        incidents: {
                          ...player.incidents,
                          [key]: value,
                        },
                      }
                    : player,
                ),
              );
            },
            onPlayerChange: () => undefined,
            onPlayOrderChange: () => undefined,
            onRequestSubmitFocus: () => undefined,
            onReviewCellFocus: () => undefined,
          }}
          data={{
            errorPathSet: new Set(),
            lastSyncedPlayerIndex: null,
            originalPlayers: undefined,
            players,
            review: { acknowledgedCellIds: [], activeCellId: null, items: [] },
          }}
        />
      );
    }

    render(<IncidentHarness />);

    const destinationInput = screen.getByRole("textbox", {
      name: "ぽんた 目的地",
    });

    await user.clear(destinationInput);
    await user.type(destinationInput, "a007");

    expect(destinationInput).toHaveValue("7");
    expect(incidentChanges).toHaveLength(0);

    await user.tab();

    expect(incidentChanges.at(-1)).toEqual([0, "destination", 7]);
  });

  it("allows editing the member on mobile cards", async () => {
    matchMedia = installMatchMediaController(true);
    const user = userEvent.setup();
    const onPlayerChange =
      vi.fn<(index: number, patch: Partial<MatchFormValues["players"][number]>) => void>();

    render(<ScoreGridHarness onPlayerChange={onPlayerChange} />);

    const memberSelect = screen.getByLabelText("メンバー");
    await user.selectOptions(memberSelect, "member_eu");

    expect(onPlayerChange).toHaveBeenLastCalledWith(0, { memberId: "member_eu" });
    expect(memberSelect).toHaveValue("member_eu");
  });

  it("does not commit NaN when a mobile numeric draft is incomplete", async () => {
    matchMedia = installMatchMediaController(true);
    const user = userEvent.setup();
    const onPlayerChange =
      vi.fn<(index: number, patch: Partial<MatchFormValues["players"][number]>) => void>();

    render(<ScoreGridHarness onPlayerChange={onPlayerChange} />);

    const revenueInput = screen.getByRole("textbox", {
      name: /ぽんた 収益/u,
    });

    await user.clear(revenueInput);
    await user.type(revenueInput, "-");
    await user.tab();

    expect(revenueInput).toHaveValue("-");
    expect(onPlayerChange).not.toHaveBeenCalled();
  });

  it("moves through OCR warnings without changing the underlying values", async () => {
    const user = userEvent.setup();
    const onAcknowledge = vi.fn();
    const onNext = vi.fn();

    render(
      <ScoreGridReviewToolbar
        activeItem={{
          cellId: "players.0.memberId",
          confidence: 0.78,
          field: "memberId",
          label: "ぽんた メンバー",
          message: "既知エイリアスで解決",
          row: 0,
          sourceKind: "total_assets",
          warningCount: 1,
        }}
        activeReviewed={false}
        remainingCount={2}
        totalCount={2}
        onAcknowledge={onAcknowledge}
        onNext={onNext}
        onPrevious={() => undefined}
      />,
    );

    expect(screen.getByText("未確認 2 / 2")).toBeInTheDocument();
    expect(screen.getByText("既知エイリアスで解決")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "この値で確認済み" }));
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "次の要確認セルへ" }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});

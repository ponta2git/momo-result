import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { IncidentKey, MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import { emptyPlayers } from "@/features/matches/workspace/matchFormTypes";
import { ScoreGrid } from "@/features/matches/workspace/scoreGrid/ScoreGrid";
import { ScoreGridReviewToolbar } from "@/features/matches/workspace/scoreGrid/ScoreGridReviewToolbar";
import type { ScoreGridProps } from "@/features/matches/workspace/scoreGrid/ScoreGridTypes";
import { installMatchMediaController } from "@/test/doubles/dom";
import type { MatchMediaController } from "@/test/doubles/dom";

const noErrorPaths = new Set<string>();
const noReview: ScoreGridProps["data"]["review"] = {
  acknowledgedCellIds: [],
  activeCellId: null,
  items: [],
};

function ScoreGridHarness({
  errorPathSet = noErrorPaths,
  initialPlayers = emptyPlayers(),
  onPlayerChange,
  review = noReview,
}: {
  errorPathSet?: Set<string>;
  initialPlayers?: MatchFormValues["players"];
  onPlayerChange: (index: number, patch: Partial<MatchFormValues["players"][number]>) => void;
  review?: ScoreGridProps["data"]["review"];
}) {
  const [players, setPlayers] = useState(initialPlayers);

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
        errorPathSet,
        lastSyncedPlayerIndex: null,
        originalPlayers: undefined,
        players,
        review,
      }}
    />
  );
}

function FinalAcknowledgementHarness() {
  const [acknowledgedCellIds, setAcknowledgedCellIds] = useState<string[]>([]);
  return (
    <>
      <ScoreGrid
        actions={{
          onAcknowledgeReviewCell: (cellId) => setAcknowledgedCellIds([cellId]),
          onIncidentChange: () => undefined,
          onPlayerChange: () => undefined,
          onPlayOrderChange: () => undefined,
          onRequestSubmitFocus: () =>
            document.querySelector<HTMLButtonElement>("#review-submit")?.focus(),
          onReviewCellFocus: () => undefined,
        }}
        data={{
          errorPathSet: new Set(),
          lastSyncedPlayerIndex: null,
          originalPlayers: undefined,
          players: emptyPlayers(),
          review: {
            acknowledgedCellIds,
            activeCellId: "players.0.memberId",
            items: [
              {
                cellId: "players.0.memberId",
                confidence: 0.7,
                field: "memberId",
                label: "最後の確認項目",
                message: "照合が必要",
                row: 0,
                sourceKind: "total_assets",
                warningCount: 1,
              },
            ],
          },
        }}
      />
      <button id="review-submit" type="button">
        確定前の確認へ進む
      </button>
    </>
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

    const collapsedPlayerTrigger = screen.getAllByText("詳細")[0]?.closest("button");
    expect(collapsedPlayerTrigger).toHaveClass("hover:bg-[var(--color-surface-hover)]");
    expect(collapsedPlayerTrigger).not.toHaveClass("hover:bg-transparent");

    const memberSelect = screen.getByLabelText("メンバー");
    expect(
      within(memberSelect)
        .getAllByRole("option")
        .map((option) => option.textContent?.trim()),
    ).toEqual(["いーゆー", "ぽんた", "あかねまみ", "おーたか"]);
    await user.selectOptions(memberSelect, "member_eu");

    expect(onPlayerChange).toHaveBeenLastCalledWith(0, { memberId: "member_eu" });
    expect(memberSelect).toHaveValue("member_eu");
  });

  it("keeps shared grid controls compact, touch-safe, and invalid through native ARIA", () => {
    const errorPathSet = new Set(["players.0.playOrder", "players.0.rank"]);

    render(<ScoreGridHarness errorPathSet={errorPathSet} onPlayerChange={vi.fn()} />);

    const memberSelect = screen.getByRole("combobox", { name: "ぽんた メンバー" });
    const playOrderSelect = screen.getByRole("combobox", { name: "ぽんた プレー順" });
    const rankInput = screen.getByRole("textbox", { name: "ぽんた 順位" });

    expect(memberSelect).toHaveClass("min-h-11", "px-2", "min-w-[10rem]");
    expect(
      within(memberSelect)
        .getAllByRole("option")
        .map((option) => option.textContent?.trim()),
    ).toEqual(["いーゆー", "ぽんた", "あかねまみ", "おーたか"]);
    expect(playOrderSelect).toHaveClass(
      "min-h-11",
      "px-2",
      "text-center",
      "border-[var(--color-danger)]/65",
    );
    expect(playOrderSelect).toHaveAttribute("aria-invalid", "true");
    expect(rankInput).toHaveClass("min-h-11", "px-2", "text-center", "min-w-[6ch]");
    expect(rankInput).toHaveAttribute("aria-invalid", "true");
  });

  it("keeps desktop and mobile accents attached to playOrder instead of row index", () => {
    const players = emptyPlayers();
    for (const [index, player] of players.entries()) {
      player.playOrder = index === 1 ? 9 : 4 - index;
    }
    const onPlayerChange = vi.fn();

    const desktop = render(
      <ScoreGridHarness initialPlayers={players} onPlayerChange={onPlayerChange} />,
    );

    expect(desktop.container.querySelector('[data-play-order="4"]')?.closest("tr")).toHaveStyle({
      "--play-order-accent": "var(--color-play-order-4)",
    });
    expect(
      desktop.container.querySelector('[data-play-order="unknown"]')?.closest("tr"),
    ).toHaveStyle({ "--play-order-accent": "var(--color-border-strong)" });
    desktop.unmount();

    matchMedia = installMatchMediaController(true);
    const mobile = render(
      <ScoreGridHarness initialPlayers={players} onPlayerChange={onPlayerChange} />,
    );

    expect(mobile.container.querySelector('[data-play-order="4"]')?.closest("article")).toHaveStyle(
      { "--play-order-accent": "var(--color-play-order-4)" },
    );
    expect(
      mobile.container.querySelector('[data-play-order="unknown"]')?.closest("article"),
    ).toHaveStyle({ "--play-order-accent": "var(--color-border-strong)" });
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

    expect(screen.getByText("未確認2件／全2件")).toBeInTheDocument();
    expect(screen.getByText("既知エイリアスで解決")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "この値で確認済み" }));
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "次の要確認セルへ" }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("moves focus to a reachable unresolved item when the prior active item is reviewed", () => {
    render(
      <ScoreGridHarness
        onPlayerChange={vi.fn()}
        review={{
          acknowledgedCellIds: ["players.0.memberId"],
          activeCellId: "players.0.memberId",
          items: [
            {
              cellId: "players.0.memberId",
              confidence: 0.9,
              field: "memberId",
              label: "確認済みの項目",
              message: "確認済み",
              row: 0,
              sourceKind: "total_assets",
              warningCount: 1,
            },
            {
              cellId: "players.1.memberId",
              confidence: 0.7,
              field: "memberId",
              label: "次の未確認項目",
              message: "照合が必要",
              row: 1,
              sourceKind: "total_assets",
              warningCount: 1,
            },
          ],
        }}
      />,
    );

    const toolbar = screen.getByLabelText("OCR確認レール");
    expect(within(toolbar).getByText("次の未確認項目")).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: "この値で確認済み" })).toBeEnabled();
  });

  it("does not show an OCR toolbar when there is nothing left to review", () => {
    render(
      <ScoreGridReviewToolbar
        activeItem={undefined}
        activeReviewed={false}
        remainingCount={0}
        totalCount={2}
        onAcknowledge={() => undefined}
        onNext={() => undefined}
        onPrevious={() => undefined}
      />,
    );

    expect(screen.queryByLabelText("OCR確認レール")).not.toBeInTheDocument();
    expect(screen.queryByText(/すべて確認/u)).not.toBeInTheDocument();
  });

  it("moves focus to the submit action before the final acknowledgement removes the toolbar", async () => {
    const user = userEvent.setup();

    render(<FinalAcknowledgementHarness />);
    await user.click(screen.getByRole("button", { name: "この値で確認済み" }));

    expect(screen.queryByLabelText("OCR確認レール")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "確定前の確認へ進む" })).toHaveFocus();
  });
});

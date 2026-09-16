import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { draftToMatchForm } from "@/features/matches/workspace/draftToMatchForm";
import type { IncidentKey, MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import { emptyPlayers } from "@/features/matches/workspace/matchFormTypes";
import { createSampleDraftMap } from "@/features/matches/workspace/review/sampleDrafts";
import { ScoreGrid } from "@/features/matches/workspace/scoreGrid/ScoreGrid";
import { ScoreGridReviewToolbar } from "@/features/matches/workspace/scoreGrid/ScoreGridReviewToolbar";
import type { ScoreGridProps } from "@/features/matches/workspace/scoreGrid/ScoreGridTypes";
import { useMatchWorkspaceReviewState } from "@/features/matches/workspace/useMatchWorkspaceReviewState";
import { installMatchMediaController } from "@/test/doubles/dom";
import type { MatchMediaController } from "@/test/doubles/dom";
import { selectOption } from "@/test/selectOption";

const noErrorPaths = new Set<string>();
const noReview: ScoreGridProps["data"]["review"] = {
  acknowledgedCellIds: [],
  activeCellId: null,
  items: [],
};

const reviewSample = draftToMatchForm({
  draftByKind: createSampleDraftMap(),
  nowIso: "2026-01-01T00:00:00.000Z",
});

function GuidedReviewHarness() {
  const [values, setValues] = useState(reviewSample.values);
  const review = useMatchWorkspaceReviewState({
    values,
    workspaceData: reviewSample.initialData,
  });
  return (
    <ScoreGrid
      actions={{
        onAcknowledgeReviewCell: review.acknowledgeCell,
        onIncidentChange: () => undefined,
        onPlayerChange: (index, patch) =>
          setValues((current) => ({
            ...current,
            players: current.players.map((player, row) =>
              row === index ? { ...player, ...patch } : player,
            ),
          })),
        onPlayOrderChange: () => undefined,
        onRequestSubmitFocus: () => undefined,
        onReviewCellFocus: review.focusCell,
      }}
      data={{
        errorPathSet: noErrorPaths,
        lastSyncedPlayerIndex: null,
        originalPlayers: reviewSample.initialData.originalPlayers,
        players: values.players,
        review,
      }}
    />
  );
}

function ScoreGridHarness({
  errorPathSet = noErrorPaths,
  onPlayerChange,
  review = noReview,
}: {
  errorPathSet?: Set<string>;
  onPlayerChange: (index: number, patch: Partial<MatchFormValues["players"][number]>) => void;
  review?: ScoreGridProps["data"]["review"];
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

  it("opens and focuses each warning while preserving values and explicit acknowledgement", async () => {
    matchMedia = installMatchMediaController(true);
    const user = userEvent.setup();
    render(<GuidedReviewHarness />);
    const next = screen.getByRole("button", { name: "次の要確認セルへ" });
    const previous = screen.getByRole("button", { name: "前の要確認セルへ" });

    await user.click(next);
    expect(screen.getByRole("combobox", { name: /^メンバー/u })).toHaveFocus();
    expect(screen.getByRole("combobox", { name: /^メンバー/u })).toHaveTextContent("あかねまみ");
    await user.click(next);
    const rank = screen.getByRole("textbox", { name: "おーたか 順位" });
    expect(rank).toHaveFocus();
    expect(rank).toHaveValue("3");
    await user.click(previous);
    expect(screen.getByRole("combobox", { name: /^メンバー/u })).toHaveFocus();
    expect(screen.getByText("未確認2件／全2件")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "この値で確認済み" }));
    await user.click(next);
    expect(screen.getByRole("textbox", { name: "おーたか 順位" })).toHaveFocus();
    await user.click(next);
    expect(screen.getByRole("textbox", { name: "おーたか 順位" })).toHaveFocus();
    expect(screen.getByText("未確認1件／全2件")).toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole("textbox", { name: "おーたか 総資産（万円）" })).toHaveFocus();
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

  it("commits member changes from mobile cards", async () => {
    matchMedia = installMatchMediaController(true);
    const user = userEvent.setup();
    const onPlayerChange =
      vi.fn<(index: number, patch: Partial<MatchFormValues["players"][number]>) => void>();

    render(<ScoreGridHarness onPlayerChange={onPlayerChange} />);

    const memberSelect = screen.getByLabelText("メンバー");
    await selectOption(user, memberSelect, "member_eu");

    expect(onPlayerChange).toHaveBeenLastCalledWith(0, { memberId: "member_eu" });
    expect(memberSelect).toHaveTextContent("いーゆー");
  });

  it("uses selection keys inside selects and keeps horizontal and numeric cell navigation", async () => {
    const user = userEvent.setup();
    const onPlayerChange = vi.fn();
    render(<ScoreGridHarness onPlayerChange={onPlayerChange} />);
    const member = screen.getByRole("combobox", { name: "ぽんた メンバー" });
    const order = screen.getByRole("combobox", { name: "ぽんた プレー順" });

    member.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("listbox");
    await user.keyboard("{ArrowDown}{Escape}");
    await waitFor(() => expect(member).toHaveFocus());
    expect(member).toHaveTextContent("ぽんた");
    expect(onPlayerChange).not.toHaveBeenCalled();
    await user.keyboard("{ArrowRight}");
    expect(order).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    await screen.findByRole("listbox");
    await user.keyboard("{Tab}");
    const rank = screen.getByRole("textbox", { name: "ぽんた 順位" });
    await waitFor(() => expect(rank).toHaveFocus());
    await user.keyboard("{Enter}");
    expect(screen.getByRole("textbox", { name: "あかねまみ 順位" })).toHaveFocus();
  });

  it("exposes invalid score cells through native ARIA", () => {
    const errorPathSet = new Set(["players.0.playOrder", "players.0.rank"]);

    render(<ScoreGridHarness errorPathSet={errorPathSet} onPlayerChange={vi.fn()} />);

    const playOrderSelect = screen.getByRole("combobox", { name: "ぽんた プレー順" });
    const rankInput = screen.getByRole("textbox", { name: "ぽんた 順位" });

    expect(playOrderSelect).toHaveAttribute("aria-invalid", "true");
    expect(rankInput).toHaveAttribute("aria-invalid", "true");
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

    const toolbar = screen.getByLabelText("OCRの確認項目");
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

    expect(screen.queryByLabelText("OCRの確認項目")).not.toBeInTheDocument();
    expect(screen.queryByText(/すべて確認/u)).not.toBeInTheDocument();
  });

  it("moves focus to the submit action before the final acknowledgement removes the toolbar", async () => {
    const user = userEvent.setup();

    render(<FinalAcknowledgementHarness />);
    await user.click(screen.getByRole("button", { name: "この値で確認済み" }));

    expect(screen.queryByLabelText("OCRの確認項目")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "確定前の確認へ進む" })).toHaveFocus();
  });
});

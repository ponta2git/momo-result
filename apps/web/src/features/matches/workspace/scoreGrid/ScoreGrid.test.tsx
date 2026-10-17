import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { draftToMatchForm } from "@/features/matches/workspace/draftToMatchForm";
import type {
  IncidentKey,
  MatchFormValues,
  OriginalPlayerSnapshot,
} from "@/features/matches/workspace/matchFormTypes";
import { emptyPlayers } from "@/features/matches/workspace/matchFormTypes";
import { createMatchWorkspaceEditingStore } from "@/features/matches/workspace/matchWorkspaceEditingStore";
import { createSampleDraftMap } from "@/features/matches/workspace/review/sampleDrafts";
import { ScoreGrid as ConnectedScoreGrid } from "@/features/matches/workspace/scoreGrid/ScoreGrid";
import type { ScoreGridProps } from "@/features/matches/workspace/scoreGrid/ScoreGridTypes";
import { useWorkspaceReadView } from "@/features/matches/workspace/useWorkspaceReadView";
import { installMatchMediaController } from "@/test/doubles/dom";
import type { MatchMediaController } from "@/test/doubles/dom";
import { selectOption } from "@/test/selectOption";

// UI-only fixtures publish immutable row views; workflow tests use the real editing store.
function ScoreGrid({
  actions,
  data,
}: {
  actions: Omit<ScoreGridProps["actions"], "onNumericDraftChange">;
  data: Omit<ScoreGridProps["data"], "rows"> & {
    players: MatchFormValues["players"];
    originalPlayers: OriginalPlayerSnapshot[] | undefined;
    lastSyncedPlayerIndex: number | null;
  };
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const rows = data.players.map((player, index) => {
    const snapshot = {
      player,
      originalPlayer: data.originalPlayers?.[index],
      originalByOrder: data.originalPlayers?.find(
        (original) => original.playOrder === player.playOrder,
      ),
      numericDrafts: drafts,
      items: data.review.items.filter((item) => item.row === index),
      acknowledgedCellIds: data.review.acknowledgedCellIds,
      synced: data.lastSyncedPlayerIndex === index,
    };
    return { getSnapshot: () => snapshot, subscribe: () => () => undefined };
  });
  return (
    <ConnectedScoreGrid
      actions={{
        ...actions,
        onNumericDraftChange: (path, value) =>
          setDrafts((current) => {
            const next = { ...current };
            if (value === undefined) delete next[path];
            else next[path] = value;
            return next;
          }),
      }}
      data={{
        rows,
        review: data.review,
        errorPathSet: data.errorPathSet,
        validationFocusRequest: data.validationFocusRequest,
      }}
    />
  );
}

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
  const [editing] = useState(() => {
    const store = createMatchWorkspaceEditingStore("2026-01-01T00:00:00.000Z");
    store.initialize(reviewSample.values, reviewSample.initialData);
    return store;
  });
  const review = useWorkspaceReadView(editing.review);
  return (
    <ConnectedScoreGrid
      actions={{
        onAcknowledgeReviewCell: editing.actions.acknowledge,
        onIncidentChange: editing.actions.changeIncident,
        onNumericDraftChange: editing.actions.changeNumericDraft,
        onPlayerChange: editing.actions.changePlayer,
        onPlayOrderChange: () => undefined,
        onRequestSubmitFocus: () => undefined,
        onReviewCellFocus: editing.actions.focus,
      }}
      data={{
        errorPathSet: noErrorPaths,
        rows: editing.scoreRows,
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
        onPlayerChange: (index, field, value) => {
          const patch = { [field]: value };
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

  it.each(["ArrowLeft", "ArrowRight"])("keeps focus during IME composition with %s", (key) => {
    render(<ScoreGridHarness onPlayerChange={vi.fn()} />);
    const rank = screen.getByRole<HTMLInputElement>("textbox", { name: "ぽんた 順位" });
    rank.focus();
    rank.setSelectionRange(0, rank.value.length);

    fireEvent.keyDown(rank, { isComposing: true, key });

    expect(rank).toHaveFocus();
  });

  it("exposes invalid score cells through native ARIA", () => {
    const errorPathSet = new Set(["players.0.playOrder", "players.0.rank"]);

    render(<ScoreGridHarness errorPathSet={errorPathSet} onPlayerChange={vi.fn()} />);

    const playOrderSelect = screen.getByRole("combobox", { name: "ぽんた プレー順" });
    const rankInput = screen.getByRole("textbox", { name: "ぽんた 順位" });

    expect(playOrderSelect).toHaveAttribute("aria-invalid", "true");
    expect(rankInput).toHaveAttribute("aria-invalid", "true");
  });

  it.each([
    { name: "incomplete", value: "-" },
    { name: "unsafe integer", value: "9007199254740993" },
    { name: "overflowing", value: "9".repeat(310) },
  ])("preserves a $name numeric draft without committing a lossy value", async ({ value }) => {
    matchMedia = installMatchMediaController(true);
    const user = userEvent.setup();
    const onPlayerChange =
      vi.fn<(index: number, patch: Partial<MatchFormValues["players"][number]>) => void>();

    render(<ScoreGridHarness onPlayerChange={onPlayerChange} />);

    const revenueInput = screen.getByRole("textbox", {
      name: /ぽんた 収益/u,
    });

    await user.clear(revenueInput);
    await user.paste(value);
    await user.tab();

    expect(revenueInput).toHaveValue(value);
    expect(onPlayerChange).not.toHaveBeenCalled();
  });

  it("retains an uncommitted number when the responsive editor changes", async () => {
    matchMedia = installMatchMediaController(false);
    const user = userEvent.setup();
    const onPlayerChange = vi.fn();
    render(<ScoreGridHarness onPlayerChange={onPlayerChange} />);
    const revenue = screen.getByRole("textbox", { name: "ぽんた 収益（万円）" });
    await user.clear(revenue);
    await user.type(revenue, "-42");
    expect(onPlayerChange).not.toHaveBeenCalled();
    act(() => matchMedia?.setMatches(true));
    const mobileRevenue = screen.getByRole("textbox", { name: "ぽんた 収益（万円）" });
    expect(mobileRevenue).toHaveValue("-42");
    await user.click(mobileRevenue);
    await user.tab();
    expect(onPlayerChange).toHaveBeenLastCalledWith(0, { revenueManYen: -42 });
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

  it("moves focus to the submit action before the final acknowledgement removes the toolbar", async () => {
    const user = userEvent.setup();

    render(<FinalAcknowledgementHarness />);
    await user.click(screen.getByRole("button", { name: "この値で確認済み" }));

    expect(screen.queryByLabelText("OCRの確認項目")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "確定前の確認へ進む" })).toHaveFocus();
  });
});

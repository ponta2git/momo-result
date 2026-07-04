import { useCallback, useMemo, useRef, useState } from "react";

import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import { gridColumns } from "@/features/matches/workspace/scoreGrid/ScoreGridColumns";
import { ScoreGridDesktopTable } from "@/features/matches/workspace/scoreGrid/ScoreGridDesktop";
import { handleScoreGridKeydown } from "@/features/matches/workspace/scoreGrid/ScoreGridKeyboard";
import { ScoreGridMobileCards } from "@/features/matches/workspace/scoreGrid/ScoreGridMobile";
import type {
  IncidentNumericCommit,
  PlayerNumericCommit,
} from "@/features/matches/workspace/scoreGrid/ScoreGridNumericEditor";
import type {
  ScoreGridKeyboardHandler,
  ScoreGridProps,
} from "@/features/matches/workspace/scoreGrid/ScoreGridTypes";
import { useMediaQuery } from "@/shared/lib/useMediaQuery";

export function ScoreGrid({ actions, data }: ScoreGridProps) {
  const [expandedMobilePlayer, setExpandedMobilePlayer] = useState(0);
  const isNarrowViewport = useMediaQuery("(max-width: 1023px)");
  const inputRefs = useRef(new Map<string, HTMLElement>());

  const originalByPlayOrder = useMemo(() => {
    if (!data.originalPlayers) {
      return new Map();
    }
    return new Map(data.originalPlayers.map((player) => [player.playOrder, player]));
  }, [data.originalPlayers]);

  const getCellId = useCallback(
    (row: number, col: number) => `player-${row}-${gridColumns[col]}`,
    [],
  );

  const registerCellRef = useCallback((cellId: string, node: HTMLElement | null) => {
    if (node) {
      inputRefs.current.set(cellId, node);
    } else {
      inputRefs.current.delete(cellId);
    }
  }, []);

  const focusCell = useCallback((cellId: string) => {
    const next = inputRefs.current.get(cellId);
    if (next) {
      next.focus();
    }
  }, []);

  const handleKeyboard = useCallback<ScoreGridKeyboardHandler>(
    (args) => {
      const target = args.event.currentTarget;

      if (args.event.key === "ArrowLeft" || args.event.key === "ArrowRight") {
        const delta = args.event.key === "ArrowLeft" ? -1 : 1;
        const nextCol = args.col + delta;
        if (nextCol >= 0 && nextCol < gridColumns.length) {
          const isSelect = target instanceof HTMLSelectElement;
          const isInputSelectedAll =
            target instanceof HTMLInputElement &&
            target.selectionStart === 0 &&
            target.selectionEnd === target.value.length;

          if (isSelect || isInputSelectedAll) {
            args.event.preventDefault();
            focusCell(getCellId(args.row, nextCol));
            return;
          }
        }
      }

      handleScoreGridKeydown({
        colCount: gridColumns.length,
        event: args.event,
        getCellId: ({ col, row }) => getCellId(row, col),
        horizontalEnterFromCol: 5,
        onFocusCell: focusCell,
        onRevertCell: args.onRevertCell,
        onSubmitFocus: actions.onRequestSubmitFocus,
        position: { col: args.col, row: args.row },
        rowCount: data.players.length,
      });
    },
    [actions.onRequestSubmitFocus, data.players.length, focusCell, getCellId],
  );

  const handlePlayerNumericCommit = useCallback<PlayerNumericCommit>(
    (index, field, value) =>
      actions.onPlayerChange(index, {
        [field]: value,
      } as Partial<MatchFormValues["players"][number]>),
    [actions],
  );

  const handleIncidentNumericCommit = useCallback<IncidentNumericCommit>(
    (index, key, value) => actions.onIncidentChange(index, key, value),
    [actions],
  );

  const handleToggleMobilePlayer = useCallback((index: number) => {
    setExpandedMobilePlayer((current) => (current === index ? -1 : index));
  }, []);

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
            4人分の結果を確認・修正
          </h2>
          <p className="mt-1 text-sm text-pretty text-[var(--color-text-secondary)]">
            Enterキーと矢印キーで移動できます。Escキーで編集中のセルを元に戻せます。
          </p>
        </div>
      </div>

      {isNarrowViewport ? null : (
        <div className="mt-4 overflow-x-auto pb-2">
          <ScoreGridDesktopTable
            errorPathSet={data.errorPathSet}
            getCellId={getCellId}
            handleIncidentNumericCommit={handleIncidentNumericCommit}
            handleKeyboard={handleKeyboard}
            handlePlayerNumericCommit={handlePlayerNumericCommit}
            lastSyncedPlayerIndex={data.lastSyncedPlayerIndex}
            originalByPlayOrder={originalByPlayOrder}
            originalPlayers={data.originalPlayers}
            players={data.players}
            registerCellRef={registerCellRef}
            onPlayerChange={actions.onPlayerChange}
            onPlayOrderChange={actions.onPlayOrderChange}
            onPreferImageKindChange={actions.onPreferImageKindChange}
          />
        </div>
      )}

      {isNarrowViewport ? (
        <ScoreGridMobileCards
          errorPathSet={data.errorPathSet}
          expandedMobilePlayer={expandedMobilePlayer}
          handleIncidentNumericCommit={handleIncidentNumericCommit}
          handlePlayerNumericCommit={handlePlayerNumericCommit}
          lastSyncedPlayerIndex={data.lastSyncedPlayerIndex}
          originalPlayers={data.originalPlayers}
          players={data.players}
          onPlayerChange={actions.onPlayerChange}
          onPlayOrderChange={actions.onPlayOrderChange}
          onPreferImageKindChange={actions.onPreferImageKindChange}
          onTogglePlayer={handleToggleMobilePlayer}
        />
      ) : null}
    </section>
  );
}

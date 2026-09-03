import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import { reviewCellId } from "@/features/matches/workspace/review/reviewWarningModel";
import type { ReviewFieldKey } from "@/features/matches/workspace/review/reviewWarningModel";
import { gridColumns } from "@/features/matches/workspace/scoreGrid/ScoreGridColumns";
import { ScoreGridDesktopTable } from "@/features/matches/workspace/scoreGrid/ScoreGridDesktop";
import { handleScoreGridKeydown } from "@/features/matches/workspace/scoreGrid/ScoreGridKeyboard";
import { ScoreGridMobileCards } from "@/features/matches/workspace/scoreGrid/ScoreGridMobile";
import type {
  IncidentNumericCommit,
  PlayerNumericCommit,
} from "@/features/matches/workspace/scoreGrid/ScoreGridNumericEditor";
import { ScoreGridReviewToolbar } from "@/features/matches/workspace/scoreGrid/ScoreGridReviewToolbar";
import type {
  ScoreGridKeyboardHandler,
  ScoreGridProps,
} from "@/features/matches/workspace/scoreGrid/ScoreGridTypes";
import { useMediaQuery } from "@/shared/lib/useMediaQuery";

export function ScoreGrid({ actions, data }: ScoreGridProps) {
  const [expandedMobilePlayer, setExpandedMobilePlayer] = useState(0);
  const [pendingFocusCellId, setPendingFocusCellId] = useState<string | null>(null);
  const isNarrowViewport = useMediaQuery("(max-width: 1119px)");
  const inputRefs = useRef(new Map<string, HTMLElement>());
  const {
    onAcknowledgeReviewCell,
    onIncidentChange,
    onPlayerChange,
    onPlayOrderChange,
    onPreferImageKindChange,
    onRequestSubmitFocus,
    onReviewCellFocus,
  } = actions;

  const originalByPlayOrder = useMemo(() => {
    if (!data.originalPlayers) {
      return new Map();
    }
    return new Map(data.originalPlayers.map((player) => [player.playOrder, player]));
  }, [data.originalPlayers]);

  const getCellId = useCallback(
    (row: number, col: number) => reviewCellId(row, gridColumns[col] as ReviewFieldKey),
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

  useEffect(() => {
    if (!pendingFocusCellId) {
      return;
    }
    const next = inputRefs.current.get(pendingFocusCellId);
    if (!next) {
      return;
    }
    next.focus();
    setPendingFocusCellId(null);
  }, [expandedMobilePlayer, pendingFocusCellId]);

  const acknowledgedCellIdSet = useMemo(
    () => new Set(data.review.acknowledgedCellIds),
    [data.review.acknowledgedCellIds],
  );
  const unresolvedItems = data.review.items.filter(
    (item) => !acknowledgedCellIdSet.has(item.cellId),
  );
  const activeItem =
    unresolvedItems.find((item) => item.cellId === data.review.activeCellId) ?? unresolvedItems[0];

  const requestReviewItemFocus = useCallback((cellId: string, row: number) => {
    setExpandedMobilePlayer(row);
    setPendingFocusCellId(cellId);
  }, []);

  const navigateReviewItems = useCallback(
    (direction: -1 | 1) => {
      if (unresolvedItems.length === 0) {
        return;
      }
      const currentIndex = unresolvedItems.findIndex(
        (item) => item.cellId === data.review.activeCellId,
      );
      const startIndex = currentIndex < 0 ? (direction > 0 ? -1 : 0) : currentIndex;
      const nextIndex = (startIndex + direction + unresolvedItems.length) % unresolvedItems.length;
      const next = unresolvedItems[nextIndex];
      if (next) {
        requestReviewItemFocus(next.cellId, next.row);
      }
    },
    [data.review.activeCellId, requestReviewItemFocus, unresolvedItems],
  );

  const acknowledgeActiveItem = useCallback(() => {
    if (activeItem) {
      onAcknowledgeReviewCell(activeItem.cellId);
      if (unresolvedItems.length === 1) {
        onRequestSubmitFocus();
      }
    }
  }, [activeItem, onAcknowledgeReviewCell, onRequestSubmitFocus, unresolvedItems.length]);

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
        onSubmitFocus: onRequestSubmitFocus,
        position: { col: args.col, row: args.row },
        rowCount: data.players.length,
      });
    },
    [data.players.length, focusCell, getCellId, onRequestSubmitFocus],
  );

  const handlePlayerNumericCommit = useCallback<PlayerNumericCommit>(
    (index, field, value) =>
      onPlayerChange(index, {
        [field]: value,
      } as Partial<MatchFormValues["players"][number]>),
    [onPlayerChange],
  );

  const handleIncidentNumericCommit = useCallback<IncidentNumericCommit>(
    (index, key, value) => onIncidentChange(index, key, value),
    [onIncidentChange],
  );

  const handleToggleMobilePlayer = useCallback((index: number) => {
    setExpandedMobilePlayer((current) => (current === index ? -1 : index));
  }, []);

  return (
    <section data-validation-path="players" tabIndex={-1}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
            4人分の結果を確認・修正
          </h2>
          {isNarrowViewport ? null : (
            <p className="mt-1 text-sm text-pretty text-[var(--color-text-secondary)]">
              Enterキーと矢印キーで移動できます。Escキーで編集中のセルを元に戻せます。
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 empty:hidden">
        <ScoreGridReviewToolbar
          activeItem={activeItem}
          activeReviewed={Boolean(activeItem && acknowledgedCellIdSet.has(activeItem.cellId))}
          remainingCount={unresolvedItems.length}
          totalCount={data.review.items.length}
          onAcknowledge={acknowledgeActiveItem}
          onNext={() => navigateReviewItems(1)}
          onPrevious={() => navigateReviewItems(-1)}
        />
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
            review={data.review}
            registerCellRef={registerCellRef}
            onPlayerChange={onPlayerChange}
            onPlayOrderChange={onPlayOrderChange}
            onPreferImageKindChange={onPreferImageKindChange}
            onReviewCellFocus={onReviewCellFocus}
          />
        </div>
      )}

      {isNarrowViewport ? (
        <div className="mt-4">
          <ScoreGridMobileCards
            errorPathSet={data.errorPathSet}
            expandedMobilePlayer={expandedMobilePlayer}
            handleIncidentNumericCommit={handleIncidentNumericCommit}
            handlePlayerNumericCommit={handlePlayerNumericCommit}
            lastSyncedPlayerIndex={data.lastSyncedPlayerIndex}
            originalPlayers={data.originalPlayers}
            players={data.players}
            review={data.review}
            getCellId={getCellId}
            registerCellRef={registerCellRef}
            onPlayerChange={onPlayerChange}
            onPlayOrderChange={onPlayOrderChange}
            onPreferImageKindChange={onPreferImageKindChange}
            onReviewCellFocus={onReviewCellFocus}
            onTogglePlayer={handleToggleMobilePlayer}
          />
        </div>
      ) : null}
    </section>
  );
}

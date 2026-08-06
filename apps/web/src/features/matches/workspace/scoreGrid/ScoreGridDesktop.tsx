import type { CSSProperties } from "react";

import type {
  MatchFormValues,
  OriginalPlayerSnapshot,
} from "@/features/matches/workspace/matchFormTypes";
import {
  incidentScoreGridColumns,
  keyToPath,
  memberSelectClass,
  playerSlotKey,
  scoreGridColumns,
  selectShortClass,
  textNumericShortClass,
} from "@/features/matches/workspace/scoreGrid/ScoreGridColumns";
import type { GridColumn } from "@/features/matches/workspace/scoreGrid/ScoreGridColumns";
import { PlayerNumericDesktopCell } from "@/features/matches/workspace/scoreGrid/ScoreGridDesktopNumericCell";
import { ScoreGridNumericEditor } from "@/features/matches/workspace/scoreGrid/ScoreGridNumericEditor";
import {
  ScoreGridSelectStatus,
  selectCellTone,
} from "@/features/matches/workspace/scoreGrid/ScoreGridSelectState";
import type {
  ScoreGridActions,
  ScoreGridCellRegistry,
  ScoreGridData,
  ScoreGridKeyboardHandler,
  ScoreGridNumericHandlers,
} from "@/features/matches/workspace/scoreGrid/ScoreGridTypes";
import { fixedMembers, memberDisplayName } from "@/shared/domain/members";
import { cn } from "@/shared/ui/cn";

type ScoreGridDesktopTableProps = ScoreGridData &
  ScoreGridCellRegistry &
  ScoreGridNumericHandlers & {
    handleKeyboard: ScoreGridKeyboardHandler;
    onPlayerChange: ScoreGridActions["onPlayerChange"];
    onPlayOrderChange: ScoreGridActions["onPlayOrderChange"];
    onPreferImageKindChange?: ScoreGridActions["onPreferImageKindChange"] | undefined;
    onReviewCellFocus: ScoreGridActions["onReviewCellFocus"];
    originalByPlayOrder: Map<number, OriginalPlayerSnapshot>;
  };

export function ScoreGridDesktopTable({
  errorPathSet,
  getCellId,
  handleIncidentNumericCommit,
  handleKeyboard,
  handlePlayerNumericCommit,
  lastSyncedPlayerIndex,
  onPlayerChange,
  onPlayOrderChange,
  onPreferImageKindChange,
  onReviewCellFocus,
  originalByPlayOrder,
  originalPlayers,
  players,
  registerCellRef,
  review,
}: ScoreGridDesktopTableProps) {
  const reviewItemByCellId = new Map(review.items.map((item) => [item.cellId, item]));
  const reviewedCellIds = new Set(review.acknowledgedCellIds);
  return (
    <table className="min-w-[64rem] table-fixed border-separate border-spacing-y-2 text-left text-sm">
      <colgroup>
        {scoreGridColumns.map((column) => (
          <col key={column.column} className={column.widthClass} />
        ))}
      </colgroup>
      <thead className="text-xs text-[var(--color-text-secondary)]">
        <tr>
          {scoreGridColumns.map((column) => (
            <th
              key={column.column}
              className={
                column.kind === "member"
                  ? "sticky left-0 z-[var(--z-dropdown)] bg-[var(--color-surface)] px-2 py-2"
                  : "px-2 py-2"
              }
            >
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {players.map((player, rowIndex) => {
          const originalRow = originalPlayers?.[rowIndex];
          const originalByOrder = originalByPlayOrder.get(player.playOrder);
          const memberCellId = getCellId(rowIndex, 0);
          const memberReviewItem = reviewItemByCellId.get(memberCellId);
          const playOrderCellId = getCellId(rowIndex, 1);
          const playOrderReviewItem = reviewItemByCellId.get(playOrderCellId);
          const playOrderError = errorPathSet.has(keyToPath(rowIndex, "playOrder"));
          return (
            <tr
              key={playerSlotKey(rowIndex)}
              className="bg-[var(--color-surface-subtle)]"
              style={{ "--player-accent": `var(--color-player-${rowIndex + 1})` } as CSSProperties}
            >
              <td className="sticky left-0 z-[var(--z-sticky)] rounded-l-[var(--radius-md)] border-l-[3px] border-l-[var(--player-accent)] bg-[var(--color-surface-subtle)] px-2 py-3 align-top">
                <select
                  ref={(node) => registerCellRef(memberCellId, node)}
                  aria-describedby={memberReviewItem ? `${memberCellId}-review-status` : undefined}
                  aria-label={`${memberDisplayName(player.memberId)} メンバー`}
                  className={cn(
                    memberSelectClass,
                    selectCellTone({
                      changed: Boolean(originalRow && originalRow.memberId !== player.memberId),
                      reviewItem: memberReviewItem,
                      reviewed: reviewedCellIds.has(memberCellId),
                    }),
                  )}
                  data-validation-path={keyToPath(rowIndex, "memberId")}
                  value={player.memberId}
                  onChange={(event) => {
                    onPlayerChange(rowIndex, {
                      memberId: event.target
                        .value as MatchFormValues["players"][number]["memberId"],
                    });
                  }}
                  onFocus={() => {
                    onPreferImageKindChange?.("total_assets");
                    onReviewCellFocus(rowIndex, "memberId");
                  }}
                  onKeyDown={(event) =>
                    handleKeyboard({
                      col: 0,
                      event,
                      onRevertCell: () => undefined,
                      row: rowIndex,
                    })
                  }
                >
                  {fixedMembers.map((member) => (
                    <option key={member.memberId} value={member.memberId}>
                      {member.displayName}
                    </option>
                  ))}
                </select>
                <ScoreGridSelectStatus
                  cellId={memberCellId}
                  changed={Boolean(originalRow && originalRow.memberId !== player.memberId)}
                  reviewItem={memberReviewItem}
                  reviewed={reviewedCellIds.has(memberCellId)}
                />
              </td>

              <td className="px-2 py-3 align-top">
                <select
                  ref={(node) => registerCellRef(playOrderCellId, node)}
                  aria-describedby={
                    playOrderError || playOrderReviewItem
                      ? `${playOrderCellId}-review-status`
                      : undefined
                  }
                  aria-invalid={playOrderError || undefined}
                  aria-label={`${memberDisplayName(player.memberId)} プレー順`}
                  className={cn(
                    selectShortClass,
                    selectCellTone({
                      changed: Boolean(originalRow && originalRow.playOrder !== player.playOrder),
                      error: playOrderError,
                      reviewItem: playOrderReviewItem,
                      reviewed: reviewedCellIds.has(playOrderCellId),
                    }),
                  )}
                  data-validation-path={keyToPath(rowIndex, "playOrder")}
                  value={Number.isFinite(player.playOrder) ? String(player.playOrder) : ""}
                  onChange={(event) =>
                    onPlayOrderChange(rowIndex, Number.parseInt(event.target.value, 10))
                  }
                  onFocus={() => {
                    onPreferImageKindChange?.("incident_log");
                    onReviewCellFocus(rowIndex, "playOrder");
                  }}
                  onKeyDown={(event) =>
                    handleKeyboard({
                      col: 1,
                      event,
                      onRevertCell: () => undefined,
                      row: rowIndex,
                    })
                  }
                >
                  <option value="">-</option>
                  {[1, 2, 3, 4].map((order) => (
                    <option key={order} value={order}>
                      {order}
                    </option>
                  ))}
                </select>
                <ScoreGridSelectStatus
                  cellId={playOrderCellId}
                  changed={Boolean(originalRow && originalRow.playOrder !== player.playOrder)}
                  error={playOrderError}
                  reviewItem={playOrderReviewItem}
                  reviewed={reviewedCellIds.has(playOrderCellId)}
                  synced={lastSyncedPlayerIndex === rowIndex}
                />
              </td>

              <PlayerNumericDesktopCell
                col={2}
                error={errorPathSet.has(keyToPath(rowIndex, "rank"))}
                field="rank"
                focusImageKind="total_assets"
                originalValue={originalRow?.rank}
                player={player}
                rowIndex={rowIndex}
                getCellId={getCellId}
                handleKeyboard={handleKeyboard}
                handlePlayerNumericCommit={handlePlayerNumericCommit}
                registerCellRef={registerCellRef}
                reviewItem={reviewItemByCellId.get(getCellId(rowIndex, 2))}
                reviewed={reviewedCellIds.has(getCellId(rowIndex, 2))}
                onReviewCellFocus={onReviewCellFocus}
              />
              <PlayerNumericDesktopCell
                allowSign
                col={3}
                error={errorPathSet.has(keyToPath(rowIndex, "totalAssetsManYen"))}
                field="totalAssetsManYen"
                focusImageKind="total_assets"
                originalValue={originalRow?.totalAssetsManYen}
                player={player}
                rowIndex={rowIndex}
                getCellId={getCellId}
                handleKeyboard={handleKeyboard}
                handlePlayerNumericCommit={handlePlayerNumericCommit}
                onPreferImageKindChange={onPreferImageKindChange}
                registerCellRef={registerCellRef}
                reviewItem={reviewItemByCellId.get(getCellId(rowIndex, 3))}
                reviewed={reviewedCellIds.has(getCellId(rowIndex, 3))}
                onReviewCellFocus={onReviewCellFocus}
              />
              <PlayerNumericDesktopCell
                allowSign
                col={4}
                error={errorPathSet.has(keyToPath(rowIndex, "revenueManYen"))}
                field="revenueManYen"
                focusImageKind="revenue"
                originalValue={originalRow?.revenueManYen}
                player={player}
                rowIndex={rowIndex}
                getCellId={getCellId}
                handleKeyboard={handleKeyboard}
                handlePlayerNumericCommit={handlePlayerNumericCommit}
                onPreferImageKindChange={onPreferImageKindChange}
                registerCellRef={registerCellRef}
                reviewItem={reviewItemByCellId.get(getCellId(rowIndex, 4))}
                reviewed={reviewedCellIds.has(getCellId(rowIndex, 4))}
                onReviewCellFocus={onReviewCellFocus}
              />

              {incidentScoreGridColumns.map((column, incidentIndex) => {
                const col = incidentIndex + 5;
                const { incidentKey } = column;
                const cellId = getCellId(rowIndex, col);
                const reviewItem = reviewItemByCellId.get(cellId);
                return (
                  <td
                    key={incidentKey}
                    className="px-2 py-3 align-top last:rounded-r-[var(--radius-md)]"
                  >
                    <ScoreGridNumericEditor
                      allowSign={false}
                      ariaLabel={`${memberDisplayName(player.memberId)} ${column.header}`}
                      baseClassName={textNumericShortClass}
                      cellId={cellId}
                      col={col}
                      commitKind="incident"
                      error={errorPathSet.has(
                        keyToPath(rowIndex, `incident.${incidentKey}` as GridColumn),
                      )}
                      focusImageKind="incident_log"
                      incidentKey={incidentKey}
                      originalValue={originalByOrder?.incidents[column.header]}
                      registerCellRef={registerCellRef}
                      reviewField={`incident.${incidentKey}`}
                      reviewed={reviewedCellIds.has(cellId)}
                      reviewMessage={reviewItem?.message}
                      row={rowIndex}
                      showStateLabel
                      validationPath={keyToPath(rowIndex, `incident.${incidentKey}` as GridColumn)}
                      value={player.incidents[incidentKey]}
                      onIncidentCommit={handleIncidentNumericCommit}
                      onKeyboard={handleKeyboard}
                      onPreferImageKindChange={onPreferImageKindChange}
                      onReviewCellFocus={onReviewCellFocus}
                    />
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

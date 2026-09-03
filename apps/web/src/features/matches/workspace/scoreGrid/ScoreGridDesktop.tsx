import type { CSSProperties } from "react";

import type {
  MatchFormValues,
  OriginalPlayerSnapshot,
} from "@/features/matches/workspace/matchFormTypes";
import {
  incidentScoreGridColumns,
  keyToPath,
  playerSlotKey,
} from "@/features/matches/workspace/scoreGrid/ScoreGridColumns";
import type { GridColumn } from "@/features/matches/workspace/scoreGrid/ScoreGridColumns";
import { ScoreGridDesktopHeader } from "@/features/matches/workspace/scoreGrid/ScoreGridDesktopHeader";
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
import { canonicalResultMembers, memberDisplayName } from "@/shared/domain/members";
import { PlayOrderMark, playOrderPresentation } from "@/shared/ui/data/PlayOrderMark";
import { SelectControl } from "@/shared/ui/forms/Control";

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
      <ScoreGridDesktopHeader />
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
              style={
                {
                  "--play-order-accent": playOrderPresentation(player.playOrder).color,
                } as CSSProperties
              }
            >
              <td className="sticky left-0 z-[var(--z-sticky)] rounded-l-md border-l-[3px] border-l-[var(--play-order-accent)] bg-[var(--color-surface-subtle)] px-2 py-3 align-top">
                <div className="min-w-[10rem]">
                  <SelectControl
                    ref={(node) => registerCellRef(memberCellId, node)}
                    aria-describedby={
                      memberReviewItem ? `${memberCellId}-review-status` : undefined
                    }
                    aria-label={`${memberDisplayName(player.memberId)} メンバー`}
                    data-validation-path={keyToPath(rowIndex, "memberId")}
                    density="compact"
                    tone={selectCellTone({
                      changed: Boolean(originalRow && originalRow.memberId !== player.memberId),
                      reviewItem: memberReviewItem,
                      reviewed: reviewedCellIds.has(memberCellId),
                    })}
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
                    {canonicalResultMembers.map((member) => (
                      <option key={member.memberId} value={member.memberId}>
                        {member.displayName}
                      </option>
                    ))}
                  </SelectControl>
                  <ScoreGridSelectStatus
                    cellId={memberCellId}
                    changed={Boolean(originalRow && originalRow.memberId !== player.memberId)}
                    reviewItem={memberReviewItem}
                    reviewed={reviewedCellIds.has(memberCellId)}
                  />
                  <div className="mt-1">
                    <PlayOrderMark playOrder={player.playOrder} />
                  </div>
                </div>
              </td>

              <td className="px-2 py-3 align-top">
                <div className="min-w-[6ch]">
                  <SelectControl
                    ref={(node) => registerCellRef(playOrderCellId, node)}
                    aria-describedby={
                      playOrderError || playOrderReviewItem
                        ? `${playOrderCellId}-review-status`
                        : undefined
                    }
                    aria-label={`${memberDisplayName(player.memberId)} プレー順`}
                    data-validation-path={keyToPath(rowIndex, "playOrder")}
                    density="compact"
                    invalid={playOrderError}
                    textAlign="center"
                    tone={selectCellTone({
                      changed: Boolean(originalRow && originalRow.playOrder !== player.playOrder),
                      reviewItem: playOrderReviewItem,
                      reviewed: reviewedCellIds.has(playOrderCellId),
                    })}
                    value={Number.isFinite(player.playOrder) ? String(player.playOrder) : ""}
                    onChange={(event) =>
                      onPlayOrderChange(rowIndex, Math.trunc(Number(event.target.value)))
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
                  </SelectControl>
                  <ScoreGridSelectStatus
                    cellId={playOrderCellId}
                    changed={Boolean(originalRow && originalRow.playOrder !== player.playOrder)}
                    error={playOrderError}
                    reviewItem={playOrderReviewItem}
                    reviewed={reviewedCellIds.has(playOrderCellId)}
                    synced={lastSyncedPlayerIndex === rowIndex}
                  />
                </div>
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
                  <td key={incidentKey} className="px-2 py-3 align-top last:rounded-r-md">
                    <ScoreGridNumericEditor
                      allowSign={false}
                      ariaLabel={`${memberDisplayName(player.memberId)} ${column.header}`}
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

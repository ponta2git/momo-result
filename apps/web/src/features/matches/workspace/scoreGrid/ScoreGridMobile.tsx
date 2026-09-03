import type { CSSProperties } from "react";

import {
  incidentScoreGridColumns,
  keyToPath,
  playerSlotKey,
} from "@/features/matches/workspace/scoreGrid/ScoreGridColumns";
import {
  MobileMemberSelect,
  MobilePlayerNumericField,
  MobilePlayOrderSelect,
} from "@/features/matches/workspace/scoreGrid/ScoreGridMobileFields";
import { ScoreGridNumericEditor } from "@/features/matches/workspace/scoreGrid/ScoreGridNumericEditor";
import type {
  ScoreGridActions,
  ScoreGridCellRegistry,
  ScoreGridData,
  ScoreGridNumericHandlers,
} from "@/features/matches/workspace/scoreGrid/ScoreGridTypes";
import { memberDisplayName } from "@/shared/domain/members";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { PlayOrderMark, playOrderPresentation } from "@/shared/ui/data/PlayOrderMark";
import { RankBadge } from "@/shared/ui/rank/RankBadge";

type ScoreGridMobileCardsProps = ScoreGridData &
  ScoreGridCellRegistry &
  ScoreGridNumericHandlers & {
    expandedMobilePlayer: number;
    onPlayerChange: ScoreGridActions["onPlayerChange"];
    onPlayOrderChange: ScoreGridActions["onPlayOrderChange"];
    onPreferImageKindChange?: ScoreGridActions["onPreferImageKindChange"] | undefined;
    onReviewCellFocus: ScoreGridActions["onReviewCellFocus"];
    onTogglePlayer: (index: number) => void;
  };

export function ScoreGridMobileCards({
  errorPathSet,
  expandedMobilePlayer,
  getCellId,
  handleIncidentNumericCommit,
  handlePlayerNumericCommit,
  lastSyncedPlayerIndex,
  onPlayerChange,
  onPlayOrderChange,
  onPreferImageKindChange,
  onReviewCellFocus,
  onTogglePlayer,
  originalPlayers,
  players,
  registerCellRef,
  review,
}: ScoreGridMobileCardsProps) {
  const originalByPlayOrder = new Map(originalPlayers?.map((player) => [player.playOrder, player]));
  const reviewItemByCellId = new Map(review.items.map((item) => [item.cellId, item]));
  const reviewedCellIds = new Set(review.acknowledgedCellIds);
  return (
    <div className="grid gap-3">
      {players.map((player, index) => {
        const originalRow = originalPlayers?.[index];
        const originalByOrder = originalByPlayOrder.get(player.playOrder);
        const unresolvedCount = review.items.filter(
          (item) => item.row === index && !reviewedCellIds.has(item.cellId),
        ).length;
        return (
          <article
            key={playerSlotKey(index)}
            className="rounded-md border border-l-[3px] border-[var(--color-border)] border-l-[var(--play-order-accent)] bg-[var(--color-surface)] p-3"
            style={
              {
                "--play-order-accent": playOrderPresentation(player.playOrder).color,
              } as CSSProperties
            }
          >
            <Disclosure
              open={expandedMobilePlayer === index}
              panelSpacing="md"
              summary={
                <span className="flex min-w-0 items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-[var(--color-text-primary)]">
                      {memberDisplayName(player.memberId)}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-secondary)] tabular-nums">
                      <PlayOrderMark playOrder={player.playOrder} />
                      <RankBadge rank={player.rank} />
                      <span>総資産 {player.totalAssetsManYen.toLocaleString()}万円</span>
                      {unresolvedCount > 0 ? <span>・未確認{unresolvedCount}件</span> : null}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-[var(--color-text-secondary)]">
                    {expandedMobilePlayer === index ? "閉じる" : "詳細"}
                  </span>
                </span>
              }
              triggerLayout="flush"
              onOpenChange={(open) => {
                if (open !== (expandedMobilePlayer === index)) {
                  onTogglePlayer(index);
                }
              }}
            >
              <div className="space-y-2">
                <MobileMemberSelect
                  cellId={getCellId(index, 0)}
                  index={index}
                  memberId={player.memberId}
                  originalMemberId={originalRow?.memberId}
                  registerCellRef={registerCellRef}
                  reviewItem={reviewItemByCellId.get(getCellId(index, 0))}
                  reviewed={reviewedCellIds.has(getCellId(index, 0))}
                  onPlayerChange={onPlayerChange}
                  onPreferImageKindChange={onPreferImageKindChange}
                  onReviewCellFocus={onReviewCellFocus}
                />
                <div className="grid grid-cols-2 gap-2">
                  <MobilePlayOrderSelect
                    error={errorPathSet.has(keyToPath(index, "playOrder"))}
                    cellId={getCellId(index, 1)}
                    index={index}
                    originalPlayOrder={originalRow?.playOrder}
                    playOrder={player.playOrder}
                    registerCellRef={registerCellRef}
                    reviewItem={reviewItemByCellId.get(getCellId(index, 1))}
                    reviewed={reviewedCellIds.has(getCellId(index, 1))}
                    synced={lastSyncedPlayerIndex === index}
                    onPlayOrderChange={onPlayOrderChange}
                    onPreferImageKindChange={onPreferImageKindChange}
                    onReviewCellFocus={onReviewCellFocus}
                  />
                  <MobilePlayerNumericField
                    cellId={getCellId(index, 2)}
                    error={errorPathSet.has(keyToPath(index, "rank"))}
                    field="rank"
                    focusImageKind="total_assets"
                    index={index}
                    originalValue={originalRow?.rank}
                    player={player}
                    registerCellRef={registerCellRef}
                    reviewItem={reviewItemByCellId.get(getCellId(index, 2))}
                    reviewed={reviewedCellIds.has(getCellId(index, 2))}
                    onPlayerCommit={handlePlayerNumericCommit}
                    onPreferImageKindChange={onPreferImageKindChange}
                    onReviewCellFocus={onReviewCellFocus}
                  />
                </div>
                <MobilePlayerNumericField
                  allowSign
                  cellId={getCellId(index, 3)}
                  error={errorPathSet.has(keyToPath(index, "totalAssetsManYen"))}
                  field="totalAssetsManYen"
                  focusImageKind="total_assets"
                  index={index}
                  originalValue={originalRow?.totalAssetsManYen}
                  player={player}
                  registerCellRef={registerCellRef}
                  reviewItem={reviewItemByCellId.get(getCellId(index, 3))}
                  reviewed={reviewedCellIds.has(getCellId(index, 3))}
                  onPlayerCommit={handlePlayerNumericCommit}
                  onPreferImageKindChange={onPreferImageKindChange}
                  onReviewCellFocus={onReviewCellFocus}
                />
                <MobilePlayerNumericField
                  allowSign
                  cellId={getCellId(index, 4)}
                  error={errorPathSet.has(keyToPath(index, "revenueManYen"))}
                  field="revenueManYen"
                  focusImageKind="revenue"
                  index={index}
                  originalValue={originalRow?.revenueManYen}
                  player={player}
                  registerCellRef={registerCellRef}
                  reviewItem={reviewItemByCellId.get(getCellId(index, 4))}
                  reviewed={reviewedCellIds.has(getCellId(index, 4))}
                  onPlayerCommit={handlePlayerNumericCommit}
                  onPreferImageKindChange={onPreferImageKindChange}
                  onReviewCellFocus={onReviewCellFocus}
                />
                <div className="grid grid-cols-2 gap-2">
                  {incidentScoreGridColumns.map((column, incidentIndex) => (
                    <label
                      key={column.incidentKey}
                      className="grid gap-1 text-xs text-[var(--color-text-secondary)]"
                      htmlFor={getCellId(index, incidentIndex + 5)}
                    >
                      {column.header}
                      <ScoreGridNumericEditor
                        allowSign={false}
                        ariaLabel={`${memberDisplayName(player.memberId)} ${column.header}`}
                        cellId={getCellId(index, incidentIndex + 5)}
                        commitKind="incident"
                        error={errorPathSet.has(keyToPath(index, `incident.${column.incidentKey}`))}
                        focusImageKind="incident_log"
                        incidentKey={column.incidentKey}
                        originalValue={originalByOrder?.incidents[column.header]}
                        registerCellRef={registerCellRef}
                        reviewField={`incident.${column.incidentKey}`}
                        reviewed={reviewedCellIds.has(getCellId(index, incidentIndex + 5))}
                        reviewMessage={
                          reviewItemByCellId.get(getCellId(index, incidentIndex + 5))?.message
                        }
                        row={index}
                        showStateLabel
                        validationPath={keyToPath(index, `incident.${column.incidentKey}`)}
                        value={player.incidents[column.incidentKey]}
                        onIncidentCommit={handleIncidentNumericCommit}
                        onPreferImageKindChange={onPreferImageKindChange}
                        onReviewCellFocus={onReviewCellFocus}
                      />
                    </label>
                  ))}
                </div>
              </div>
            </Disclosure>
          </article>
        );
      })}
    </div>
  );
}

import { AnimatePresence, motion } from "motion/react";
import type { CSSProperties } from "react";

import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import type { ReviewItem } from "@/features/matches/workspace/review/reviewProgress";
import {
  incidentScoreGridColumns,
  keyToPath,
  memberSelectClass,
  playerFieldLabels,
  playerSlotKey,
  selectShortClass,
  textNumericClass,
  textNumericShortClass,
} from "@/features/matches/workspace/scoreGrid/ScoreGridColumns";
import { ScoreGridNumericEditor } from "@/features/matches/workspace/scoreGrid/ScoreGridNumericEditor";
import {
  ScoreGridSelectStatus,
  selectCellTone,
} from "@/features/matches/workspace/scoreGrid/ScoreGridSelectState";
import type {
  ScoreGridActions,
  ScoreGridCellRegistry,
  ScoreGridData,
  ScoreGridNumericHandlers,
} from "@/features/matches/workspace/scoreGrid/ScoreGridTypes";
import { fixedMembers, memberDisplayName } from "@/shared/domain/members";
import { cn } from "@/shared/ui/cn";
import { momoPanelTransition } from "@/shared/ui/motion/variants";

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
    <div className="mt-4 grid gap-3">
      {players.map((player, index) => {
        const originalRow = originalPlayers?.[index];
        const originalByOrder = originalByPlayOrder.get(player.playOrder);
        const unresolvedCount = review.items.filter(
          (item) => item.row === index && !reviewedCellIds.has(item.cellId),
        ).length;
        return (
          <article
            key={playerSlotKey(index)}
            className="rounded-[var(--radius-md)] border border-l-[3px] border-[var(--color-border)] border-l-[var(--player-accent)] bg-[var(--color-surface)] p-3"
            style={{ "--player-accent": `var(--color-player-${index + 1})` } as CSSProperties}
          >
            <button
              className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
              aria-controls={`mobile-player-${index}-fields`}
              aria-expanded={expandedMobilePlayer === index}
              type="button"
              onClick={() => onTogglePlayer(index)}
            >
              <span className="min-w-0">
                <span className="block truncate font-semibold text-[var(--color-text-primary)]">
                  {memberDisplayName(player.memberId)}
                </span>
                <span className="mt-0.5 block text-xs text-[var(--color-text-secondary)] tabular-nums">
                  {player.rank}位 ・ 総資産 {player.totalAssetsManYen.toLocaleString()}万円
                  {unresolvedCount > 0 ? ` ・ 未確認 ${unresolvedCount}` : ""}
                </span>
              </span>
              <span className="text-xs text-[var(--color-text-secondary)]">
                {expandedMobilePlayer === index ? "閉じる" : "詳細"}
              </span>
            </button>
            <AnimatePresence initial={false}>
              {expandedMobilePlayer === index ? (
                <motion.div
                  key="fields"
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-3 space-y-2"
                  exit={{ opacity: 0, y: -4 }}
                  id={`mobile-player-${index}-fields`}
                  initial={{ opacity: 0, y: 4 }}
                  transition={momoPanelTransition}
                >
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
                          baseClassName={textNumericShortClass}
                          cellId={getCellId(index, incidentIndex + 5)}
                          commitKind="incident"
                          error={errorPathSet.has(
                            keyToPath(index, `incident.${column.incidentKey}`),
                          )}
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
                </motion.div>
              ) : null}
            </AnimatePresence>
          </article>
        );
      })}
    </div>
  );
}

function MobileMemberSelect({
  cellId,
  index,
  memberId,
  onPreferImageKindChange,
  onPlayerChange,
  onReviewCellFocus,
  originalMemberId,
  registerCellRef,
  reviewItem,
  reviewed,
}: {
  cellId: string;
  index: number;
  memberId: MatchFormValues["players"][number]["memberId"];
  onPreferImageKindChange?: ScoreGridActions["onPreferImageKindChange"];
  onPlayerChange: ScoreGridActions["onPlayerChange"];
  onReviewCellFocus: ScoreGridActions["onReviewCellFocus"];
  originalMemberId: string | undefined;
  registerCellRef: ScoreGridCellRegistry["registerCellRef"];
  reviewItem: ReviewItem | undefined;
  reviewed: boolean;
}) {
  const changed = Boolean(originalMemberId && originalMemberId !== memberId);
  return (
    <label className="grid gap-1 text-xs text-[var(--color-text-secondary)]">
      メンバー
      <select
        ref={(node) => registerCellRef(cellId, node)}
        aria-describedby={reviewItem ? `${cellId}-review-status` : undefined}
        className={cn(memberSelectClass, selectCellTone({ changed, reviewItem, reviewed }))}
        data-validation-path={keyToPath(index, "memberId")}
        value={memberId}
        onChange={(event) => {
          onPlayerChange(index, {
            memberId: event.target.value as MatchFormValues["players"][number]["memberId"],
          });
        }}
        onFocus={() => {
          onPreferImageKindChange?.("total_assets");
          onReviewCellFocus(index, "memberId");
        }}
      >
        {fixedMembers.map((member) => (
          <option key={member.memberId} value={member.memberId}>
            {member.displayName}
          </option>
        ))}
      </select>
      <ScoreGridSelectStatus
        cellId={cellId}
        changed={changed}
        reviewItem={reviewItem}
        reviewed={reviewed}
      />
    </label>
  );
}

function MobilePlayOrderSelect({
  cellId,
  error,
  index,
  onPlayOrderChange,
  onPreferImageKindChange,
  onReviewCellFocus,
  originalPlayOrder,
  playOrder,
  registerCellRef,
  reviewItem,
  reviewed,
  synced,
}: {
  cellId: string;
  error: boolean;
  index: number;
  onPlayOrderChange: ScoreGridActions["onPlayOrderChange"];
  onPreferImageKindChange: ScoreGridActions["onPreferImageKindChange"];
  onReviewCellFocus: ScoreGridActions["onReviewCellFocus"];
  originalPlayOrder: number | undefined;
  playOrder: number;
  registerCellRef: ScoreGridCellRegistry["registerCellRef"];
  reviewItem: ReviewItem | undefined;
  reviewed: boolean;
  synced: boolean;
}) {
  const changed = Boolean(originalPlayOrder && originalPlayOrder !== playOrder);
  return (
    <label className="grid gap-1 text-xs text-[var(--color-text-secondary)]">
      プレー順
      <select
        ref={(node) => registerCellRef(cellId, node)}
        aria-describedby={reviewItem ? `${cellId}-review-status` : undefined}
        className={cn(selectShortClass, selectCellTone({ changed, error, reviewItem, reviewed }))}
        data-validation-path={keyToPath(index, "playOrder")}
        value={Number.isFinite(playOrder) ? String(playOrder) : ""}
        onChange={(event) => onPlayOrderChange(index, Number.parseInt(event.target.value, 10))}
        onFocus={() => {
          onPreferImageKindChange?.("incident_log");
          onReviewCellFocus(index, "playOrder");
        }}
      >
        <option value="">-</option>
        {[1, 2, 3, 4].map((order) => (
          <option key={order} value={order}>
            {order}
          </option>
        ))}
      </select>
      <ScoreGridSelectStatus
        cellId={cellId}
        changed={changed}
        reviewItem={reviewItem}
        reviewed={reviewed}
        synced={synced}
      />
    </label>
  );
}

function MobilePlayerNumericField({
  allowSign = false,
  cellId,
  error,
  field,
  focusImageKind,
  index,
  onPlayerCommit,
  onPreferImageKindChange,
  onReviewCellFocus,
  originalValue,
  player,
  registerCellRef,
  reviewItem,
  reviewed,
}: {
  allowSign?: boolean;
  cellId: string;
  error: boolean;
  field: keyof typeof playerFieldLabels;
  focusImageKind?: "incident_log" | "revenue" | "total_assets";
  index: number;
  onPlayerCommit: ScoreGridNumericHandlers["handlePlayerNumericCommit"];
  onPreferImageKindChange?: ScoreGridActions["onPreferImageKindChange"];
  onReviewCellFocus: ScoreGridActions["onReviewCellFocus"];
  originalValue: number | undefined;
  player: MatchFormValues["players"][number];
  registerCellRef: ScoreGridCellRegistry["registerCellRef"];
  reviewItem: ReviewItem | undefined;
  reviewed: boolean;
}) {
  const baseClassName = field === "rank" ? textNumericShortClass : textNumericClass;
  return (
    <label className="grid gap-1 text-xs text-[var(--color-text-secondary)]" htmlFor={cellId}>
      {playerFieldLabels[field]}
      <ScoreGridNumericEditor
        allowSign={allowSign}
        ariaLabel={`${memberDisplayName(player.memberId)} ${playerFieldLabels[field]}`}
        baseClassName={baseClassName}
        cellId={cellId}
        commitKind="player"
        error={error}
        field={field}
        focusImageKind={focusImageKind}
        originalValue={originalValue}
        registerCellRef={registerCellRef}
        reviewField={field}
        reviewed={reviewed}
        reviewMessage={reviewItem?.message}
        row={index}
        showStateLabel
        validationPath={keyToPath(index, field)}
        value={player[field]}
        onPlayerCommit={onPlayerCommit}
        onPreferImageKindChange={onPreferImageKindChange}
        onReviewCellFocus={onReviewCellFocus}
      />
    </label>
  );
}

import { AnimatePresence, motion } from "motion/react";

import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
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
import type {
  ScoreGridNumericHandlers,
  ScoreGridProps,
} from "@/features/matches/workspace/scoreGrid/ScoreGridTypes";
import { fixedMembers, memberDisplayName } from "@/shared/domain/members";
import { momoPanelTransition } from "@/shared/ui/motion/variants";

type ScoreGridMobileCardsProps = Pick<
  ScoreGridProps,
  | "errorPathSet"
  | "lastSyncedPlayerIndex"
  | "onPlayOrderChange"
  | "onPlayerChange"
  | "originalPlayers"
  | "players"
> &
  ScoreGridNumericHandlers & {
    expandedMobilePlayer: number;
    onPreferImageKindChange?: ScoreGridProps["onPreferImageKindChange"] | undefined;
    onTogglePlayer: (index: number) => void;
  };

export function ScoreGridMobileCards({
  errorPathSet,
  expandedMobilePlayer,
  handleIncidentNumericCommit,
  handlePlayerNumericCommit,
  lastSyncedPlayerIndex,
  onPlayerChange,
  onPlayOrderChange,
  onPreferImageKindChange,
  onTogglePlayer,
  originalPlayers,
  players,
}: ScoreGridMobileCardsProps) {
  const originalByPlayOrder = new Map(originalPlayers?.map((player) => [player.playOrder, player]));
  return (
    <div className="mt-4 grid gap-3">
      {players.map((player, index) => {
        const originalRow = originalPlayers?.[index];
        const originalByOrder = originalByPlayOrder.get(player.playOrder);
        return (
          <article
            key={playerSlotKey(index)}
            className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
          >
            <button
              className="flex w-full items-center justify-between text-left"
              aria-controls={`mobile-player-${index}-fields`}
              aria-expanded={expandedMobilePlayer === index}
              type="button"
              onClick={() => onTogglePlayer(index)}
            >
              <span className="font-semibold text-[var(--color-text-primary)]">
                {memberDisplayName(player.memberId)}
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
                    index={index}
                    memberId={player.memberId}
                    onPlayerChange={onPlayerChange}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <MobilePlayOrderSelect
                      error={errorPathSet.has(keyToPath(index, "playOrder"))}
                      index={index}
                      playOrder={player.playOrder}
                      onPlayOrderChange={onPlayOrderChange}
                      onPreferImageKindChange={onPreferImageKindChange}
                    />
                    <MobilePlayerNumericField
                      error={errorPathSet.has(keyToPath(index, "rank"))}
                      field="rank"
                      index={index}
                      originalValue={originalRow?.rank}
                      player={player}
                      onPlayerCommit={handlePlayerNumericCommit}
                    />
                  </div>
                  <MobilePlayerNumericField
                    allowSign
                    error={errorPathSet.has(keyToPath(index, "totalAssetsManYen"))}
                    field="totalAssetsManYen"
                    focusImageKind="total_assets"
                    index={index}
                    originalValue={originalRow?.totalAssetsManYen}
                    player={player}
                    onPlayerCommit={handlePlayerNumericCommit}
                    onPreferImageKindChange={onPreferImageKindChange}
                  />
                  <MobilePlayerNumericField
                    allowSign
                    error={errorPathSet.has(keyToPath(index, "revenueManYen"))}
                    field="revenueManYen"
                    focusImageKind="revenue"
                    index={index}
                    originalValue={originalRow?.revenueManYen}
                    player={player}
                    onPlayerCommit={handlePlayerNumericCommit}
                    onPreferImageKindChange={onPreferImageKindChange}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    {incidentScoreGridColumns.map((column) => (
                      <label
                        key={column.incidentKey}
                        className="grid gap-1 text-xs text-[var(--color-text-secondary)]"
                        htmlFor={`mobile-${index}-${column.incidentKey}`}
                      >
                        {column.header}
                        <ScoreGridNumericEditor
                          allowSign={false}
                          ariaLabel={`${memberDisplayName(player.memberId)} ${column.header}`}
                          baseClassName={textNumericShortClass}
                          cellId={`mobile-${index}-${column.incidentKey}`}
                          commitKind="incident"
                          error={errorPathSet.has(
                            keyToPath(index, `incident.${column.incidentKey}`),
                          )}
                          focusImageKind="incident_log"
                          incidentKey={column.incidentKey}
                          originalValue={originalByOrder?.incidents[column.header]}
                          row={index}
                          showStateLabel
                          synced={lastSyncedPlayerIndex === index}
                          value={player.incidents[column.incidentKey]}
                          onIncidentCommit={handleIncidentNumericCommit}
                          onPreferImageKindChange={onPreferImageKindChange}
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
  index,
  memberId,
  onPlayerChange,
}: {
  index: number;
  memberId: MatchFormValues["players"][number]["memberId"];
  onPlayerChange: ScoreGridProps["onPlayerChange"];
}) {
  return (
    <label className="grid gap-1 text-xs text-[var(--color-text-secondary)]">
      メンバー
      <select
        className={memberSelectClass}
        value={memberId}
        onChange={(event) => {
          onPlayerChange(index, {
            memberId: event.target.value as MatchFormValues["players"][number]["memberId"],
          });
        }}
      >
        {fixedMembers.map((member) => (
          <option key={member.memberId} value={member.memberId}>
            {member.displayName}
          </option>
        ))}
      </select>
    </label>
  );
}

function MobilePlayOrderSelect({
  error,
  index,
  onPlayOrderChange,
  onPreferImageKindChange,
  playOrder,
}: {
  error: boolean;
  index: number;
  onPlayOrderChange: ScoreGridProps["onPlayOrderChange"];
  onPreferImageKindChange: ScoreGridProps["onPreferImageKindChange"];
  playOrder: number;
}) {
  return (
    <label className="grid gap-1 text-xs text-[var(--color-text-secondary)]">
      プレー順
      <select
        className={`${selectShortClass} ${
          error ? "border-[var(--color-danger)]/65 bg-[var(--color-danger)]/10" : ""
        }`}
        value={Number.isFinite(playOrder) ? String(playOrder) : ""}
        onChange={(event) => onPlayOrderChange(index, Number.parseInt(event.target.value, 10))}
        onFocus={() => onPreferImageKindChange?.("incident_log")}
      >
        <option value="">-</option>
        {[1, 2, 3, 4].map((order) => (
          <option key={order} value={order}>
            {order}
          </option>
        ))}
      </select>
    </label>
  );
}

function MobilePlayerNumericField({
  allowSign = false,
  error,
  field,
  focusImageKind,
  index,
  onPlayerCommit,
  onPreferImageKindChange,
  originalValue,
  player,
}: {
  allowSign?: boolean;
  error: boolean;
  field: keyof typeof playerFieldLabels;
  focusImageKind?: "incident_log" | "revenue" | "total_assets";
  index: number;
  onPlayerCommit: ScoreGridNumericHandlers["handlePlayerNumericCommit"];
  onPreferImageKindChange?: ScoreGridProps["onPreferImageKindChange"];
  originalValue: number | undefined;
  player: MatchFormValues["players"][number];
}) {
  const baseClassName = field === "rank" ? textNumericShortClass : textNumericClass;
  return (
    <label
      className="grid gap-1 text-xs text-[var(--color-text-secondary)]"
      htmlFor={`mobile-${index}-${field}`}
    >
      {playerFieldLabels[field]}
      <ScoreGridNumericEditor
        allowSign={allowSign}
        ariaLabel={`${memberDisplayName(player.memberId)} ${playerFieldLabels[field]}`}
        baseClassName={baseClassName}
        cellId={`mobile-${index}-${field}`}
        commitKind="player"
        error={error}
        field={field}
        focusImageKind={focusImageKind}
        originalValue={originalValue}
        row={index}
        showStateLabel
        value={player[field]}
        onPlayerCommit={onPlayerCommit}
        onPreferImageKindChange={onPreferImageKindChange}
      />
    </label>
  );
}

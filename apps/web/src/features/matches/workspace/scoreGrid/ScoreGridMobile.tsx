import { memo } from "react";

import type {
  MatchWorkspaceScoreRowView,
  WorkspaceReadView,
} from "@/features/matches/workspace/matchWorkspaceEditingStore";
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
import { useWorkspaceReadView } from "@/features/matches/workspace/useWorkspaceReadView";
import { memberDisplayName } from "@/shared/domain/members";
import { PlayOrderMark } from "@/shared/matches/PlayOrderMark";
import { RankBadge } from "@/shared/matches/RankBadge";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { contentText, fieldText } from "@/shared/ui/typography";

type ScoreGridMobileCardsProps = Pick<ScoreGridData, "rows" | "errorPathSet"> &
  ScoreGridCellRegistry &
  ScoreGridNumericHandlers & {
    expandedMobilePlayer: number;
    onNumericDraftChange: ScoreGridActions["onNumericDraftChange"];
    onPlayerChange: ScoreGridActions["onPlayerChange"];
    onPlayOrderChange: ScoreGridActions["onPlayOrderChange"];
    onPreferImageKindChange?: ScoreGridActions["onPreferImageKindChange"] | undefined;
    onReviewCellFocus: ScoreGridActions["onReviewCellFocus"];
    onTogglePlayer: (index: number) => void;
  };

export function ScoreGridMobileCards({ rows, ...props }: ScoreGridMobileCardsProps) {
  return (
    <div className="grid gap-4">
      {rows.map((row, index) => (
        <ScoreGridMobileRow {...props} key={playerSlotKey(index)} row={row} index={index} />
      ))}
    </div>
  );
}

const ScoreGridMobileRow = memo(function ScoreGridMobileRow({
  row,
  index,
  errorPathSet,
  expandedMobilePlayer,
  getCellId,
  handleIncidentNumericCommit,
  handlePlayerNumericCommit,
  onNumericDraftChange,
  onPlayerChange,
  onPlayOrderChange,
  onPreferImageKindChange,
  onReviewCellFocus,
  onTogglePlayer,
  registerCellRef,
}: Omit<ScoreGridMobileCardsProps, "rows"> & {
  row: WorkspaceReadView<MatchWorkspaceScoreRowView>;
  index: number;
}) {
  const {
    player,
    originalPlayer: originalRow,
    originalByOrder,
    numericDrafts,
    items,
    acknowledgedCellIds,
    synced,
  } = useWorkspaceReadView(row);
  const reviewItemByCellId = new Map(items.map((item) => [item.cellId, item]));
  const reviewedCellIds = new Set(acknowledgedCellIds);
  const unresolvedCount = items.filter((item) => !reviewedCellIds.has(item.cellId)).length;
  return (
    <article className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <Disclosure
        open={expandedMobilePlayer === index}
        panelSpacing="md"
        summary={
          <span className="flex min-w-0 items-center justify-between gap-3">
            <span className="min-w-0">
              <span className={cn(contentText.body, "block truncate")}>
                {memberDisplayName(player.memberId)}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-secondary)] tabular-nums">
                <PlayOrderMark playOrder={player.playOrder} />
                <RankBadge rank={player.rank} />
                <span className={contentText.compactPrimary}>
                  総資産 {player.totalAssetsManYen.toLocaleString()}万円
                </span>
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
        <div className="grid gap-3">
          <div className="grid gap-2">
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
                synced={synced}
                onPlayOrderChange={onPlayOrderChange}
                onPreferImageKindChange={onPreferImageKindChange}
                onReviewCellFocus={onReviewCellFocus}
              />
              <MobilePlayerNumericField
                cellId={getCellId(index, 2)}
                error={errorPathSet.has(keyToPath(index, "rank"))}
                draftValue={numericDrafts[keyToPath(index, "rank")]}
                onDraftChange={onNumericDraftChange}
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
          </div>
          <div className="grid gap-2">
            <MobilePlayerNumericField
              allowSign
              cellId={getCellId(index, 3)}
              error={errorPathSet.has(keyToPath(index, "totalAssetsManYen"))}
              draftValue={numericDrafts[keyToPath(index, "totalAssetsManYen")]}
              onDraftChange={onNumericDraftChange}
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
              draftValue={numericDrafts[keyToPath(index, "revenueManYen")]}
              onDraftChange={onNumericDraftChange}
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
          </div>
          <div className="grid grid-cols-2 gap-2">
            {incidentScoreGridColumns.map((column, incidentIndex) => (
              <label
                key={column.incidentKey}
                className={cn(fieldText.label, "grid")}
                htmlFor={getCellId(index, incidentIndex + 5)}
              >
                <span className="mb-2">{column.header}</span>
                <ScoreGridNumericEditor
                  allowSign={false}
                  ariaLabel={`${memberDisplayName(player.memberId)} ${column.header}`}
                  cellId={getCellId(index, incidentIndex + 5)}
                  commitKind="incident"
                  draftValue={numericDrafts[keyToPath(index, `incident.${column.incidentKey}`)]}
                  onDraftChange={onNumericDraftChange}
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
});

import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import type { ReviewItem } from "@/features/matches/workspace/review/reviewProgress";
import {
  keyToPath,
  memberSelectClass,
  playerFieldLabels,
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
  ScoreGridNumericHandlers,
} from "@/features/matches/workspace/scoreGrid/ScoreGridTypes";
import { fixedMembers, memberDisplayName } from "@/shared/domain/members";
import { cn } from "@/shared/ui/cn";

export function MobileMemberSelect({
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

export function MobilePlayOrderSelect({
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

export function MobilePlayerNumericField({
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

import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import type { ReviewItem } from "@/features/matches/workspace/review/reviewProgress";
import {
  keyToPath,
  playerFieldLabels,
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
import { canonicalResultMembers, memberDisplayName } from "@/shared/domain/members";
import { SelectControl } from "@/shared/ui/forms/Control";

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
    <label className="grid min-w-[10rem] text-xs text-[var(--color-text-secondary)]">
      <span className="mb-2">メンバー</span>
      <SelectControl
        ref={(node) => registerCellRef(cellId, node)}
        aria-describedby={reviewItem ? `${cellId}-review-status` : undefined}
        data-validation-path={keyToPath(index, "memberId")}
        density="compact"
        tone={selectCellTone({ changed, reviewItem, reviewed })}
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
        {canonicalResultMembers.map((member) => (
          <option key={member.memberId} value={member.memberId}>
            {member.displayName}
          </option>
        ))}
      </SelectControl>
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
    <label className="grid min-w-[6ch] text-xs text-[var(--color-text-secondary)]">
      <span className="mb-2">プレー順</span>
      <SelectControl
        ref={(node) => registerCellRef(cellId, node)}
        aria-describedby={error || reviewItem ? `${cellId}-review-status` : undefined}
        data-validation-path={keyToPath(index, "playOrder")}
        density="compact"
        invalid={error}
        textAlign="center"
        tone={selectCellTone({ changed, reviewItem, reviewed })}
        value={Number.isFinite(playOrder) ? String(playOrder) : ""}
        onChange={(event) => onPlayOrderChange(index, Math.trunc(Number(event.target.value)))}
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
      </SelectControl>
      <ScoreGridSelectStatus
        cellId={cellId}
        changed={changed}
        error={error}
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
  return (
    <label className="grid text-xs text-[var(--color-text-secondary)]" htmlFor={cellId}>
      <span className="mb-2">{playerFieldLabels[field]}</span>
      <ScoreGridNumericEditor
        allowSign={allowSign}
        ariaLabel={`${memberDisplayName(player.memberId)} ${playerFieldLabels[field]}`}
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

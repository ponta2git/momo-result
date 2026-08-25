import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import type { ReviewItem } from "@/features/matches/workspace/review/reviewProgress";
import {
  keyToPath,
  playerFieldLabels,
} from "@/features/matches/workspace/scoreGrid/ScoreGridColumns";
import { ScoreGridNumericEditor } from "@/features/matches/workspace/scoreGrid/ScoreGridNumericEditor";
import type {
  ScoreGridActions,
  ScoreGridCellRegistry,
  ScoreGridKeyboardHandler,
  ScoreGridNumericHandlers,
} from "@/features/matches/workspace/scoreGrid/ScoreGridTypes";
import { memberDisplayName } from "@/shared/domain/members";

type PlayerNumericDesktopCellProps = ScoreGridCellRegistry &
  Pick<ScoreGridNumericHandlers, "handlePlayerNumericCommit"> & {
    allowSign?: boolean;
    col: number;
    error: boolean;
    field: keyof typeof playerFieldLabels;
    focusImageKind?: "incident_log" | "revenue" | "total_assets";
    handleKeyboard: ScoreGridKeyboardHandler;
    onPreferImageKindChange?: ScoreGridActions["onPreferImageKindChange"] | undefined;
    onReviewCellFocus: ScoreGridActions["onReviewCellFocus"];
    originalValue: number | undefined;
    player: MatchFormValues["players"][number];
    rowIndex: number;
    reviewItem: ReviewItem | undefined;
    reviewed: boolean;
  };

export function PlayerNumericDesktopCell({
  allowSign = false,
  col,
  error,
  field,
  focusImageKind,
  getCellId,
  handleKeyboard,
  handlePlayerNumericCommit,
  onPreferImageKindChange,
  onReviewCellFocus,
  originalValue,
  player,
  registerCellRef,
  rowIndex,
  reviewItem,
  reviewed,
}: PlayerNumericDesktopCellProps) {
  return (
    <td className="px-2 py-3 align-top">
      <ScoreGridNumericEditor
        allowSign={allowSign}
        ariaLabel={`${memberDisplayName(player.memberId)} ${playerFieldLabels[field]}`}
        cellId={getCellId(rowIndex, col)}
        col={col}
        commitKind="player"
        error={error}
        field={field}
        focusImageKind={focusImageKind}
        originalValue={originalValue}
        registerCellRef={registerCellRef}
        reviewField={field}
        reviewed={reviewed}
        reviewMessage={reviewItem?.message}
        row={rowIndex}
        showStateLabel
        validationPath={keyToPath(rowIndex, field)}
        value={player[field]}
        onKeyboard={handleKeyboard}
        onPlayerCommit={handlePlayerNumericCommit}
        onPreferImageKindChange={onPreferImageKindChange}
        onReviewCellFocus={onReviewCellFocus}
      />
    </td>
  );
}

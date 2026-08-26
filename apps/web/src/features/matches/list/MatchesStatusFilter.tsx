import type {
  MatchListStatusFilter,
  MatchListSummaryCounts,
} from "@/features/matches/list/matchListTypes";
import { Button } from "@/shared/ui/actions/Button";
import { SelectField } from "@/shared/ui/forms/SelectField";

type MatchesStatusFilterProps = {
  counts?: MatchListSummaryCounts | undefined;
  currentStatus: MatchListStatusFilter;
  disabled?: boolean | undefined;
  loading?: boolean | undefined;
  masked?: boolean | undefined;
  unavailable?: boolean | undefined;
  onRetry?: (() => void) | undefined;
  onSelectStatus: (status: MatchListStatusFilter) => void;
};

type StatusOption = {
  countKey?: keyof MatchListSummaryCounts;
  label: string;
  value: MatchListStatusFilter;
};

const statusOptions: StatusOption[] = [
  { label: "すべて", value: "all" },
  { countKey: "incompleteCount", label: "未確定すべて", value: "incomplete" },
  { countKey: "ocrRunningCount", label: "処理中", value: "ocr_running" },
  { countKey: "preConfirmCount", label: "対応待ち", value: "pre_confirm" },
  { countKey: "needsReviewCount", label: "要確認のみ", value: "needs_review" },
  { label: "確定済", value: "confirmed" },
];

function optionLabel(option: StatusOption, counts: MatchListSummaryCounts | undefined) {
  const count = option.countKey && counts ? counts[option.countKey] : undefined;
  return count === undefined ? option.label : `${option.label}（${count.toLocaleString()}件）`;
}

/**
 * Owns the match-list status vocabulary and count availability while delegating the
 * accessible single-choice control to the shared field primitive.
 */
export function MatchesStatusFilter({
  counts,
  currentStatus,
  disabled = false,
  loading = false,
  masked = false,
  unavailable = false,
  onRetry,
  onSelectStatus,
}: MatchesStatusFilterProps) {
  const visibleCounts = masked ? undefined : counts;
  const checkingCounts = loading || masked;

  return (
    <div className="grid min-w-0 gap-2">
      <SelectField
        description={checkingCounts ? "内訳の件数を確認中です。" : undefined}
        disabled={disabled}
        label="確定状況"
        options={statusOptions.map((option) => ({
          label: optionLabel(option, visibleCounts),
          value: option.value,
        }))}
        value={currentStatus}
        onChange={(event) => onSelectStatus(event.currentTarget.value as MatchListStatusFilter)}
      />

      {unavailable ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-text-secondary)]">
          <p role="status">内訳の件数を取得できません。確定状況の絞り込みは利用できます。</p>
          {onRetry ? (
            <Button size="sm" variant="quiet" onClick={onRetry}>
              件数を再取得
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

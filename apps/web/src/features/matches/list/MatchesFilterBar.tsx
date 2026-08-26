import { Filter } from "lucide-react";
import { useState } from "react";

import {
  describeMatchListDetailFilters,
  MatchesListFilters,
} from "@/features/matches/list/MatchesListFilters";
import { MatchesStatusFilter } from "@/features/matches/list/MatchesStatusFilter";
import type {
  MatchListFilterActions,
  MatchListFilterCandidates,
  MatchListFilterSelectionErrors,
  MatchListSearch,
  MatchListSort,
  MatchListStatusFilter,
  MatchListSummaryCounts,
} from "@/features/matches/list/matchListTypes";
import { Button } from "@/shared/ui/actions/Button";
import { FilterBar } from "@/shared/ui/forms/FilterBar";
import { SelectField } from "@/shared/ui/forms/SelectField";

type MatchesFilterBarProps = {
  actions: MatchListFilterActions;
  candidates: MatchListFilterCandidates;
  counts?: MatchListSummaryCounts | undefined;
  onRetrySummary?: (() => void) | undefined;
  pending?: boolean | undefined;
  search: MatchListSearch;
  selectionErrors?: MatchListFilterSelectionErrors | undefined;
  summaryError?: boolean | undefined;
  summaryLoading?: boolean | undefined;
  summaryMasked?: boolean | undefined;
};

const sortOptions: Array<{ label: string; value: MatchListSort }> = [
  { label: "開催が新しい順", value: "held_desc" },
  { label: "開催が古い順", value: "held_asc" },
  { label: "更新が新しい順", value: "updated_desc" },
  { label: "未確定を優先", value: "status_priority" },
  { label: "試合番号順", value: "match_no_asc" },
];

const statusLabels = {
  all: "すべて",
  confirmed: "確定済",
  incomplete: "未確定すべて",
  needs_review: "要確認のみ",
  ocr_running: "処理中",
  pre_confirm: "対応待ち",
} satisfies Record<MatchListStatusFilter, string>;

export function MatchesFilterBar({
  actions,
  candidates,
  counts,
  onRetrySummary,
  pending = false,
  search,
  selectionErrors,
  summaryError = false,
  summaryLoading = false,
  summaryMasked = false,
}: MatchesFilterBarProps) {
  const detailLabels = describeMatchListDetailFilters(candidates, search);
  const hasDetailFilters = detailLabels.length > 0;
  const hasResettableFilters =
    hasDetailFilters || search.status !== "all" || search.sort !== "held_desc";
  const [detailOpen, setDetailOpen] = useState(hasDetailFilters);
  const disabled = pending;
  const sortLabel =
    sortOptions.find((option) => option.value === search.sort)?.label ?? search.sort;
  const activeLabels = [
    search.status === "all" ? undefined : `確定状況 ${statusLabels[search.status]}`,
    search.sort === "held_desc" ? undefined : `並び順 ${sortLabel}`,
    ...detailLabels,
  ].filter((label): label is string => label !== undefined);

  function patchSearch(patch: Partial<MatchListSearch>) {
    actions.onApply({ ...search, ...patch, cursor: "" });
  }

  return (
    <FilterBar
      activeSummary={
        activeLabels.length > 0 ? (
          <p>
            <span className="font-semibold text-[var(--color-text-primary)]">適用中: </span>
            {activeLabels.join("・")}
          </p>
        ) : undefined
      }
      ariaLabel="試合の表示条件"
      busy={pending || summaryLoading || summaryMasked}
      details={{
        controls: (
          <MatchesListFilters
            actions={actions}
            candidates={candidates}
            pending={disabled}
            search={search}
            selectionErrors={selectionErrors}
          />
        ),
        label: (
          <span className="inline-flex items-center gap-2">
            <Filter aria-hidden="true" className="size-4 shrink-0" />
            詳細条件
          </span>
        ),
        onOpenChange: setDetailOpen,
        open: detailOpen,
        panelClassName: "md:grid-cols-3 md:items-end",
        summary: detailLabels.length > 0 ? detailLabels.join("・") : undefined,
      }}
      primary={
        <div className="grid min-w-0 gap-4 md:grid-cols-2 md:items-start">
          <MatchesStatusFilter
            counts={counts}
            currentStatus={search.status}
            disabled={disabled}
            loading={summaryLoading}
            masked={summaryMasked}
            unavailable={summaryError}
            onRetry={onRetrySummary}
            onSelectStatus={(status) => patchSearch({ status })}
          />
          <div className="min-w-0">
            <SelectField
              disabled={disabled}
              label="並び順"
              options={sortOptions}
              value={search.sort}
              onChange={(event) =>
                patchSearch({ sort: event.currentTarget.value as MatchListSort })
              }
            />
          </div>
        </div>
      }
      resetAction={
        hasResettableFilters ? (
          <Button
            aria-label="確定状況・並び順・詳細条件を初期状態に戻す"
            disabled={disabled}
            size="sm"
            variant="quiet"
            onClick={actions.onClear}
          >
            表示条件をリセット
          </Button>
        ) : undefined
      }
    />
  );
}

import { Filter } from "lucide-react";
import { useState } from "react";

import {
  HeldEventListMemoField,
  HeldEventListMetricFields,
  HeldEventListMinMatchCountField,
} from "@/features/heldEvents/list/HeldEventListConditionFields";
import { isCompleteHeldEventListMetric } from "@/features/heldEvents/list/heldEventListConditions";
import type {
  HeldEventListFilterActions,
  HeldEventListFilterCandidates,
  HeldEventListMetricCondition,
  HeldEventListSearch,
} from "@/features/heldEvents/list/heldEventListTypes";
import { useCommittedDraft } from "@/shared/lib/useCommittedDraft";
import { normalizeMatchNoteQuery, searchPeriodError } from "@/shared/matches/matchSearchConditions";
import { MatchSearchScopeFields, SearchPeriodFields } from "@/shared/matches/MatchSearchFields";
import { Button } from "@/shared/ui/actions/Button";
import { FilterBar } from "@/shared/ui/forms/FilterBar";

type HeldEventsFilterBarProps = {
  actions: HeldEventListFilterActions;
  candidates: HeldEventListFilterCandidates;
  hasConditions: boolean;
  pending?: boolean | undefined;
  search: HeldEventListSearch;
};

const metricSignature = (condition: HeldEventListMetricCondition) => JSON.stringify(condition);

export function HeldEventsFilterBar({
  actions,
  candidates,
  hasConditions,
  pending = false,
  search,
}: HeldEventsFilterBarProps) {
  const hasDetailConditions =
    search.from !== "" ||
    search.to !== "" ||
    search.minMatchCount > 0 ||
    search.q !== "" ||
    isCompleteHeldEventListMetric(search.metric);
  const [detailOpen, setDetailOpen] = useState(hasDetailConditions);
  const [period, setPeriod] = useCommittedDraft(
    { from: search.from, to: search.to },
    (value) => `${value.from}~${value.to}`,
  );
  const [memo, setMemo] = useCommittedDraft(search.q, (value) => value);
  const [metric, setMetric] = useCommittedDraft(search.metric, metricSignature);

  const commitMemo = () => {
    const q = normalizeMatchNoteQuery(memo);
    if (q !== search.q) actions.onChange({ kind: "memo", q });
  };
  const commitMetric = (condition: HeldEventListMetricCondition) => {
    const cleared = condition.metric === "" && condition.value.trim() === "";
    if (cleared && !isCompleteHeldEventListMetric(search.metric)) return;
    if (!cleared && !isCompleteHeldEventListMetric(condition)) return;
    if (metricSignature(condition) !== metricSignature(search.metric)) {
      actions.onChange({ kind: "metric", metric: condition });
    }
  };

  return (
    <FilterBar
      ariaLabel="開催の検索条件"
      busy={pending}
      details={{
        columns: 1,
        controls: (
          <div className="grid min-w-0 gap-5">
            <div className="flex min-w-0 flex-wrap items-start gap-4">
              <SearchPeriodFields
                from={period.from}
                to={period.to}
                onChange={(next) => {
                  setPeriod(next);
                  if (!searchPeriodError(next.from, next.to)) {
                    actions.onChange({ kind: "period", ...next });
                  }
                }}
              />
              <div className="w-40 min-w-0">
                <HeldEventListMinMatchCountField
                  value={search.minMatchCount}
                  onChange={(minMatchCount) =>
                    actions.onChange({ kind: "matchCount", minMatchCount })
                  }
                />
              </div>
            </div>
            <div className="w-full max-w-[34rem] min-w-0">
              <HeldEventListMemoField value={memo} onChange={setMemo} onCommit={commitMemo} />
            </div>
            <HeldEventListMetricFields
              value={metric}
              onChange={setMetric}
              onCommit={commitMetric}
            />
          </div>
        ),
        label: (
          <span className="inline-flex items-center gap-2">
            <Filter aria-hidden="true" className="size-4 shrink-0" />
            詳細条件
          </span>
        ),
        onOpenChange: setDetailOpen,
        open: detailOpen,
      }}
      primary={
        <div className="grid min-w-0 grid-cols-4 items-start gap-4">
          <MatchSearchScopeFields
            candidates={candidates}
            gameTitleId={search.gameTitleId}
            mapMasterId={search.mapMasterId}
            seasonMasterId={search.seasonMasterId}
            sort={search.sort}
            onGameTitleChange={(gameTitleId) =>
              actions.onChange({ kind: "gameTitle", gameTitleId })
            }
            onMapChange={(mapMasterId) => actions.onChange({ kind: "map", mapMasterId })}
            onSeasonChange={(seasonMasterId) =>
              actions.onChange({ kind: "season", seasonMasterId })
            }
            onSortChange={(sort) => actions.onChange({ kind: "sort", sort })}
          />
        </div>
      }
      resetAction={
        hasConditions ? (
          <Button size="sm" variant="quiet" onClick={actions.onClear}>
            条件をすべて解除
          </Button>
        ) : undefined
      }
    />
  );
}

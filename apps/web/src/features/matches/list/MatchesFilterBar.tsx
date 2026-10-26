import { Filter } from "lucide-react";
import { useState } from "react";

import {
  MatchListHeldEventField,
  MatchListMemoField,
  MatchListPeriodFields,
  MatchListRecordFields,
  MatchListScopeFields,
} from "@/features/matches/list/MatchListConditionFields";
import {
  isCompleteMatchListRecord,
  matchListPeriodError,
} from "@/features/matches/list/matchListConditions";
import { normalizeMatchListMemoQuery } from "@/features/matches/list/matchListSearchParams";
import type {
  MatchListFilterActions,
  MatchListFilterCandidates,
  MatchListRecordCondition,
  MatchListSearch,
} from "@/features/matches/list/matchListTypes";
import { Button } from "@/shared/ui/actions/Button";
import { FilterBar } from "@/shared/ui/forms/FilterBar";

type MatchesFilterBarProps = {
  actions: MatchListFilterActions;
  candidates: MatchListFilterCandidates;
  hasConditions: boolean;
  pending?: boolean | undefined;
  search: MatchListSearch;
};

/**
 * Keeps an editable copy of a URL-owned value. A new committed value (chip removal, back/forward)
 * replaces the copy without remounting the input, so focus stays where the reader left it.
 */
function useCommittedDraft<T>(committed: T, signature: (value: T) => string) {
  const [state, setState] = useState({ committedKey: signature(committed), draft: committed });
  const committedKey = signature(committed);
  if (state.committedKey !== committedKey) {
    setState({ committedKey, draft: committed });
  }
  const draft = state.committedKey === committedKey ? state.draft : committed;
  return [draft, (next: T) => setState({ committedKey, draft: next })] as const;
}

const recordSignature = (condition: MatchListRecordCondition) => JSON.stringify(condition);

export function MatchesFilterBar({
  actions,
  candidates,
  hasConditions,
  pending = false,
  search,
}: MatchesFilterBarProps) {
  const hasDetailConditions =
    search.heldEventId !== "" ||
    search.from !== "" ||
    search.to !== "" ||
    search.q !== "" ||
    isCompleteMatchListRecord(search.record);
  const [detailOpen, setDetailOpen] = useState(hasDetailConditions);
  const [period, setPeriod] = useCommittedDraft(
    { from: search.from, to: search.to },
    (value) => `${value.from}~${value.to}`,
  );
  const [memo, setMemo] = useCommittedDraft(search.q, (value) => value);
  const [record, setRecord] = useCommittedDraft(search.record, recordSignature);

  const commitMemo = () => {
    const q = normalizeMatchListMemoQuery(memo);
    if (q !== search.q) actions.onChange({ kind: "memo", q });
  };
  const commitRecord = (condition: MatchListRecordCondition) => {
    const cleared = condition.record === "" && condition.value.trim() === "";
    if (cleared && !isCompleteMatchListRecord(search.record)) return;
    if (!cleared && !isCompleteMatchListRecord(condition)) return;
    if (recordSignature(condition) !== recordSignature(search.record)) {
      actions.onChange({ kind: "record", record: condition });
    }
  };

  return (
    <FilterBar
      ariaLabel="試合の検索条件"
      busy={pending}
      details={{
        columns: 1,
        controls: (
          <div className="grid min-w-0 gap-5">
            <div className="flex min-w-0 flex-wrap items-start gap-4">
              <div className="w-64 min-w-0">
                <MatchListHeldEventField
                  candidates={candidates}
                  value={search.heldEventId}
                  onChange={(heldEventId) => actions.onChange({ kind: "heldEvent", heldEventId })}
                />
              </div>
              <MatchListPeriodFields
                from={period.from}
                to={period.to}
                onChange={(next) => {
                  setPeriod(next);
                  if (!matchListPeriodError(next.from, next.to)) {
                    actions.onChange({ kind: "period", ...next });
                  }
                }}
              />
            </div>
            <div className="w-full max-w-[34rem] min-w-0">
              <MatchListMemoField value={memo} onChange={setMemo} onCommit={commitMemo} />
            </div>
            <MatchListRecordFields value={record} onChange={setRecord} onCommit={commitRecord} />
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
          <MatchListScopeFields
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

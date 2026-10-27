import { Filter } from "lucide-react";
import { useState } from "react";

import {
  MatchListHeldEventField,
  MatchListRecordFields,
} from "@/features/matches/list/MatchListConditionFields";
import { isCompleteMatchListRecord } from "@/features/matches/list/matchListConditions";
import type {
  MatchListFilterActions,
  MatchListFilterCandidates,
  MatchListRecordCondition,
  MatchListSearch,
} from "@/features/matches/list/matchListTypes";
import { useCommittedDraft } from "@/shared/lib/useCommittedDraft";
import { normalizeMatchNoteQuery, searchPeriodError } from "@/shared/matches/matchSearchConditions";
import {
  MatchNoteQueryField,
  MatchSearchScopeFields,
  SearchPeriodFields,
} from "@/shared/matches/MatchSearchFields";
import { Button } from "@/shared/ui/actions/Button";
import { FilterBar } from "@/shared/ui/forms/FilterBar";

type MatchesFilterBarProps = {
  actions: MatchListFilterActions;
  candidates: MatchListFilterCandidates;
  hasConditions: boolean;
  pending?: boolean | undefined;
  search: MatchListSearch;
};

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
    const q = normalizeMatchNoteQuery(memo);
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
            </div>
            <div className="w-full max-w-[34rem] min-w-0">
              <MatchNoteQueryField value={memo} onChange={setMemo} onCommit={commitMemo} />
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

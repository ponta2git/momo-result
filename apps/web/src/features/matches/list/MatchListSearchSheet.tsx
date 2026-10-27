import { useState } from "react";

import {
  MatchListHeldEventField,
  MatchListRecordFields,
} from "@/features/matches/list/MatchListConditionFields";
import { matchListRecordError } from "@/features/matches/list/matchListConditions";
import { hasMatchListConditions } from "@/features/matches/list/matchListSearchParams";
import { clearMatchListConditions } from "@/features/matches/list/matchListSelection";
import type {
  MatchListFilterCandidates,
  MatchListSearch,
} from "@/features/matches/list/matchListTypes";
import { normalizeMatchNoteQuery, searchPeriodError } from "@/shared/matches/matchSearchConditions";
import {
  MatchNoteQueryField,
  MatchSearchScopeFields,
  SearchPeriodFields,
} from "@/shared/matches/MatchSearchFields";
import { Button } from "@/shared/ui/actions/Button";
import { Dialog, DialogFooter } from "@/shared/ui/feedback/Dialog";

type MatchListSearchSheetProps = {
  candidates: MatchListFilterCandidates;
  open: boolean;
  search: MatchListSearch;
  onApply: (search: MatchListSearch) => void;
  onOpenChange: (open: boolean) => void;
};

const formId = "match-list-search-sheet";

/** Edits every condition as one draft; nothing is searched until the reader applies it. */
export function MatchListSearchSheet({
  candidates,
  open,
  search,
  onApply,
  onOpenChange,
}: MatchListSearchSheetProps) {
  const [session, setSession] = useState({ draft: search, open });
  // Each opening starts from the applied search; closing discards the unapplied draft.
  if (session.open !== open) setSession({ draft: search, open });
  const draft = session.open === open ? session.draft : search;
  const setDraft = (next: MatchListSearch) => setSession({ draft: next, open });
  const invalid =
    searchPeriodError(draft.from, draft.to) !== undefined ||
    matchListRecordError(draft.record) !== undefined;

  return (
    <Dialog
      footer={
        <DialogFooter>
          <Button
            disabled={!hasMatchListConditions(draft)}
            size="sm"
            variant="quiet"
            onClick={() => setDraft(clearMatchListConditions(draft))}
          >
            条件をすべて解除
          </Button>
          <Button disabled={invalid} form={formId} type="submit">
            この条件で検索
          </Button>
        </DialogFooter>
      }
      open={open}
      title="検索条件"
      onOpenChange={onOpenChange}
    >
      <form
        className="grid gap-4 px-2"
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          if (invalid) return;
          onApply({ ...draft, q: normalizeMatchNoteQuery(draft.q) });
        }}
      >
        <SearchSheetFields candidates={candidates} draft={draft} onChange={setDraft} />
      </form>
    </Dialog>
  );
}

function SearchSheetFields({
  candidates,
  draft,
  onChange,
}: {
  candidates: MatchListFilterCandidates;
  draft: MatchListSearch;
  onChange: (draft: MatchListSearch) => void;
}) {
  const patch = (next: Partial<MatchListSearch>) => onChange({ ...draft, ...next });

  return (
    <>
      <div className="grid grid-cols-2 gap-3 [&>*:first-child]:col-span-2 [&>*:last-child]:col-span-2">
        <MatchSearchScopeFields
          candidates={candidates}
          gameTitleId={draft.gameTitleId}
          mapMasterId={draft.mapMasterId}
          seasonMasterId={draft.seasonMasterId}
          sort={draft.sort}
          onGameTitleChange={(gameTitleId) =>
            patch({
              gameTitleId,
              mapMasterId: gameTitleId === draft.gameTitleId ? draft.mapMasterId : "",
              seasonMasterId: gameTitleId === draft.gameTitleId ? draft.seasonMasterId : "",
            })
          }
          onMapChange={(mapMasterId) => patch({ mapMasterId })}
          onSeasonChange={(seasonMasterId) => patch({ seasonMasterId })}
          onSortChange={(sort) => patch({ sort })}
        />
      </div>
      <hr className="border-[var(--color-border)]" />
      <MatchListHeldEventField
        candidates={candidates}
        value={draft.heldEventId}
        onChange={(heldEventId) => patch({ heldEventId })}
      />
      <SearchPeriodFields
        from={draft.from}
        layout="grid"
        to={draft.to}
        onChange={(period) => patch(period)}
      />
      <MatchNoteQueryField value={draft.q} onChange={(q) => patch({ q })} />
      <MatchListRecordFields
        layout="grid"
        value={draft.record}
        onChange={(record) => patch({ record })}
      />
    </>
  );
}

import { useState } from "react";

import {
  HeldEventListMemoField,
  HeldEventListMetricFields,
  HeldEventListMinMatchCountField,
} from "@/features/heldEvents/list/HeldEventListConditionFields";
import { heldEventListMetricError } from "@/features/heldEvents/list/heldEventListConditions";
import { hasHeldEventListConditions } from "@/features/heldEvents/list/heldEventListSearchParams";
import { clearHeldEventListConditions } from "@/features/heldEvents/list/heldEventListSelection";
import type {
  HeldEventListFilterCandidates,
  HeldEventListSearch,
} from "@/features/heldEvents/list/heldEventListTypes";
import { normalizeMatchNoteQuery, searchPeriodError } from "@/shared/matches/matchSearchConditions";
import { MatchSearchScopeFields, SearchPeriodFields } from "@/shared/matches/MatchSearchFields";
import { Button } from "@/shared/ui/actions/Button";
import { Dialog, DialogFooter } from "@/shared/ui/feedback/Dialog";

type HeldEventListSearchSheetProps = {
  candidates: HeldEventListFilterCandidates;
  open: boolean;
  search: HeldEventListSearch;
  onApply: (search: HeldEventListSearch) => void;
  onOpenChange: (open: boolean) => void;
};

const formId = "held-event-list-search-sheet";

/** Edits every condition as one draft; nothing is searched until the reader applies it. */
export function HeldEventListSearchSheet({
  candidates,
  open,
  search,
  onApply,
  onOpenChange,
}: HeldEventListSearchSheetProps) {
  const [session, setSession] = useState({ draft: search, open });
  // Each opening starts from the applied search; closing discards the unapplied draft.
  if (session.open !== open) setSession({ draft: search, open });
  const draft = session.open === open ? session.draft : search;
  const setDraft = (next: HeldEventListSearch) => setSession({ draft: next, open });
  const invalid =
    searchPeriodError(draft.from, draft.to) !== undefined ||
    heldEventListMetricError(draft.metric) !== undefined;

  return (
    <Dialog
      footer={
        <DialogFooter>
          <Button
            disabled={!hasHeldEventListConditions(draft)}
            size="sm"
            variant="quiet"
            onClick={() => setDraft(clearHeldEventListConditions(draft))}
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
  candidates: HeldEventListFilterCandidates;
  draft: HeldEventListSearch;
  onChange: (draft: HeldEventListSearch) => void;
}) {
  const patch = (next: Partial<HeldEventListSearch>) => onChange({ ...draft, ...next });

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
      <SearchPeriodFields
        from={draft.from}
        layout="grid"
        to={draft.to}
        onChange={(period) => patch(period)}
      />
      <HeldEventListMinMatchCountField
        value={draft.minMatchCount}
        onChange={(minMatchCount) => patch({ minMatchCount })}
      />
      <HeldEventListMemoField value={draft.q} onChange={(q) => patch({ q })} />
      <HeldEventListMetricFields
        layout="grid"
        value={draft.metric}
        onChange={(metric) => patch({ metric })}
      />
    </>
  );
}

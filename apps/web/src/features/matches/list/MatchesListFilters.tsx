import { useMemo } from "react";

import type {
  MatchListFilterActions,
  MatchListFilterCandidates,
  MatchListFilterSelectionErrors,
  MatchListSearch,
} from "@/features/matches/list/matchListTypes";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import { formatDateOnly } from "@/shared/lib/dateTime";
import { HeldEventPickerField } from "@/shared/ui/forms/HeldEventPickerField";
import { SelectField } from "@/shared/ui/forms/SelectField";

type MatchesListFiltersProps = {
  actions: MatchListFilterActions;
  candidates: MatchListFilterCandidates;
  pending?: boolean | undefined;
  search: MatchListSearch;
  selectionErrors?: MatchListFilterSelectionErrors | undefined;
};

function heldEventLabel(event: HeldEventResponse): string {
  return formatDateOnly(event.heldAt);
}

export function describeMatchListDetailFilters(
  candidates: MatchListFilterCandidates,
  search: MatchListSearch,
): string[] {
  const selectedHeldEvent = candidates.heldEvents.find((event) => event.id === search.heldEventId);
  const selectedGameTitle = candidates.gameTitles.find(
    (gameTitle) => gameTitle.id === search.gameTitleId,
  );
  const selectedSeason = candidates.seasons.find((season) => season.id === search.seasonMasterId);

  return [
    search.heldEventId
      ? `開催 ${selectedHeldEvent ? heldEventLabel(selectedHeldEvent) : "選択中"}`
      : undefined,
    search.gameTitleId ? `作品 ${selectedGameTitle?.name ?? "選択中"}` : undefined,
    search.seasonMasterId ? `シーズン ${selectedSeason?.name ?? "選択中"}` : undefined,
  ].filter((label): label is string => label !== undefined);
}

/**
 * Owns match-list-specific detail controls and their dependent season options.
 * The surrounding operation surface is composed by MatchesFilterBar.
 */
export function MatchesListFilters({
  actions,
  candidates,
  pending = false,
  search,
  selectionErrors,
}: MatchesListFiltersProps) {
  const seasonMasters = useMemo(
    () =>
      candidates.seasons.filter((season) => {
        return !search.gameTitleId || season.gameTitleId === search.gameTitleId;
      }),
    [candidates.seasons, search.gameTitleId],
  );
  const gameTitleOptions = useMemo(
    () => [
      { label: "すべて", value: "" },
      ...candidates.gameTitles.map((gameTitle) => ({
        label: gameTitle.name,
        value: gameTitle.id,
      })),
    ],
    [candidates.gameTitles],
  );
  const seasonOptions = useMemo(
    () => [
      { label: "すべて", value: "" },
      ...seasonMasters.map((season) => ({ label: season.name, value: season.id })),
    ],
    [seasonMasters],
  );
  const heldEventsErrorProps = selectionErrors?.heldEvents
    ? { error: selectionErrors.heldEvents }
    : {};
  const heldEventPicker = candidates.heldEventPicker;
  const gameTitlesErrorProps = selectionErrors?.gameTitles
    ? { error: selectionErrors.gameTitles }
    : {};
  const seasonsErrorProps = selectionErrors?.seasons ? { error: selectionErrors.seasons } : {};

  function patchSearch(patch: Partial<MatchListSearch>) {
    actions.onApply({ ...search, ...patch, cursor: "" });
  }

  return (
    <>
      <HeldEventPickerField
        disabled={pending}
        emptyChoiceDescription="開催で絞り込みません。"
        emptyChoiceLabel="すべての開催"
        error={selectionErrors?.heldEvents ?? heldEventPicker?.error}
        heldEvents={heldEventPicker?.heldEvents ?? candidates.heldEvents}
        label="開催"
        name="match-list-held-event"
        pagination={heldEventPicker?.pagination}
        pending={heldEventPicker?.pending}
        selectedHeldEvent={heldEventPicker?.selectedHeldEvent}
        unavailableLabel="すべての開催"
        value={search.heldEventId}
        {...(heldEventPicker ? {} : heldEventsErrorProps)}
        onPageChange={heldEventPicker?.onPageChange}
        onValueChange={(heldEventId) => {
          patchSearch({ heldEventId });
        }}
      />
      <SelectField
        disabled={pending}
        label="作品"
        options={gameTitleOptions}
        value={search.gameTitleId}
        {...gameTitlesErrorProps}
        onChange={(event) => {
          const value = event.currentTarget.value;
          patchSearch({
            gameTitleId: value,
            seasonMasterId: value && search.gameTitleId === value ? search.seasonMasterId : "",
          });
        }}
      />
      <SelectField
        disabled={pending}
        label="シーズン"
        options={seasonOptions}
        value={search.seasonMasterId}
        {...seasonsErrorProps}
        onChange={(event) => {
          patchSearch({ seasonMasterId: event.currentTarget.value });
        }}
      />
    </>
  );
}

import { useState } from "react";

import type { HeldEventResponse } from "@/features/draftReview/api";
import type {
  MatchListSearch,
  MatchListSort,
  MatchListStatusFilter,
} from "@/features/matches/list/matchListTypes";
import type { GameTitleResponse, SeasonMasterResponse } from "@/shared/api/masters";
import { Button } from "@/shared/ui/actions/Button";
import { SegmentedControl } from "@/shared/ui/forms/SegmentedControl";
import { SelectField } from "@/shared/ui/forms/SelectField";

type MatchesListFiltersProps = {
  gameTitles: GameTitleResponse[];
  heldEvents: HeldEventResponse[];
  initialSearch: MatchListSearch;
  onApply: (nextSearch: MatchListSearch) => void;
  onClear: () => void;
  seasons: SeasonMasterResponse[];
  selectionErrors?: {
    gameTitles?: string;
    heldEvents?: string;
    seasons?: string;
  };
};

const statusOptions: Array<{ label: string; value: MatchListStatusFilter }> = [
  { label: "すべて", value: "all" },
  { label: "未完了", value: "incomplete" },
  { label: "OCR中", value: "ocr_running" },
  { label: "確定前", value: "pre_confirm" },
  { label: "要確認", value: "needs_review" },
  { label: "確定済", value: "confirmed" },
];

const sortOptions: Array<{ label: string; value: MatchListSort }> = [
  { label: "未完了を先頭", value: "status_priority" },
  { label: "更新が新しい順", value: "updated_desc" },
  { label: "開催が新しい順", value: "held_desc" },
  { label: "開催が古い順", value: "held_asc" },
  { label: "試合番号順", value: "match_no_asc" },
];

function heldEventLabel(event: HeldEventResponse): string {
  return new Intl.DateTimeFormat("ja-JP", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(event.heldAt));
}

export function MatchesListFilters({
  gameTitles,
  heldEvents,
  initialSearch,
  onApply,
  onClear,
  seasons,
  selectionErrors,
}: MatchesListFiltersProps) {
  const [draftSearch, setDraftSearch] = useState(initialSearch);

  const seasonOptions = seasons.filter((season) => {
    return !draftSearch.gameTitleId || season.gameTitleId === draftSearch.gameTitleId;
  });
  const heldEventsErrorProps = selectionErrors?.heldEvents
    ? { error: selectionErrors.heldEvents }
    : {};
  const gameTitlesErrorProps = selectionErrors?.gameTitles
    ? { error: selectionErrors.gameTitles }
    : {};
  const seasonsErrorProps = selectionErrors?.seasons ? { error: selectionErrors.seasons } : {};

  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          onApply(draftSearch);
        }}
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="hidden min-[44rem]:block">
              <SegmentedControl
                className="w-full"
                label="状態"
                onValueChange={(value) =>
                  setDraftSearch((current) => ({
                    ...current,
                    status: value as MatchListStatusFilter,
                  }))
                }
                options={statusOptions}
                value={draftSearch.status}
              />
            </div>
            <div className="min-[44rem]:hidden">
              <SegmentedControl
                asSelect
                label="状態"
                onValueChange={(value) =>
                  setDraftSearch((current) => ({
                    ...current,
                    status: value as MatchListStatusFilter,
                  }))
                }
                options={statusOptions}
                value={draftSearch.status}
              />
            </div>
          </div>
          <SelectField
            label="ソート"
            options={sortOptions}
            value={draftSearch.sort}
            onChange={(event) =>
              setDraftSearch((current) => ({
                ...current,
                sort: event.currentTarget.value as MatchListSort,
              }))
            }
          />
        </div>

        <div className="hidden gap-4 md:grid md:grid-cols-3">
          <SelectField
            label="開催"
            options={[
              { label: "すべて", value: "" },
              ...heldEvents.map((event) => ({ label: heldEventLabel(event), value: event.id })),
            ]}
            value={draftSearch.heldEventId}
            {...heldEventsErrorProps}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setDraftSearch((current) => ({
                ...current,
                heldEventId: value,
              }));
            }}
          />
          <SelectField
            label="作品"
            options={[
              { label: "すべて", value: "" },
              ...gameTitles.map((gameTitle) => ({ label: gameTitle.name, value: gameTitle.id })),
            ]}
            value={draftSearch.gameTitleId}
            {...gameTitlesErrorProps}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setDraftSearch((current) => ({
                ...current,
                gameTitleId: value,
                seasonMasterId:
                  value && current.gameTitleId === value ? current.seasonMasterId : "",
              }));
            }}
          />
          <SelectField
            label="シーズン"
            options={[
              { label: "すべて", value: "" },
              ...seasonOptions.map((season) => ({ label: season.name, value: season.id })),
            ]}
            value={draftSearch.seasonMasterId}
            {...seasonsErrorProps}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setDraftSearch((current) => ({
                ...current,
                seasonMasterId: value,
              }));
            }}
          />
        </div>

        <details className="md:hidden">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--color-text-primary)]">
            開催・作品・シーズンを絞る
          </summary>
          <div className="mt-3 grid gap-4">
            <SelectField
              label="開催"
              options={[
                { label: "すべて", value: "" },
                ...heldEvents.map((event) => ({ label: heldEventLabel(event), value: event.id })),
              ]}
              value={draftSearch.heldEventId}
              {...heldEventsErrorProps}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setDraftSearch((current) => ({
                  ...current,
                  heldEventId: value,
                }));
              }}
            />
            <SelectField
              label="作品"
              options={[
                { label: "すべて", value: "" },
                ...gameTitles.map((gameTitle) => ({ label: gameTitle.name, value: gameTitle.id })),
              ]}
              value={draftSearch.gameTitleId}
              {...gameTitlesErrorProps}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setDraftSearch((current) => ({
                  ...current,
                  gameTitleId: value,
                  seasonMasterId:
                    value && current.gameTitleId === value ? current.seasonMasterId : "",
                }));
              }}
            />
            <SelectField
              label="シーズン"
              options={[
                { label: "すべて", value: "" },
                ...seasonOptions.map((season) => ({ label: season.name, value: season.id })),
              ]}
              value={draftSearch.seasonMasterId}
              {...seasonsErrorProps}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setDraftSearch((current) => ({
                  ...current,
                  seasonMasterId: value,
                }));
              }}
            />
          </div>
        </details>

        <div className="flex flex-wrap gap-2">
          <Button type="submit">絞り込む</Button>
          <Button onClick={onClear} type="button" variant="secondary">
            条件をクリア
          </Button>
        </div>
      </form>
    </section>
  );
}

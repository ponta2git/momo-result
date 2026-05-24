import { useMemo } from "react";

import type {
  MatchListSearch,
  MatchListSort,
  MatchListStatusFilter,
} from "@/features/matches/list/matchListTypes";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import type { GameTitleResponse, SeasonMasterResponse } from "@/shared/api/masters";
import { Button } from "@/shared/ui/actions/Button";
import { SelectField } from "@/shared/ui/forms/SelectField";

type MatchesListFiltersProps = {
  gameTitles: GameTitleResponse[];
  heldEvents: HeldEventResponse[];
  initialSearch: MatchListSearch;
  pending?: boolean;
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
  { label: "処理中", value: "ocr_running" },
  { label: "確認待ち", value: "pre_confirm" },
  { label: "要確認", value: "needs_review" },
  { label: "確定済", value: "confirmed" },
];

const sortOptions: Array<{ label: string; value: MatchListSort }> = [
  { label: "未完了から表示", value: "status_priority" },
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
  pending = false,
  onApply,
  onClear,
  seasons,
  selectionErrors,
}: MatchesListFiltersProps) {
  const seasonMasters = useMemo(
    () =>
      seasons.filter((season) => {
        return !initialSearch.gameTitleId || season.gameTitleId === initialSearch.gameTitleId;
      }),
    [initialSearch.gameTitleId, seasons],
  );
  const heldEventOptions = useMemo(
    () => [
      { label: "すべて", value: "" },
      ...heldEvents.map((event) => ({ label: heldEventLabel(event), value: event.id })),
    ],
    [heldEvents],
  );
  const gameTitleOptions = useMemo(
    () => [
      { label: "すべて", value: "" },
      ...gameTitles.map((gameTitle) => ({ label: gameTitle.name, value: gameTitle.id })),
    ],
    [gameTitles],
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
  const gameTitlesErrorProps = selectionErrors?.gameTitles
    ? { error: selectionErrors.gameTitles }
    : {};
  const seasonsErrorProps = selectionErrors?.seasons ? { error: selectionErrors.seasons } : {};

  function patchSearch(patch: Partial<MatchListSearch>) {
    onApply({ ...initialSearch, ...patch });
  }
  const hasDetailFilters = Boolean(
    initialSearch.heldEventId || initialSearch.gameTitleId || initialSearch.seasonMasterId,
  );

  return (
    <section
      aria-busy={pending || undefined}
      className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
    >
      <div className="grid gap-4">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">絞り込み</p>
          {pending ? (
            <span className="momo-enter rounded-full border border-[var(--color-action)]/30 bg-[var(--color-action)]/10 px-3 py-1 text-xs font-semibold text-[var(--color-text-secondary)]">
              反映中
            </span>
          ) : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-[minmax(12rem,16rem)_minmax(12rem,16rem)] sm:items-end">
          <SelectField
            label="状態"
            options={statusOptions}
            value={initialSearch.status}
            onChange={(event) => {
              const value = event.currentTarget.value;
              patchSearch({ status: value as MatchListStatusFilter });
            }}
          />
          <SelectField
            label="表の並び順"
            options={sortOptions}
            value={initialSearch.sort}
            onChange={(event) => {
              const value = event.currentTarget.value;
              patchSearch({ sort: value as MatchListSort });
            }}
          />
        </div>

        <div className="hidden gap-4 md:grid md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
          <SelectField
            label="開催"
            options={heldEventOptions}
            value={initialSearch.heldEventId}
            {...heldEventsErrorProps}
            onChange={(event) => {
              const value = event.currentTarget.value;
              patchSearch({ heldEventId: value });
            }}
          />
          <SelectField
            label="作品"
            options={gameTitleOptions}
            value={initialSearch.gameTitleId}
            {...gameTitlesErrorProps}
            onChange={(event) => {
              const value = event.currentTarget.value;
              patchSearch({
                gameTitleId: value,
                seasonMasterId:
                  value && initialSearch.gameTitleId === value ? initialSearch.seasonMasterId : "",
              });
            }}
          />
          <SelectField
            label="シーズン"
            options={seasonOptions}
            value={initialSearch.seasonMasterId}
            {...seasonsErrorProps}
            onChange={(event) => {
              const value = event.currentTarget.value;
              patchSearch({ seasonMasterId: value });
            }}
          />
          <Button onClick={onClear} type="button" variant="secondary">
            条件をリセット
          </Button>
        </div>

        <details className="md:hidden" open={hasDetailFilters || undefined}>
          <summary className="cursor-pointer text-sm font-semibold text-[var(--color-text-primary)]">
            開催・作品・シーズンを絞る
          </summary>
          <div className="mt-3 grid gap-4">
            <SelectField
              label="開催"
              options={heldEventOptions}
              value={initialSearch.heldEventId}
              {...heldEventsErrorProps}
              onChange={(event) => {
                const value = event.currentTarget.value;
                patchSearch({ heldEventId: value });
              }}
            />
            <SelectField
              label="作品"
              options={gameTitleOptions}
              value={initialSearch.gameTitleId}
              {...gameTitlesErrorProps}
              onChange={(event) => {
                const value = event.currentTarget.value;
                patchSearch({
                  gameTitleId: value,
                  seasonMasterId:
                    value && initialSearch.gameTitleId === value
                      ? initialSearch.seasonMasterId
                      : "",
                });
              }}
            />
            <SelectField
              label="シーズン"
              options={seasonOptions}
              value={initialSearch.seasonMasterId}
              {...seasonsErrorProps}
              onChange={(event) => {
                const value = event.currentTarget.value;
                patchSearch({ seasonMasterId: value });
              }}
            />
            <Button onClick={onClear} type="button" variant="secondary">
              条件をリセット
            </Button>
          </div>
        </details>
      </div>
    </section>
  );
}

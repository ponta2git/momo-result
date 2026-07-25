import { ChevronDown, Filter, RefreshCw } from "lucide-react";
import { useMemo } from "react";

import type {
  MatchListFilterActions,
  MatchListFilterCandidates,
  MatchListFilterSelectionErrors,
  MatchListSearch,
  MatchListSort,
} from "@/features/matches/list/matchListTypes";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import { IconButton } from "@/shared/ui/actions/IconButton";
import { SelectField } from "@/shared/ui/forms/SelectField";

type MatchesListFiltersProps = {
  actions: MatchListFilterActions;
  candidates: MatchListFilterCandidates;
  onRefresh?: () => void;
  pending?: boolean;
  refreshing?: boolean;
  search: MatchListSearch;
  selectionErrors?: MatchListFilterSelectionErrors;
};

const sortOptions: Array<{ label: string; value: MatchListSort }> = [
  { label: "開催が新しい順", value: "held_desc" },
  { label: "開催が古い順", value: "held_asc" },
  { label: "更新が新しい順", value: "updated_desc" },
  { label: "未確定を優先", value: "status_priority" },
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
  actions,
  candidates,
  onRefresh,
  pending = false,
  refreshing = false,
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
  const heldEventOptions = useMemo(
    () => [
      { label: "すべて", value: "" },
      ...candidates.heldEvents.map((event) => ({
        label: heldEventLabel(event),
        value: event.id,
      })),
    ],
    [candidates.heldEvents],
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
  const gameTitlesErrorProps = selectionErrors?.gameTitles
    ? { error: selectionErrors.gameTitles }
    : {};
  const seasonsErrorProps = selectionErrors?.seasons ? { error: selectionErrors.seasons } : {};

  function patchSearch(patch: Partial<MatchListSearch>) {
    actions.onApply({ ...search, ...patch, page: 1 });
  }
  const hasDetailFilters = Boolean(
    search.heldEventId || search.gameTitleId || search.seasonMasterId,
  );
  const hasResettableFilters =
    hasDetailFilters || search.status !== "all" || search.sort !== "held_desc";
  const selectedHeldEvent = candidates.heldEvents.find((event) => event.id === search.heldEventId);
  const selectedGameTitle = candidates.gameTitles.find(
    (gameTitle) => gameTitle.id === search.gameTitleId,
  );
  const selectedSeason = candidates.seasons.find((season) => season.id === search.seasonMasterId);
  const activeDetailFilters = [
    search.heldEventId
      ? {
          key: "held-event",
          label: `開催 ${selectedHeldEvent ? heldEventLabel(selectedHeldEvent) : "選択中"}`,
        }
      : undefined,
    search.gameTitleId
      ? {
          key: "game-title",
          label: `作品 ${selectedGameTitle?.name ?? "選択中"}`,
        }
      : undefined,
    search.seasonMasterId
      ? {
          key: "season",
          label: `シーズン ${selectedSeason?.name ?? "選択中"}`,
        }
      : undefined,
  ].filter(
    (
      filter,
    ): filter is {
      key: string;
      label: string;
    } => filter !== undefined,
  );

  return (
    <section
      aria-busy={pending || undefined}
      aria-label="表示条件"
      className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
    >
      <div className="grid gap-4">
        <div className="flex min-w-0 items-end gap-2">
          <div className="min-w-0 flex-1 sm:w-52 sm:flex-none">
            <SelectField
              disabled={pending}
              label="並び順"
              options={sortOptions}
              value={search.sort}
              onChange={(event) => {
                const value = event.currentTarget.value;
                patchSearch({ sort: value as MatchListSort });
              }}
            />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {hasResettableFilters ? (
              <button
                aria-label="確定状況・並び順・詳細条件を初期状態に戻す"
                className="momo-pressable inline-flex min-h-11 items-center rounded-[var(--radius-xs)] px-2 py-1 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={pending}
                type="button"
                onClick={actions.onClear}
              >
                表示条件をリセット
              </button>
            ) : null}
            {onRefresh ? (
              <IconButton
                aria-label={refreshing ? "一覧を更新中" : "最新情報に更新"}
                disabled={pending || refreshing}
                icon={
                  <RefreshCw
                    className={refreshing ? "animate-spin motion-reduce:animate-none" : undefined}
                  />
                }
                tooltip={refreshing ? "更新中…" : "最新情報に更新"}
                variant="quiet"
                onClick={onRefresh}
              />
            ) : null}
          </div>
        </div>

        <details
          className="group rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)]"
          open={hasDetailFilters || undefined}
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-semibold text-[var(--color-text-primary)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--color-surface-selected)] motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
            <span className="inline-flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              <Filter aria-hidden="true" className="size-4 shrink-0" />
              <span className="shrink-0">詳細条件</span>
              {activeDetailFilters.length > 0 ? (
                <span className="inline-flex min-w-0 items-center gap-1.5 overflow-hidden">
                  {activeDetailFilters.map((filter) => (
                    <span
                      key={filter.key}
                      className="max-w-40 min-w-0 truncate rounded-full bg-[var(--color-action)]/10 px-2 py-0.5 text-xs font-medium text-[var(--color-text-primary)]"
                      title={filter.label}
                    >
                      {filter.label}
                    </span>
                  ))}
                </span>
              ) : null}
            </span>
            <ChevronDown
              aria-hidden="true"
              className="size-4 shrink-0 text-[var(--color-text-secondary)] transition-transform duration-[var(--motion-base)] group-open:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <div className="grid gap-4 border-t border-[var(--color-border)] p-3 md:grid-cols-3 md:items-end">
            <SelectField
              disabled={pending}
              label="開催"
              options={heldEventOptions}
              value={search.heldEventId}
              {...heldEventsErrorProps}
              onChange={(event) => {
                const value = event.currentTarget.value;
                patchSearch({ heldEventId: value });
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
                  seasonMasterId:
                    value && search.gameTitleId === value ? search.seasonMasterId : "",
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
                const value = event.currentTarget.value;
                patchSearch({ seasonMasterId: value });
              }}
            />
          </div>
        </details>
      </div>
    </section>
  );
}

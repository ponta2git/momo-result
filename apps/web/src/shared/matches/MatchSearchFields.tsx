import { useMemo } from "react";
import type { KeyboardEvent } from "react";

import {
  heldOrderSortOptions,
  matchNoteQueryMaxLength,
  searchPeriodError,
} from "@/shared/matches/matchSearchConditions";
import type {
  HeldOrderSort,
  MatchSearchScopeCandidates,
} from "@/shared/matches/matchSearchConditions";
import { cn } from "@/shared/ui/cn";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { TextField } from "@/shared/ui/forms/TextField";

export function commitOnEnter(commit: () => void) {
  return (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      commit();
    }
  };
}

function useScopedCandidateOptions(candidates: MatchSearchScopeCandidates, gameTitleId: string) {
  return useMemo(() => {
    const inTitle = <T extends { gameTitleId: string }>(item: T) =>
      !gameTitleId || item.gameTitleId === gameTitleId;
    return {
      gameTitles: [
        { label: "すべて", value: "" },
        ...candidates.gameTitles.map((item) => ({ label: item.name, value: item.id })),
      ],
      maps: [
        { label: "すべて", value: "" },
        ...candidates.maps.filter(inTitle).map((item) => ({ label: item.name, value: item.id })),
      ],
      seasons: [
        { label: "すべて", value: "" },
        ...candidates.seasons.filter(inTitle).map((item) => ({ label: item.name, value: item.id })),
      ],
    };
  }, [candidates.gameTitles, candidates.maps, candidates.seasons, gameTitleId]);
}

type ScopeFieldsProps = {
  candidates: MatchSearchScopeCandidates;
  gameTitleId: string;
  mapMasterId: string;
  seasonMasterId: string;
  sort: HeldOrderSort;
  onGameTitleChange: (gameTitleId: string) => void;
  onMapChange: (mapMasterId: string) => void;
  onSeasonChange: (seasonMasterId: string) => void;
  onSortChange: (sort: HeldOrderSort) => void;
};

/** 作品 / シーズン / マップ scoped to the chosen title, followed by the held-order sort. */
export function MatchSearchScopeFields({
  candidates,
  gameTitleId,
  mapMasterId,
  seasonMasterId,
  sort,
  onGameTitleChange,
  onMapChange,
  onSeasonChange,
  onSortChange,
}: ScopeFieldsProps) {
  const options = useScopedCandidateOptions(candidates, gameTitleId);
  return (
    <>
      <SelectField
        label="作品"
        options={options.gameTitles}
        value={gameTitleId}
        onValueChange={onGameTitleChange}
      />
      <SelectField
        label="シーズン"
        options={options.seasons}
        value={seasonMasterId}
        onValueChange={onSeasonChange}
      />
      <SelectField
        label="マップ"
        options={options.maps}
        value={mapMasterId}
        onValueChange={onMapChange}
      />
      <SelectField
        label="並び順"
        options={heldOrderSortOptions}
        value={sort}
        onValueChange={(value) => onSortChange(value === "held_asc" ? "held_asc" : "held_desc")}
      />
    </>
  );
}

export function SearchPeriodFields({
  from,
  to,
  onChange,
  layout = "inline",
}: {
  from: string;
  to: string;
  onChange: (period: { from: string; to: string }) => void;
  layout?: "inline" | "grid";
}) {
  const error = searchPeriodError(from, to);
  return (
    <div
      className={cn(
        "min-w-0",
        layout === "grid" ? "grid grid-cols-2 gap-3" : "flex flex-wrap items-start gap-2",
      )}
    >
      <div className={layout === "grid" ? "min-w-0" : "w-42"}>
        <TextField
          label="期間の開始"
          max={to || undefined}
          type="date"
          value={from}
          onChange={(event) => onChange({ from: event.currentTarget.value, to })}
        />
      </div>
      <div className={layout === "grid" ? "min-w-0" : "w-42"}>
        <TextField
          error={error}
          label="期間の終了"
          min={from || undefined}
          type="date"
          value={to}
          onChange={(event) => onChange({ from, to: event.currentTarget.value })}
        />
      </div>
    </div>
  );
}

const commitDescription = "Enter またはフォーカスを外すと検索します。";

/**
 * The memo phrase input. With `onCommit`, the phrase is searched on Enter or blur; otherwise the
 * caller owns when it applies (for example a search sheet's submit).
 */
export function MatchNoteQueryField({
  scopeDescription,
  value,
  onChange,
  onCommit,
}: {
  scopeDescription?: string | undefined;
  value: string;
  onChange: (q: string) => void;
  onCommit?: (() => void) | undefined;
}) {
  const description =
    [scopeDescription, onCommit ? commitDescription : undefined].filter(Boolean).join("") ||
    undefined;
  return (
    <TextField
      description={description}
      label="メモに含む語句"
      maxLength={matchNoteQueryMaxLength}
      placeholder="例: キングボンビー"
      type="search"
      value={value}
      onBlur={onCommit}
      onChange={(event) => onChange(event.currentTarget.value)}
      onKeyDown={onCommit ? commitOnEnter(onCommit) : undefined}
    />
  );
}

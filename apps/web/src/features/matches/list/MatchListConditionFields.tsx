import { useMemo } from "react";
import type { KeyboardEvent } from "react";

import {
  matchListMemberOptions,
  matchListPeriodError,
  matchListRangeOptions,
  matchListRecordError,
  matchListRecordOptions,
  matchListRecordValueLabel,
  matchListSortOptions,
} from "@/features/matches/list/matchListConditions";
import { matchListMemoQueryMaxLength } from "@/features/matches/list/matchListSearchParams";
import type {
  MatchListFilterCandidates,
  MatchListRecord,
  MatchListRecordCondition,
  MatchListRecordRange,
  MatchListSort,
} from "@/features/matches/list/matchListTypes";
import { HeldEventPickerField } from "@/shared/heldEvents/HeldEventPickerField";
import { cn } from "@/shared/ui/cn";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { TextField } from "@/shared/ui/forms/TextField";
import { contentText } from "@/shared/ui/typography";

function commitOnEnter(commit: () => void) {
  return (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      commit();
    }
  };
}

export function useScopedCandidateOptions(
  candidates: MatchListFilterCandidates,
  gameTitleId: string,
) {
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
  candidates: MatchListFilterCandidates;
  gameTitleId: string;
  mapMasterId: string;
  seasonMasterId: string;
  sort: MatchListSort;
  onGameTitleChange: (gameTitleId: string) => void;
  onMapChange: (mapMasterId: string) => void;
  onSeasonChange: (seasonMasterId: string) => void;
  onSortChange: (sort: MatchListSort) => void;
};

export function MatchListScopeFields({
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
        options={matchListSortOptions}
        value={sort}
        onValueChange={(value) => onSortChange(value as MatchListSort)}
      />
    </>
  );
}

export function MatchListHeldEventField({
  candidates,
  value,
  onChange,
}: {
  candidates: MatchListFilterCandidates;
  value: string;
  onChange: (heldEventId: string) => void;
}) {
  const picker = candidates.heldEventPicker;
  return (
    <HeldEventPickerField
      emptyChoiceDescription="開催で絞り込みません。"
      emptyChoiceLabel="すべての開催"
      error={picker?.error}
      heldEvents={picker?.heldEvents ?? candidates.heldEvents}
      label="開催"
      name="match-list-held-event"
      pagination={picker?.pagination}
      pending={picker?.pending}
      scopeChanging={picker?.scopeChanging}
      selectedHeldEvent={picker?.selectedHeldEvent}
      unavailableLabel="すべての開催"
      value={value}
      onPageChange={picker?.onPageChange}
      onValueChange={onChange}
    />
  );
}

export function MatchListPeriodFields({
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
  const error = matchListPeriodError(from, to);
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

export function MatchListMemoField({
  value,
  onChange,
  onCommit,
}: {
  value: string;
  onChange: (q: string) => void;
  onCommit?: (() => void) | undefined;
}) {
  return (
    <TextField
      description={onCommit ? "Enter またはフォーカスを外すと検索します。" : undefined}
      label="メモに含む語句"
      maxLength={matchListMemoQueryMaxLength}
      placeholder="例: キングボンビー"
      type="search"
      value={value}
      onBlur={onCommit}
      onChange={(event) => onChange(event.currentTarget.value)}
      onKeyDown={onCommit ? commitOnEnter(onCommit) : undefined}
    />
  );
}

export function MatchListRecordFields({
  value,
  onChange,
  onCommit,
  layout = "inline",
}: {
  value: MatchListRecordCondition;
  onChange: (condition: MatchListRecordCondition) => void;
  onCommit?: ((condition: MatchListRecordCondition) => void) | undefined;
  layout?: "inline" | "grid";
}) {
  const error = matchListRecordError(value);
  const update = (patch: Partial<MatchListRecordCondition>, commit: boolean) => {
    const next = { ...value, ...patch };
    onChange(next);
    if (commit) onCommit?.(next);
  };
  const cell = (width: string, wide = false) =>
    layout === "grid" ? cn("min-w-0", wide && "col-span-2") : width;

  return (
    <fieldset className="grid min-w-0 gap-2">
      <legend className={cn(contentText.heading, "mb-2")}>プレーヤーの記録</legend>
      <div
        className={cn(
          "min-w-0",
          layout === "grid" ? "grid grid-cols-2 gap-3" : "flex flex-wrap items-start gap-3",
        )}
      >
        <div className={cell("w-40", true)}>
          <SelectField
            label="プレーヤー"
            options={matchListMemberOptions}
            value={value.memberId}
            onValueChange={(memberId) => update({ memberId }, true)}
          />
        </div>
        <div className={cell("w-56", true)}>
          <SelectField
            label="記録"
            options={[{ label: "指定しない", value: "" }, ...matchListRecordOptions]}
            value={value.record}
            onValueChange={(record) =>
              update(
                record === "" ? { record: "", value: "" } : { record: record as MatchListRecord },
                true,
              )
            }
          />
        </div>
        <div className={cell("w-36")}>
          <TextField
            disabled={value.record === ""}
            error={error}
            inputMode={value.record === "revenue" ? "text" : "numeric"}
            label={matchListRecordValueLabel(value.record)}
            textAlign="end"
            value={value.value}
            onBlur={() => onCommit?.(value)}
            onChange={(event) => update({ value: event.currentTarget.value }, false)}
            onKeyDown={onCommit ? commitOnEnter(() => onCommit(value)) : undefined}
          />
        </div>
        <div className={cell("w-28")}>
          <SelectField
            disabled={value.record === ""}
            label="範囲"
            options={matchListRangeOptions}
            value={value.range}
            onValueChange={(range) => update({ range: range as MatchListRecordRange }, true)}
          />
        </div>
      </div>
      <p className={contentText.supporting}>
        プレーヤーを選ばないと、4人のうち誰か1人でも当てはまる試合を探します。事件簿は回数、総資産・収益は万円で入力します。
      </p>
    </fieldset>
  );
}

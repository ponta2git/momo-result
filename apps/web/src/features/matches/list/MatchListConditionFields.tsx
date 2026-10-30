import {
  matchListRecordError,
  matchListRecordOptions,
  matchListRecordValueLabel,
} from "@/features/matches/list/matchListConditions";
import type {
  MatchListFilterCandidates,
  MatchListRecord,
  MatchListRecordCondition,
  MatchListRecordRange,
} from "@/features/matches/list/matchListTypes";
import { HeldEventPickerField } from "@/shared/heldEvents/HeldEventPickerField";
import { searchMemberOptions, searchRangeOptions } from "@/shared/matches/matchSearchConditions";
import { commitOnEnter } from "@/shared/matches/MatchSearchFields";
import { cn } from "@/shared/ui/cn";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { TextField } from "@/shared/ui/forms/TextField";
import { contentText } from "@/shared/ui/typography";

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
            options={searchMemberOptions}
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
            options={searchRangeOptions}
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

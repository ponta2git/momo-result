import {
  heldEventListMetricError,
  heldEventListMetricOptions,
  heldEventListMinMatchCountOptions,
} from "@/features/heldEvents/list/heldEventListConditions";
import type {
  HeldEventListMetric,
  HeldEventListMetricCondition,
} from "@/features/heldEvents/list/heldEventListTypes";
import { searchMemberOptions, searchRangeOptions } from "@/shared/matches/matchSearchConditions";
import type { SearchRange } from "@/shared/matches/matchSearchConditions";
import { commitOnEnter, MatchNoteQueryField } from "@/shared/matches/MatchSearchFields";
import { cn } from "@/shared/ui/cn";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { TextField } from "@/shared/ui/forms/TextField";
import { contentText } from "@/shared/ui/typography";

export function HeldEventListMinMatchCountField({
  value,
  onChange,
}: {
  value: number;
  onChange: (minMatchCount: number) => void;
}) {
  return (
    <SelectField
      label="確定試合数"
      options={heldEventListMinMatchCountOptions}
      value={value > 0 ? String(value) : ""}
      onValueChange={(next) => onChange(next === "" ? 0 : Number(next))}
    />
  );
}

export function HeldEventListMemoField({
  value,
  onChange,
  onCommit,
}: {
  value: string;
  onChange: (q: string) => void;
  onCommit?: (() => void) | undefined;
}) {
  return (
    <MatchNoteQueryField
      scopeDescription="開催内のどれかの試合メモに含まれる開催を探します。"
      value={value}
      onChange={onChange}
      onCommit={onCommit}
    />
  );
}

export function HeldEventListMetricFields({
  value,
  onChange,
  onCommit,
  layout = "inline",
}: {
  value: HeldEventListMetricCondition;
  onChange: (condition: HeldEventListMetricCondition) => void;
  onCommit?: ((condition: HeldEventListMetricCondition) => void) | undefined;
  layout?: "inline" | "grid";
}) {
  const error = heldEventListMetricError(value);
  const update = (patch: Partial<HeldEventListMetricCondition>, commit: boolean) => {
    const next = { ...value, ...patch };
    onChange(next);
    if (commit) onCommit?.(next);
  };
  const cell = (width: string, wide = false) =>
    layout === "grid" ? cn("min-w-0", wide && "col-span-2") : width;

  return (
    <fieldset className="grid min-w-0 gap-2">
      <legend className={cn(contentText.heading, "mb-2")}>プレーヤーの開催成績</legend>
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
        <div className={cell("w-44", true)}>
          <SelectField
            label="指標"
            options={[{ label: "指定しない", value: "" }, ...heldEventListMetricOptions]}
            value={value.metric}
            onValueChange={(metric) =>
              update(
                metric === ""
                  ? { metric: "", value: "" }
                  : { metric: metric as HeldEventListMetric },
                true,
              )
            }
          />
        </div>
        <div className={cell("w-32")}>
          <TextField
            disabled={value.metric === ""}
            error={error}
            inputMode={value.metric === "average_rank" ? "decimal" : "numeric"}
            label="値"
            placeholder={value.metric === "average_rank" ? "例: 2.50" : undefined}
            textAlign="end"
            value={value.value}
            onBlur={() => onCommit?.(value)}
            onChange={(event) => update({ value: event.currentTarget.value }, false)}
            onKeyDown={onCommit ? commitOnEnter(() => onCommit(value)) : undefined}
          />
        </div>
        <div className={cell("w-28")}>
          <SelectField
            disabled={value.metric === ""}
            label="範囲"
            options={searchRangeOptions}
            value={value.range}
            onValueChange={(range) => update({ range: range as SearchRange }, true)}
          />
        </div>
      </div>
      <p className={contentText.supporting}>
        プレーヤーを選ばないと、4人のうち誰か1人でも当てはまる開催を探します。順位の回数は、開催内の確定試合で数えます。
      </p>
    </fieldset>
  );
}

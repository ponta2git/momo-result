import { RefreshCw } from "lucide-react";
import { useState } from "react";

import { qualitySummary } from "@/features/seriesComparison/model/seriesComparisonViewModel";
import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";
import { Button } from "@/shared/ui/actions/Button";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { SelectField } from "@/shared/ui/forms/SelectField";

type SelectOption = {
  label: string;
  value: string;
};

type SeriesComparisonScopeBarProps = {
  canRefresh: boolean;
  mapOptions: SelectOption[];
  mapValue: string;
  onMapChange: (value: string) => void;
  onRefresh: () => void;
  onSeasonChange: (value: string) => void;
  onSeriesChange: (value: string) => void;
  refreshing: boolean;
  response: SeriesComparisonResponse | undefined;
  scopeLabel: string;
  seasonOptions: SelectOption[];
  seasonValue: string;
  seriesOptions: SelectOption[];
  seriesValue: string;
};

function qualityLabel(response: SeriesComparisonResponse | undefined): string {
  if (!response) {
    return "集計を読み込み中";
  }
  const summary = qualitySummary(response);
  if (summary.referenceCount === 0 && summary.noTargetCount === 0) {
    return "読み取り目安: 十分";
  }
  return `参考 ${summary.referenceCount}項目・対象なし ${summary.noTargetCount}項目`;
}

export function SeriesComparisonScopeBar({
  canRefresh,
  mapOptions,
  mapValue,
  onMapChange,
  onRefresh,
  onSeasonChange,
  onSeriesChange,
  refreshing,
  response,
  scopeLabel,
  seasonOptions,
  seasonValue,
  seriesOptions,
  seriesValue,
}: SeriesComparisonScopeBarProps) {
  const [editorOpen, setEditorOpen] = useState(true);

  return (
    <Disclosure
      ariaLabel="比較条件"
      className="min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]"
      keepMounted
      open={editorOpen}
      panelClassName="grid gap-3 px-3 py-3"
      summary={
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-[var(--color-text-primary)]">
            {scopeLabel}
          </span>
          <span className="mt-0.5 block text-xs text-[var(--color-text-secondary)] tabular-nums">
            {response ? `${response.matchCount}戦` : "対戦数を確認中"} ・ {qualityLabel(response)}
          </span>
        </span>
      }
      triggerClassName="border-b border-[var(--color-border)]"
      onOpenChange={setEditorOpen}
    >
      <div className="grid gap-3 md:grid-cols-3">
        <SelectField
          label="対象作品"
          options={seriesOptions}
          value={seriesValue}
          onChange={(event) => onSeriesChange(event.currentTarget.value)}
        />
        <SelectField
          label="シーズン"
          options={seasonOptions}
          value={seasonValue}
          onChange={(event) => onSeasonChange(event.currentTarget.value)}
        />
        <SelectField
          label="マップ"
          options={mapOptions}
          value={mapValue}
          onChange={(event) => onMapChange(event.currentTarget.value)}
        />
      </div>
      <div className="border-t border-[var(--color-border)] pt-3 md:flex md:justify-end">
        <Button
          className="w-full md:w-auto"
          disabled={!canRefresh}
          icon={<RefreshCw className="size-4" />}
          pending={refreshing}
          pendingLabel="更新中"
          variant="secondary"
          onClick={onRefresh}
        >
          更新
        </Button>
      </div>
    </Disclosure>
  );
}

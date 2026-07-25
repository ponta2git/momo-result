import { ChevronDown, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { qualitySummary } from "@/features/seriesComparison/model/seriesComparisonViewModel";
import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";
import { Button } from "@/shared/ui/actions/Button";
import {
  CollapsiblePanel,
  CollapsibleRoot,
  CollapsibleTrigger,
} from "@/shared/ui/data/Collapsible";
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

function initialScopeEditorOpen(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true;
  }
  return window.matchMedia("(min-width: 768px)").matches;
}

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
  const [editorOpen, setEditorOpen] = useState(initialScopeEditorOpen);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const mediaQuery = window.matchMedia("(min-width: 768px)");
    const syncWithViewport = () => setEditorOpen(mediaQuery.matches);
    mediaQuery.addEventListener("change", syncWithViewport);
    return () => mediaQuery.removeEventListener("change", syncWithViewport);
  }, []);

  return (
    <CollapsibleRoot
      aria-label="比較条件"
      className="min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]"
      open={editorOpen}
      onOpenChange={setEditorOpen}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--color-border)] px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
            {scopeLabel}
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-text-secondary)] tabular-nums">
            {response ? `${response.matchCount}戦` : "対戦数を確認中"} ・ {qualityLabel(response)}
          </p>
        </div>
        <CollapsibleTrigger className="group inline-flex min-h-10 items-center gap-1.5 rounded-[var(--radius-xs)] px-2 text-sm font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-action)] md:hidden">
          条件を変更
          <ChevronDown
            aria-hidden="true"
            className="size-4 transition-transform group-data-[panel-open]:rotate-180 motion-reduce:transition-none"
          />
        </CollapsibleTrigger>
        <Button
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
      <CollapsiblePanel className="grid gap-3 px-3 py-3 md:grid-cols-3" keepMounted>
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
      </CollapsiblePanel>
    </CollapsibleRoot>
  );
}

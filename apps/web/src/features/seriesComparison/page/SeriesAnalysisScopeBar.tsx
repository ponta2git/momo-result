import { RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";

import type {
  SeriesComparisonAggregateV3,
  SeriesComparisonReviewV3,
} from "@/shared/api/seriesAnalysis";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { Button } from "@/shared/ui/actions/Button";
import { FilterBar } from "@/shared/ui/forms/FilterBar";
import { SelectField } from "@/shared/ui/forms/SelectField";

type SelectOption = { disabled?: boolean | undefined; label: string; value: string };
type SeriesAnalysisResourceSummary = Pick<
  SeriesComparisonAggregateV3 | SeriesComparisonReviewV3,
  "artifact" | "dataQuality" | "scope"
>;

export function SeriesAnalysisScopeBar({
  canRefresh,
  mapOptions,
  mapValue,
  onMapChange,
  onRefresh,
  onSeasonChange,
  onSeriesChange,
  refreshing,
  response,
  seasonOptions,
  seasonValue,
  seriesOptions,
  seriesValue,
}: {
  canRefresh: boolean;
  mapOptions: SelectOption[];
  mapValue: string;
  onMapChange: (value: string) => void;
  onRefresh: () => void;
  onSeasonChange: (value: string) => void;
  onSeriesChange: (value: string) => void;
  refreshing: boolean;
  response: SeriesAnalysisResourceSummary | undefined;
  seasonOptions: SelectOption[];
  seasonValue: string;
  seriesOptions: SelectOption[];
  seriesValue: string;
}) {
  const [open, setOpen] = useState(false);
  const quality = response?.dataQuality.summary;
  const qualityAdvisories = quality
    ? [
        quality.referenceCount > 0 ? `参考値 ${quality.referenceCount}項目` : null,
        quality.noTargetCount > 0 ? `対象なし ${quality.noTargetCount}項目` : null,
      ].filter((entry): entry is string => entry !== null)
    : [];
  const detailFilterLabels = [
    seasonValue
      ? `シーズン ${seasonOptions.find((option) => option.value === seasonValue)?.label ?? "選択中"}`
      : null,
    mapValue
      ? `マップ ${mapOptions.find((option) => option.value === mapValue)?.label ?? "選択中"}`
      : null,
  ].filter((entry): entry is string => entry !== null);

  const scopeSummary = (
    <span className="block min-w-0">
      {detailFilterLabels.length > 0 ? (
        <span className="block truncate font-medium text-[var(--color-text-primary)]">
          {detailFilterLabels.join("・")}
        </span>
      ) : null}
      <span
        className={`${detailFilterLabels.length > 0 ? "mt-0.5" : ""} block text-[var(--color-text-secondary)] tabular-nums`}
      >
        {response ? `${response.scope.matchCount}戦` : "対戦数を確認中"}
        {qualityAdvisories.length > 0 ? (
          <span className="ml-2 inline-flex items-center gap-1 font-semibold text-[var(--color-text-primary)]">
            {quality && quality.referenceCount > 0 ? (
              <TriangleAlert
                aria-hidden="true"
                className="size-3.5 shrink-0 text-[var(--color-warning)]"
              />
            ) : null}
            {qualityAdvisories.join("・")}
          </span>
        ) : null}
      </span>
    </span>
  );

  return (
    <FilterBar
      action={
        <div className="grid w-full sm:w-auto">
          <Button
            disabled={!canRefresh}
            icon={<RefreshCw />}
            pending={refreshing}
            pendingLabel="表示を更新中"
            size="sm"
            variant="secondary"
            onClick={onRefresh}
          >
            表示を更新
          </Button>
        </div>
      }
      ariaLabel="比較条件"
      busy={refreshing}
      details={{
        columns: 2,
        controls: (
          <>
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
          </>
        ),
        label: "比較対象を変更",
        onOpenChange: setOpen,
        open,
        summary: scopeSummary,
      }}
      primary={
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)] sm:items-end">
          <div className="min-w-0">
            <SelectField
              label="対象作品"
              options={seriesOptions}
              value={seriesValue}
              onChange={(event) => onSeriesChange(event.currentTarget.value)}
            />
          </div>
          <span className="text-xs text-[var(--color-text-secondary)] tabular-nums sm:pb-2">
            {response
              ? `最終更新 ${formatDateTimeLong(response.artifact.publishedAt)}`
              : "分析結果を読み込みます"}
          </span>
        </div>
      }
    />
  );
}

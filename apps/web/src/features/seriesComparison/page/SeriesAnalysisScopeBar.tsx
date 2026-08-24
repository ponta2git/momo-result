import { RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";

import type {
  SeriesComparisonAggregateV3,
  SeriesComparisonReviewV3,
} from "@/shared/api/seriesAnalysis";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { useMediaQuery } from "@/shared/lib/useMediaQuery";
import { Button } from "@/shared/ui/actions/Button";
import { Disclosure } from "@/shared/ui/data/Collapsible";
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
  scopeLabel,
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
  scopeLabel: string;
  seasonOptions: SelectOption[];
  seasonValue: string;
  seriesOptions: SelectOption[];
  seriesValue: string;
}) {
  const wideViewport = useMediaQuery("(min-width: 768px)");
  const responsiveViewportAvailable =
    typeof window !== "undefined" && typeof window.matchMedia === "function";
  const [openOverride, setOpenOverride] = useState<boolean>();
  const open = openOverride ?? (!responsiveViewportAvailable || wideViewport);
  const quality = response?.dataQuality.summary;
  const qualityAdvisories = quality
    ? [
        quality.referenceCount > 0 ? `参考値 ${quality.referenceCount}項目` : null,
        quality.noTargetCount > 0 ? `対象なし ${quality.noTargetCount}項目` : null,
      ].filter((entry): entry is string => entry !== null)
    : [];
  return (
    <Disclosure
      ariaLabel="比較条件"
      className="min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]"
      keepMounted
      open={open}
      panelClassName="grid gap-3 px-3 py-3"
      summary={
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-[var(--color-text-primary)]">
            {scopeLabel}
          </span>
          <span className="mt-0.5 block text-xs text-[var(--color-text-secondary)] tabular-nums">
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
      }
      triggerClassName="border-b border-[var(--color-border)] bg-[var(--color-surface-subtle)] hover:bg-[var(--color-surface-selected)]"
      onOpenChange={setOpenOverride}
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
      <div className="flex flex-col gap-2 border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-text-secondary)] sm:flex-row sm:items-center sm:justify-between">
        <span>
          {response
            ? `最終更新 ${formatDateTimeLong(response.artifact.publishedAt)}`
            : "分析結果を読み込みます"}
        </span>
        <Button
          className="w-full sm:w-auto"
          disabled={!canRefresh}
          icon={<RefreshCw className="size-4" />}
          pending={refreshing}
          pendingLabel="再読み込み中"
          variant="secondary"
          onClick={onRefresh}
        >
          表示を再読み込み
        </Button>
      </div>
    </Disclosure>
  );
}

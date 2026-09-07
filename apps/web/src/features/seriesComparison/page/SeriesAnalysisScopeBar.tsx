import { RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";

import type {
  SeriesComparisonAggregateV3,
  SeriesComparisonReviewV3,
} from "@/shared/api/seriesAnalysis";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { contentText, fieldText } from "@/shared/ui/typography";

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
  seriesOptions: Array<SelectOption & { summaryLabel?: string | undefined }>;
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

  const selectedSeries = seriesOptions.find((option) => option.value === seriesValue);

  return (
    <section
      aria-busy={refreshing || undefined}
      aria-label="比較条件"
      className="grid min-w-0 gap-2"
    >
      <Disclosure
        keepMounted
        ariaLabel="比較対象を変更"
        open={open}
        panelPadding="sm"
        summary={
          <span className="grid gap-1">
            <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className={fieldText.label}>
                {selectedSeries?.summaryLabel ?? selectedSeries?.label ?? "対象作品を選択"}
              </span>
              <span className={cn(contentText.supporting, "tabular-nums")}>
                {response ? `${response.scope.matchCount}戦` : "対戦数を確認中"}
              </span>
              {detailFilterLabels.length > 0 ? (
                <span className={contentText.supporting}>{detailFilterLabels.join("・")}</span>
              ) : null}
              {qualityAdvisories.length > 0 ? (
                <span className="inline-flex items-center gap-1 text-xs text-[var(--color-text-primary)]">
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
            <span className={contentText.supporting}>比較対象を変更</span>
          </span>
        }
        triggerLayout="flush-horizontal"
        triggerVariant="supporting"
        onOpenChange={setOpen}
      >
        <div className="grid gap-4 sm:grid-cols-3">
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
      </Disclosure>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={cn(contentText.supporting, "tabular-nums")}>
          {response
            ? `最終更新 ${formatDateTimeLong(response.artifact.publishedAt)}`
            : "分析結果を読み込みます"}
        </span>
        <Button
          disabled={!canRefresh}
          icon={<RefreshCw />}
          pending={refreshing}
          pendingLabel="表示を更新中"
          size="sm"
          variant="quiet"
          onClick={onRefresh}
        >
          表示を更新
        </Button>
      </div>
    </section>
  );
}

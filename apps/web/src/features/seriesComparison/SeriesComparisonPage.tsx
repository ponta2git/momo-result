import { BarChart3, RefreshCw } from "lucide-react";

import { SeriesComparisonContent } from "@/features/seriesComparison/SeriesComparisonContent";
import { ComparisonSkeleton, PageSkeleton } from "@/features/seriesComparison/SeriesComparisonSkeletons";
import { useSeriesComparisonPageController } from "@/features/seriesComparison/useSeriesComparisonPageController";
import { Button } from "@/shared/ui/actions/Button";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";
import { StaleShield } from "@/shared/ui/motion/StaleShield";

export function SeriesComparisonPage() {
  const controller = useSeriesComparisonPageController();

  if (controller.optionsLoading) {
    return <PageSkeleton />;
  }

  const seriesOptions = (controller.options?.series ?? []).map((series) => ({
    label: `${series.name} (${series.confirmedMatchCount}戦)`,
    value: series.gameTitleId,
  }));
  const seasonOptions = [
    { label: "全シーズン", value: "" },
    ...controller.seasonOptions.map((option) => ({
      label: option.name,
      value: option.id,
    })),
  ];
  const mapOptions = [
    { label: "全マップ", value: "" },
    ...controller.mapOptions.map((option) => ({
      label: option.name,
      value: option.id,
    })),
  ];

  return (
    <PageFrame className="gap-5" width="wide">
      <PageHeader
        actions={
          <Button
            disabled={!controller.canRefresh}
            icon={<RefreshCw className="size-4" />}
            pending={controller.aggregateRefreshing || controller.reviewRefreshing}
            pendingLabel="更新中"
            variant="secondary"
            onClick={controller.refresh}
          >
            更新
          </Button>
        }
        description="確定済みの試合から、順位、総資産、物件収益、目的地到着、スリの銀次を比べます。"
        eyebrow="分析"
        title="戦績比較"
      />

      {controller.hasOptionsError ? (
        <Notice tone="danger" title="対象作品を読み込めません">
          通信状態を確認して、再読み込みしてください。
        </Notice>
      ) : null}

      {seriesOptions.length === 0 && !controller.hasOptionsError ? (
        <EmptyState
          icon={<BarChart3 className="size-5" />}
          title="比較できる戦績がありません"
          description="確定済みの試合が揃うと比較できます。"
        />
      ) : seriesOptions.length > 0 ? (
        <>
          <section className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_minmax(12rem,1fr)] md:items-end">
            <div className="min-w-0 md:col-span-3">
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">表示範囲</h2>
              <p className="mt-1 text-xs leading-5 text-pretty text-[var(--color-text-secondary)]">
                シーズンとマップを同時に絞れます。対象作品の切り替えは過去作品を見るときに使います。
              </p>
            </div>
            <SelectField
              label="シーズン"
              options={seasonOptions}
              value={controller.state.seasonMasterId ?? ""}
              onChange={(event) => controller.updateSeasonMasterId(event.currentTarget.value)}
            />
            <SelectField
              label="マップ"
              options={mapOptions}
              value={controller.state.mapMasterId ?? ""}
              onChange={(event) => controller.updateMapMasterId(event.currentTarget.value)}
            />
            <SelectField
              label="対象作品"
              options={seriesOptions}
              value={controller.state.gameTitleId ?? ""}
              onChange={(event) => controller.updateGameTitle(event.currentTarget.value)}
            />
          </section>

          {controller.hasAggregateError ? (
            <Notice tone="danger" title="戦績データを読み込めません">
              条件を変えるか、時間をおいて再読み込みしてください。
            </Notice>
          ) : (
            <StaleShield
              active={controller.aggregateLoading || controller.aggregateShielded}
              contentClassName="grid gap-5"
              fallback={<ComparisonSkeleton />}
            >
              {controller.aggregate && controller.aggregate.matchCount === 0 ? (
                <EmptyState
                  icon={<BarChart3 className="size-5" />}
                  title="この範囲に確定済みの試合がありません"
                  description="総合、別シーズン、別マップを選ぶと表示できる場合があります。"
                />
              ) : controller.aggregate ? (
                <SeriesComparisonContent controller={controller} />
              ) : null}
            </StaleShield>
          )}
        </>
      ) : null}
    </PageFrame>
  );
}

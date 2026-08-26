import { ArrowLeft } from "lucide-react";

import { MatchDetailIdentity } from "@/features/matches/MatchDetailIdentity";
import { MatchDetailResultsTable } from "@/features/matches/MatchDetailResultsTable";
import {
  MatchDetailLoadFailed,
  MatchDetailLoading,
} from "@/features/matches/MatchDetailStatusViews";
import { MatchFeatureSection } from "@/features/matches/MatchFeatureSection";
import { MatchRecordMetadata } from "@/features/matches/MatchRecordMetadata";
import { MatchSeriesComparisonCta } from "@/features/matches/MatchSeriesComparisonCta";
import { useMatchDetailPageController } from "@/features/matches/useMatchDetailPageController";
import { formatMatchNoInEvent, formatSeriesMatchIndex } from "@/shared/domain/matchLabels";
import { memberDisplayName } from "@/shared/domain/members";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { MatchResultLedger } from "@/shared/ui/data/MatchResultLedger";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

type MatchDetailReadyController = Extract<
  ReturnType<typeof useMatchDetailPageController>,
  { status: "ready" }
>;

export function MatchDetailPage() {
  const controller = useMatchDetailPageController();

  if (controller.status === "loading") {
    return <MatchDetailLoading />;
  }

  if (controller.status === "notFound") {
    return <MatchDetailLoadFailed backHref={controller.backHref} notFound />;
  }

  if (controller.status === "loadFailed") {
    return (
      <MatchDetailLoadFailed
        backHref={controller.backHref}
        retrying={controller.refreshing}
        onRetry={controller.refresh}
      />
    );
  }

  return <MatchDetailReadyContent controller={controller} />;
}

function MatchDetailReadyContent({ controller }: { controller: MatchDetailReadyController }) {
  const {
    comparisonContextStatus,
    comparisonHref,
    backHref,
    backLabel,
    confirmDelete,
    errorMessage,
    editHref,
    exportHref,
    featureView,
    gameTitle,
    heldAt,
    isDeletePending,
    map,
    match,
    performanceContext,
    players,
    season,
    setShowConfirm,
    setSortKey,
    showConfirm,
    sort,
  } = controller;
  const ledgerRows = (
    performanceContext?.rows ??
    (match.players ?? []).map((player) => ({
      memberId: player.memberId,
      rank: player.rank,
      revenueManYen: player.revenueManYen,
      totalAssetsManYen: player.totalAssetsManYen,
      trend: "unavailable" as const,
    }))
  ).map((row) => Object.assign({ displayName: memberDisplayName(row.memberId) }, row));

  return (
    <PageFrame className="min-w-0" width="wide">
      <div>
        <LinkButton
          icon={<ArrowLeft aria-hidden="true" className="size-4" />}
          size="sm"
          to={backHref}
          variant="quiet"
        >
          {backLabel}
        </LinkButton>
      </div>
      <PageHeader
        title={`${formatMatchNoInEvent(match.matchNoInEvent)}の結果`}
        actions={
          <>
            <LinkButton to={exportHref} variant="secondary">
              この試合を出力
            </LinkButton>
            <LinkButton to={editHref} variant="secondary">
              編集
            </LinkButton>
          </>
        }
      />

      <PageContentSurface className="grid gap-8">
        <div className="grid gap-4">
          <MatchDetailIdentity
            gameTitleName={gameTitle?.name}
            heldAt={heldAt}
            mapName={map?.name}
            matchNoInEvent={match.matchNoInEvent}
            seasonName={season?.name}
          />
          <MatchFeatureSection view={featureView} />
        </div>

        <section aria-labelledby="match-result-ledger-heading" className="grid w-full gap-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2
                className="text-base font-semibold text-[var(--color-text-primary)]"
                id="match-result-ledger-heading"
              >
                順位・総資産
              </h2>
              <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                物件収益と、この試合による通算平均順位の変化も併記しています。
              </p>
            </div>
            {performanceContext ? (
              <p className="shrink-0 text-xs font-semibold text-[var(--color-text-secondary)] tabular-nums">
                同条件内 {formatSeriesMatchIndex(performanceContext.matchIndex)}
              </p>
            ) : null}
          </div>
          <MatchResultLedger contextStatus={comparisonContextStatus} rows={ledgerRows} />
          <MatchSeriesComparisonCta href={comparisonHref} />
        </section>

        <section className="grid gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">成績詳細</h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              列見出しで並び替えできます。
            </p>
          </div>
          <MatchDetailResultsTable players={players} setSortKey={setSortKey} sort={sort} />
        </section>

        <MatchRecordMetadata
          confirmDelete={confirmDelete}
          errorMessage={errorMessage}
          isDeletePending={isDeletePending}
          match={match}
          setShowConfirm={setShowConfirm}
          showConfirm={showConfirm}
        />
      </PageContentSurface>
    </PageFrame>
  );
}

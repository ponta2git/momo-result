import { ArrowLeft } from "lucide-react";
import { useParams } from "react-router-dom";

import { MatchDetailIdentity } from "@/features/matches/MatchDetailIdentity";
import type { MatchDetailReadyPageModel } from "@/features/matches/matchDetailPageModel";
import { MatchDetailResultsTable } from "@/features/matches/MatchDetailResultsTable";
import {
  MatchDetailLoadFailed,
  MatchDetailLoading,
} from "@/features/matches/MatchDetailStatusViews";
import { MatchFeatureSection } from "@/features/matches/MatchFeatureSection";
import { MatchNoteSection } from "@/features/matches/MatchNoteSection";
import { MatchRecordMetadata } from "@/features/matches/MatchRecordMetadata";
import { MatchSeriesComparisonCta } from "@/features/matches/MatchSeriesComparisonCta";
import { useMatchDetailPageModel } from "@/features/matches/useMatchDetailPageModel";
import { formatMatchNoInEvent, formatSeriesMatchIndex } from "@/shared/domain/matchLabels";
import { memberDisplayName } from "@/shared/domain/members";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { MatchResultLedger } from "@/shared/ui/data/MatchResultLedger";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

export function MatchDetailPage() {
  const { matchId = "" } = useParams<{ matchId: string }>();
  return <MatchDetailScreen key={matchId} />;
}

function MatchDetailScreen() {
  const page = useMatchDetailPageModel();

  if (page.kind === "loading") {
    return <MatchDetailLoading />;
  }

  if (page.kind === "notFound") {
    return <MatchDetailLoadFailed backHref={page.navigation.backHref} notFound />;
  }

  if (page.kind === "loadFailed") {
    return (
      <MatchDetailLoadFailed
        backHref={page.navigation.backHref}
        retrying={page.refresh.pending}
        onRetry={page.refresh.run}
      />
    );
  }

  return <MatchDetailReadyContent page={page} />;
}

function MatchDetailReadyContent({ page }: { page: MatchDetailReadyPageModel }) {
  const { analysis, deletion, enrichment, identity, match, navigation, note, results } = page;
  const ledgerRows = (
    analysis.performanceContext?.rows ??
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
          to={navigation.backHref}
          variant="quiet"
        >
          {navigation.backLabel}
        </LinkButton>
      </div>
      <PageHeader
        title={`${formatMatchNoInEvent(match.matchNoInEvent)}の結果`}
        actions={
          <>
            <LinkButton to={navigation.exportHref} variant="secondary">
              この試合を出力
            </LinkButton>
            <LinkButton to={navigation.editHref} variant="secondary">
              編集
            </LinkButton>
          </>
        }
      />

      <PageContentSurface className="grid gap-8">
        {enrichment.kind === "warning" ? (
          <Notice
            action={
              <Button
                pending={enrichment.refresh.pending}
                pendingLabel="再取得中"
                size="sm"
                variant="secondary"
                onClick={enrichment.refresh.run}
              >
                開催条件を再取得
              </Button>
            }
            tone="warning"
            title="開催条件を取得できませんでした"
          >
            {enrichment.fields.join("・")}
            を取得できませんでした。試合結果はそのまま表示し、取得できない項目だけ「未取得」と表示しています。
          </Notice>
        ) : null}

        <div className="grid gap-4">
          <MatchDetailIdentity
            gameTitle={identity.gameTitle}
            heldAt={identity.heldAt}
            map={identity.map}
            matchNoInEvent={match.matchNoInEvent}
            season={identity.season}
          />
          <MatchFeatureSection
            needsManualRefresh={analysis.needsManualRefresh}
            refresh={analysis.refresh}
            view={analysis.featureView}
          />
        </div>

        <section aria-labelledby="match-result-ledger-heading" className="grid w-full gap-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
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
            {analysis.performanceContext ? (
              <p className="shrink-0 text-xs font-semibold text-[var(--color-text-secondary)] tabular-nums">
                同条件内 {formatSeriesMatchIndex(analysis.performanceContext.matchIndex)}
              </p>
            ) : null}
          </div>
          <MatchResultLedger contextStatus={analysis.comparisonContextStatus} rows={ledgerRows} />
          <MatchSeriesComparisonCta href={navigation.comparisonHref} />
        </section>

        <section className="grid gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">成績詳細</h2>
            <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
              列見出しで並び替えできます。画面幅が狭い場合は横にスクロールして確認できます。
            </p>
          </div>
          <MatchDetailResultsTable
            players={results.players}
            setSortKey={results.setSortKey}
            sort={results.sort}
          />
        </section>

        <MatchNoteSection match={match} refetchMatch={note.refetchMatch} />

        <MatchRecordMetadata
          confirmDelete={deletion.confirm}
          errorMessage={deletion.errorMessage}
          isDeletePending={deletion.pending}
          match={match}
          setShowConfirm={deletion.setOpen}
          showConfirm={deletion.open}
        />
      </PageContentSurface>
    </PageFrame>
  );
}

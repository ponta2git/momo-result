import { ArrowLeft } from "lucide-react";
import { useParams } from "react-router-dom";

import { MatchDetailIdentity } from "@/features/matches/MatchDetailIdentity";
import type { MatchDetailReadyPageModel } from "@/features/matches/matchDetailPageModel";
import {
  MatchDetailLoadFailed,
  MatchDetailLoading,
} from "@/features/matches/MatchDetailStatusViews";
import { MatchFeatureSection } from "@/features/matches/MatchFeatureSection";
import { MatchNoteSection } from "@/features/matches/MatchNoteSection";
import { MatchRecordMetadata } from "@/features/matches/MatchRecordMetadata";
import { useMatchDetailPageModel } from "@/features/matches/useMatchDetailPageModel";
import { incidentColumns } from "@/shared/domain/incidents";
import { formatMatchNoInEvent, formatSeriesMatchIndex } from "@/shared/domain/matchLabels";
import { memberDisplayName } from "@/shared/domain/members";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { MatchResultLedger } from "@/shared/ui/data/MatchResultLedger";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";
import { contentText } from "@/shared/ui/typography";

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
  const { analysis, deletion, enrichment, identity, match, navigation, note } = page;
  const ledgerRows = (
    analysis.performanceContext?.rows ??
    (match.players ?? []).map((player) => ({
      memberId: player.memberId,
      rank: player.rank,
      revenueManYen: player.revenueManYen,
      totalAssetsManYen: player.totalAssetsManYen,
      trend: "unavailable" as const,
    }))
  ).map((row) => {
    const player = match.players?.find((candidate) => candidate.memberId === row.memberId);
    return Object.assign({}, row, {
      displayName: memberDisplayName(row.memberId),
      playOrder: player?.playOrder,
      details: player ? (
        <dl
          aria-label={`${memberDisplayName(row.memberId)}の事件簿`}
          className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,5rem),1fr))] gap-2"
        >
          {incidentColumns.map(([key, label]) => (
            <div key={key} className="min-w-0">
              <dt className={contentText.supporting}>{label}</dt>
              <dd className={cn(contentText.body, "mt-1 tabular-nums")}>
                {player.incidents[key]}回
              </dd>
            </div>
          ))}
        </dl>
      ) : null,
    });
  });

  return (
    <PageFrame className="min-w-0" width="wide">
      <div>
        <LinkButton
          icon={<ArrowLeft aria-hidden="true" />}
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

      <PageContentSurface className="grid gap-6">
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
          <MatchFeatureSection badges={analysis.badges} />
        </div>

        <section aria-labelledby="match-result-ledger-heading" className="grid w-full gap-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className={contentText.heading} id="match-result-ledger-heading">
                順位・総資産
              </h2>
              <p className={cn(contentText.supporting, "mt-1")}>
                通算平均順位は、同じ作品・シーズン・マップの初戦から集計しています（この試合の前 →
                後）。
              </p>
            </div>
            {analysis.performanceContext ? (
              <p className={cn(contentText.supporting, "shrink-0 tabular-nums")}>
                同条件内 {formatSeriesMatchIndex(analysis.performanceContext.matchIndex)}
              </p>
            ) : null}
          </div>
          <MatchResultLedger contextStatus={analysis.comparisonContextStatus} rows={ledgerRows} />
          <div className="flex justify-end">
            <LinkButton to={navigation.comparisonHref} variant="secondary">
              前後の戦績を見る
            </LinkButton>
          </div>
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

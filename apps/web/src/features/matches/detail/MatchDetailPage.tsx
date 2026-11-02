import { ArrowLeft, Download, PenSquare } from "lucide-react";
import type { Ref } from "react";
import { useParams } from "react-router-dom";

import { MatchAchievements } from "@/features/matches/detail/MatchAchievements";
import { MatchDetailAdjacentNavigation } from "@/features/matches/detail/MatchDetailAdjacentNavigation";
import { MatchDetailIdentity } from "@/features/matches/detail/MatchDetailIdentity";
import { matchIncidentFactsGridClass } from "@/features/matches/detail/matchDetailPresentation";
import {
  MatchDetailLoadFailed,
  MatchDetailLoading,
} from "@/features/matches/detail/MatchDetailStatusViews";
import type { MatchDetailReadyView } from "@/features/matches/detail/matchDetailView";
import { MatchFeatureSection } from "@/features/matches/detail/MatchFeatureSection";
import { MatchRecordMetadata } from "@/features/matches/detail/MatchRecordMetadata";
import { useMatchDetail } from "@/features/matches/detail/useMatchDetail";
import {
  MatchNoteProvider,
  MatchNotePanel,
  MatchNoteRecoveryPanel,
  useMatchDeletionRestriction,
} from "@/features/matches/note/MatchNoteProvider";
import { incidentColumns } from "@/shared/domain/incidents";
import { formatMatchNoInEvent, formatSeriesMatchIndex } from "@/shared/domain/matchLabels";
import { MatchResultLedger } from "@/shared/matches/MatchResultLedger";
import { useAdjacentNavigationFocus } from "@/shared/navigation/useAdjacentNavigationFocus";
import { inlineActionGroupClass } from "@/shared/ui/actions/actionGroup";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";
import { contentText } from "@/shared/ui/typography";

export function MatchDetailPage() {
  const { matchId = "", publicId } = useParams<{ matchId: string; publicId: string }>();
  return (
    <MatchDetailScreen key={publicId === undefined ? `legacy:${matchId}` : `public:${publicId}`} />
  );
}

function MatchDetailScreen() {
  const view = useMatchDetail();
  const titleRef = useAdjacentNavigationFocus(view.kind !== "loading");

  return (
    <MatchNoteProvider source={view.noteSource}>
      {view.kind === "loading" ? (
        <MatchDetailLoading />
      ) : view.kind === "ready" ? (
        <MatchDetailReadyContent view={view} titleRef={titleRef} />
      ) : (
        <MatchDetailLoadFailed
          notFound={view.kind === "notFound"}
          retrying={view.refresh.pending}
          onRetry={view.refresh.run}
          titleRef={titleRef}
          recovery={<MatchNoteRecoveryPanel />}
        />
      )}
    </MatchNoteProvider>
  );
}

function MatchDetailReadyContent({
  view,
  titleRef,
}: {
  view: MatchDetailReadyView;
  titleRef: Ref<HTMLHeadingElement>;
}) {
  const { analysis, identity, match, navigation } = view;
  const ledgerRows = view.ledgerRows.map(({ incidents, ...row }) => ({
    ...row,
    details: incidents ? (
      <dl aria-label={`${row.displayName}の事件簿`} className={matchIncidentFactsGridClass}>
        {incidentColumns.map(([key, label]) => (
          <div key={key} className="min-w-0">
            <dt className={contentText.supporting}>{label}</dt>
            <dd className={cn(contentText.body, "mt-0.5 tabular-nums")}>{incidents[key]}回</dd>
          </div>
        ))}
      </dl>
    ) : null,
  }));

  return (
    <PageFrame className="min-w-0" width="analysis">
      <div>
        <LinkButton
          icon={<ArrowLeft aria-hidden="true" />}
          to={navigation.heldEventHref}
          size="sm"
          variant="quiet"
        >
          この試合の開催を見る
        </LinkButton>
      </div>
      <PageHeader
        title={`${formatMatchNoInEvent(match.matchNoInEvent)}の結果`}
        titleRef={titleRef}
        titleDescriptionId="match-detail-identity"
        actions={
          <nav aria-label="この試合の関連操作" className={inlineActionGroupClass}>
            <LinkButton
              icon={<Download aria-hidden="true" />}
              size="sm"
              to={navigation.exportHref}
              variant="quiet"
            >
              この試合を出力
            </LinkButton>
            <LinkButton
              icon={<PenSquare aria-hidden="true" />}
              size="sm"
              to={navigation.editHref}
              variant="secondary"
            >
              試合結果を編集
            </LinkButton>
          </nav>
        }
      />

      <PageContentSurface className="grid gap-6">
        <div className="grid gap-4">
          <MatchDetailIdentity
            id="match-detail-identity"
            gameTitle={identity.gameTitle}
            heldAt={identity.heldAt}
            map={identity.map}
            matchNoInEvent={match.matchNoInEvent}
            season={identity.season}
          />
          <MatchFeatureSection badges={analysis.badges} loading={analysis.contextPending} />
        </div>

        <section aria-labelledby="match-result-ledger-heading" className="grid w-full gap-4">
          <div className="grid gap-2">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="grid min-w-0 flex-[1_1_16rem] gap-1">
                <h2 className={contentText.heading} id="match-result-ledger-heading">
                  順位・総資産
                </h2>
                <p className={contentText.supporting}>
                  通算平均順位は、同じ作品・シーズン・マップの初戦から集計しています（この試合の前 →
                  後）。
                </p>
              </div>
              {analysis.contextPending ? (
                <Skeleton as="span" className="block h-4 w-24 shrink-0" />
              ) : analysis.performanceContext ? (
                <p className={cn(contentText.supporting, "shrink-0 tabular-nums")}>
                  同条件内 {formatSeriesMatchIndex(analysis.performanceContext.matchIndex)}
                </p>
              ) : null}
            </div>
            <MatchResultLedger contextStatus={analysis.comparisonContextStatus} rows={ledgerRows} />
          </div>
          <div className="flex justify-end">
            <LinkButton to={navigation.comparisonHref} size="sm" variant="secondary">
              前後の戦績を見る
            </LinkButton>
          </div>
        </section>

        <MatchAchievements
          matchId={match.matchId}
          gameTitleId={match.gameTitleId}
          heldEventId={match.heldEventId}
        />
        <MatchNotePanel />

        <MatchDetailRecordActions view={view} />
      </PageContentSurface>

      <MatchDetailAdjacentNavigation view={view} />
    </PageFrame>
  );
}

function MatchDetailRecordActions({ view }: { view: MatchDetailReadyView }) {
  const restriction = useMatchDeletionRestriction();
  const { deletion, match } = view;
  return (
    <MatchRecordMetadata
      confirmDelete={deletion.confirm}
      deleteDisabledReason={restriction}
      errorMessage={deletion.errorMessage}
      isDeletePending={deletion.pending}
      match={match}
      setShowConfirm={deletion.setOpen}
      showConfirm={deletion.open}
    />
  );
}

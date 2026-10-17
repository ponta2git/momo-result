import { Download, PenSquare } from "lucide-react";
import type { Ref } from "react";
import { useParams } from "react-router-dom";

import { MatchDetailAdjacentNavigation } from "@/features/matches/detail/MatchDetailAdjacentNavigation";
import { MatchDetailIdentity } from "@/features/matches/detail/MatchDetailIdentity";
import type { MatchDetailReadyPageModel } from "@/features/matches/detail/matchDetailPageModel";
import {
  MatchDetailLoadFailed,
  MatchDetailLoading,
} from "@/features/matches/detail/MatchDetailStatusViews";
import { MatchFeatureSection } from "@/features/matches/detail/MatchFeatureSection";
import { MatchRecordMetadata } from "@/features/matches/detail/MatchRecordMetadata";
import { useMatchDetailPageModel } from "@/features/matches/detail/useMatchDetailPageModel";
import {
  MatchNoteProvider,
  MatchNotePanel,
  MatchNoteRecoveryPanel,
  useMatchDeletionRestriction,
} from "@/features/matches/note/MatchNoteProvider";
import { incidentColumns } from "@/shared/domain/incidents";
import { formatMatchNoInEvent, formatSeriesMatchIndex } from "@/shared/domain/matchLabels";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { MatchResultLedger } from "@/shared/matches/MatchResultLedger";
import { useAdjacentNavigationFocus } from "@/shared/navigation/useAdjacentNavigationFocus";
import { inlineActionGroupClass } from "@/shared/ui/actions/actionGroup";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
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
  const titleRef = useAdjacentNavigationFocus(page.kind !== "loading");

  return (
    <MatchNoteProvider source={page.noteSource}>
      {page.kind === "loading" ? (
        <MatchDetailLoading />
      ) : page.kind === "ready" ? (
        <MatchDetailReadyContent page={page} titleRef={titleRef} />
      ) : (
        <MatchDetailLoadFailed
          notFound={page.kind === "notFound"}
          retrying={page.refresh.pending}
          onRetry={page.refresh.run}
          titleRef={titleRef}
          recovery={<MatchNoteRecoveryPanel />}
        />
      )}
    </MatchNoteProvider>
  );
}

function MatchDetailReadyContent({
  page,
  titleRef,
}: {
  page: MatchDetailReadyPageModel;
  titleRef: Ref<HTMLHeadingElement>;
}) {
  const { analysis, identity, match, navigation } = page;
  const ledgerRows = page.ledgerRows.map(({ incidents, ...row }) => ({
    ...row,
    details: incidents ? (
      <dl
        aria-label={`${row.displayName}の事件簿`}
        className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,5rem),1fr))] gap-2"
      >
        {incidentColumns.map(([key, label]) => (
          <div key={key} className="min-w-0">
            <dt className={contentText.supporting}>{label}</dt>
            <dd className={cn(contentText.body, "mt-1 tabular-nums")}>{incidents[key]}回</dd>
          </div>
        ))}
      </dl>
    ) : null,
  }));

  return (
    <PageFrame className="min-w-0" width="wide">
      <div>
        <LinkButton to={navigation.heldEventHref} size="sm" variant="quiet">
          この試合の開催を見る
        </LinkButton>
      </div>
      <PageHeader
        title={`${formatMatchNoInEvent(match.matchNoInEvent)}の結果`}
        titleRef={titleRef}
        titleDescriptionId="match-current-datetime"
        description={
          <span id="match-current-datetime">対戦日時 {formatDateTimeLong(match.playedAt)}</span>
        }
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
            gameTitle={identity.gameTitle}
            heldAt={identity.heldAt}
            map={identity.map}
            matchNoInEvent={match.matchNoInEvent}
            season={identity.season}
          />
          <MatchFeatureSection badges={analysis.badges} />
        </div>

        <section aria-labelledby="match-result-ledger-heading" className="grid w-full gap-4">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0 flex-[1_1_16rem]">
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

        <MatchNotePanel />

        <MatchDetailRecordActions page={page} />
      </PageContentSurface>

      <MatchDetailAdjacentNavigation page={page} />
    </PageFrame>
  );
}

function MatchDetailRecordActions({ page }: { page: MatchDetailReadyPageModel }) {
  const restriction = useMatchDeletionRestriction();
  const { deletion, match } = page;
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

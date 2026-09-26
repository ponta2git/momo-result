import { ArrowLeft, Download, PenSquare } from "lucide-react";
import type { Ref } from "react";
import { useParams } from "react-router-dom";

import { MatchDetailAdjacentNavigation } from "@/features/matches/MatchDetailAdjacentNavigation";
import { MatchDetailIdentity } from "@/features/matches/MatchDetailIdentity";
import type { MatchDetailReadyPageModel } from "@/features/matches/matchDetailPageModel";
import {
  MatchDetailLoadFailed,
  MatchDetailLoading,
} from "@/features/matches/MatchDetailStatusViews";
import { MatchFeatureSection } from "@/features/matches/MatchFeatureSection";
import {
  MatchNoteSection,
  MatchNoteNavigationGuard,
  MatchNoteRecovery,
} from "@/features/matches/MatchNoteSection";
import { MatchRecordMetadata } from "@/features/matches/MatchRecordMetadata";
import { useMatchDetailPageModel } from "@/features/matches/useMatchDetailPageModel";
import { useMatchNoteEditor } from "@/features/matches/useMatchNoteEditor";
import type { MatchNoteEditor } from "@/features/matches/useMatchNoteEditor";
import { incidentColumns } from "@/shared/domain/incidents";
import { formatMatchNoInEvent, formatSeriesMatchIndex } from "@/shared/domain/matchLabels";
import { memberDisplayName } from "@/shared/domain/members";
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
  const editor = useMatchNoteEditor({
    matchId: page.matchId,
    match: page.kind === "ready" ? page.match : undefined,
    ...page.note,
  });
  const titleRef = useAdjacentNavigationFocus(page.kind !== "loading");

  return (
    <>
      <MatchNoteNavigationGuard editor={editor} />
      {page.kind === "loading" ? (
        <MatchDetailLoading />
      ) : page.kind === "ready" ? (
        <MatchDetailReadyContent page={page} editor={editor} titleRef={titleRef} />
      ) : (
        <MatchDetailLoadFailed
          backHref={page.navigation.backHref}
          backLabel={page.navigation.backLabel}
          backNotice={page.navigation.fallbackReason}
          notFound={page.kind === "notFound"}
          retrying={page.refresh.pending}
          onRetry={page.refresh.run}
          titleRef={titleRef}
          recovery={editor.dirty ? <MatchNoteRecovery editor={editor} /> : undefined}
        />
      )}
    </>
  );
}

function MatchDetailReadyContent({
  page,
  editor,
  titleRef,
}: {
  page: MatchDetailReadyPageModel;
  editor: MatchNoteEditor;
  titleRef: Ref<HTMLHeadingElement>;
}) {
  const { analysis, deletion, identity, match, navigation } = page;
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
      <div className="grid gap-2">
        <nav aria-label="試合詳細の移動" className={inlineActionGroupClass}>
          <LinkButton
            icon={<ArrowLeft aria-hidden="true" />}
            size="sm"
            to={navigation.backHref}
            variant="quiet"
          >
            {navigation.backLabel}
          </LinkButton>
          {navigation.currentHeldEventHref ? (
            <LinkButton to={navigation.currentHeldEventHref} size="sm" variant="quiet">
              この試合の開催を見る
            </LinkButton>
          ) : null}
        </nav>
        {navigation.fallbackReason ? (
          <p className={contentText.supporting}>{navigation.fallbackReason}</p>
        ) : null}
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

        <MatchNoteSection match={match} editor={editor} />

        <MatchRecordMetadata
          confirmDelete={deletion.confirm}
          deleteDisabledReason={
            editor.pending
              ? "メモの保存・削除が完了するまで、試合は削除できません。"
              : editor.dirty
                ? "メモを保存するか、編集をキャンセルすると試合を削除できます。"
                : undefined
          }
          errorMessage={deletion.errorMessage}
          isDeletePending={deletion.pending}
          match={match}
          setShowConfirm={deletion.setOpen}
          showConfirm={deletion.open}
        />
      </PageContentSurface>

      <MatchDetailAdjacentNavigation page={page} />
    </PageFrame>
  );
}

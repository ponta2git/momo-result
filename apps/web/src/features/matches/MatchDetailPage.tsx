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
import { memberDisplayName } from "@/shared/domain/members";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { MatchResultLedger } from "@/shared/ui/data/MatchResultLedger";
import { Card } from "@/shared/ui/layout/Card";
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

  if (controller.status === "loadFailed") {
    return <MatchDetailLoadFailed backHref={controller.backHref} />;
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
    featureBadges,
    featureScopeLabel,
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
  const ledgerRows = (performanceContext?.rows ?? []).map((row) =>
    Object.assign({ displayName: memberDisplayName(row.memberId) }, row),
  );

  return (
    <PageFrame className="min-w-0 gap-5" width="wide">
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
        eyebrow="試合記録"
        title={`第${match.matchNoInEvent}試合の結果`}
        actions={
          <>
            <LinkButton to={exportHref} variant="secondary">
              この試合を出力
            </LinkButton>
            <LinkButton to={editHref}>編集</LinkButton>
          </>
        }
      />

      <div className="grid gap-3">
        <MatchDetailIdentity
          gameTitleName={gameTitle?.name}
          heldAt={heldAt}
          mapName={map?.name}
          matchNoInEvent={match.matchNoInEvent}
          seasonName={season?.name}
        />
        <MatchFeatureSection badges={featureBadges} scopeLabel={featureScopeLabel} />
      </div>

      <Card className="w-full max-w-4xl self-center overflow-hidden p-0">
        <div className="flex flex-col gap-1 border-b border-[var(--color-border)] px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
              順位・総資産
            </h2>
            <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
              物件収益と、この試合による通算平均順位の変化も併記しています。
            </p>
          </div>
          {performanceContext?.matchIndex ? (
            <p className="shrink-0 text-xs font-semibold text-[var(--color-text-secondary)] tabular-nums">
              同条件内 {performanceContext.matchIndex}戦目
            </p>
          ) : null}
        </div>
        <MatchResultLedger
          className="rounded-none border-0"
          contextStatus={comparisonContextStatus}
          rows={ledgerRows}
        />
        <div className="px-4 pb-4">
          <MatchSeriesComparisonCta href={comparisonHref} />
        </div>
      </Card>

      <Card>
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">成績詳細</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            プレー順と事件簿を含む保存内容です。見出しで並び替えできます。
          </p>
        </div>
        <MatchDetailResultsTable players={players} setSortKey={setSortKey} sort={sort} />
      </Card>

      <MatchRecordMetadata
        confirmDelete={confirmDelete}
        errorMessage={errorMessage}
        isDeletePending={isDeletePending}
        match={match}
        setShowConfirm={setShowConfirm}
        showConfirm={showConfirm}
      />
    </PageFrame>
  );
}
import { ArrowLeft } from "lucide-react";

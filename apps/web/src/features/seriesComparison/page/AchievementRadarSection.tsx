import { PlayerRadarSection } from "@/features/seriesComparison/page/PlayerRadarSection";
import { AnalysisSection } from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import { useAchievementRadar } from "@/features/seriesComparison/page/useAchievementRadar";
import { AchievementScoreTable } from "@/shared/achievements/AchievementScoreTable";
import type { PlayerRadarDisplay } from "@/shared/seriesAnalysis/playerRadarPresentation";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { contentText } from "@/shared/ui/typography";

/** Uses exactly the displayed six-axis artifact; empty comparison scopes need no fake aggregate. */
export function AchievementRadarSection({
  gameTitleId,
  artifactId,
  mapMasterId,
  seasonMasterId,
  radar: currentRadar,
}: {
  gameTitleId: string;
  artifactId: string | undefined;
  mapMasterId?: string | undefined;
  seasonMasterId?: string | undefined;
  radar?: PlayerRadarDisplay | undefined;
}) {
  const { query, summary, players, href, radar, retained } = useAchievementRadar(
    gameTitleId,
    artifactId,
    mapMasterId,
    seasonMasterId,
    currentRadar,
  );
  if (radar)
    return (
      <div className="grid gap-3">
        <PlayerRadarSection radar={radar} achievements={players} achievementsHref={href} />
        {query.isError ? (
          <Notice tone="warning" title="実績達成の数値を取得できません">
            {retained ? "直前に取得したレーダーを表示しています。" : "成績6軸は表示しています。"}
            「表示を更新」で実績を読み込み直してください。
          </Notice>
        ) : !summary ? (
          <p className={contentText.supporting}>
            {retained ? "直前に取得したレーダーを表示しています。" : ""}
            {query.isFetching ? "実績達成を読み込み中です。" : "実績達成は集計待ちです。"}
          </p>
        ) : null}
      </div>
    );
  return (
    <AnalysisSection id="metric-player-radar" title="実績達成・作品通算">
      <div className="grid min-w-0 gap-3">
        <p className={contentText.supporting}>
          この比較範囲の成績6軸は対象試合がありません。実績達成は作品通算で表示します。
        </p>
        {players ? (
          <AchievementScoreTable players={players} />
        ) : query.isFetching ? (
          <Skeleton className="h-36" />
        ) : (
          <p className={contentText.body}>
            {query.isError
              ? "実績の数値を取得できません。「表示を更新」で再取得してください。"
              : "実績達成は集計待ちです。"}
          </p>
        )}
        {retained ? (
          <Notice tone={query.isError ? "warning" : "info"}>
            直前に取得した実績を表示しています。
            {query.isError
              ? "取得に失敗しました。「表示を更新」で再取得してください。"
              : "最新の実績を読み込み中です。"}
          </Notice>
        ) : null}
        <div>
          <LinkButton to={href} variant="secondary">
            実績リストを開く
          </LinkButton>
        </div>
      </div>
    </AnalysisSection>
  );
}

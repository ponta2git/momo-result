import { achievementPageHref } from "@/shared/achievements/achievementPresentation";
import { AchievementPublicationFeedback } from "@/shared/achievements/AchievementPublicationFeedback";
import { useAchievementPublication } from "@/shared/achievements/useAchievementPublication";
import { orderFixedMembers } from "@/shared/domain/members";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { contentText } from "@/shared/ui/typography";

export function MatchAchievements({
  matchId,
  gameTitleId,
  heldEventId,
}: {
  matchId: string;
  gameTitleId: string;
  heldEventId: string;
}) {
  const publication = useAchievementPublication(gameTitleId);
  const data = publication.data?.gameTitleId === gameTitleId ? publication.data : undefined;
  const entries =
    data?.items.flatMap((item) =>
      orderFixedMembers(item.players)
        .filter((player) =>
          player.proofs.some(
            (proof) =>
              (proof.matchId === matchId && proof.matchAvailable) ||
              (proof.heldEventId === heldEventId && proof.heldEventAvailable),
          ),
        )
        .map((player) => ({ item, player })),
    ) ?? [];
  return (
    <section aria-labelledby="match-achievements-heading" className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="match-achievements-heading" className={cn(contentText.heading, "text-balance")}>
          この試合が根拠の実績
        </h2>
        <Button
          size="sm"
          variant="secondary"
          pending={publication.status.isFetching || publication.resource.isFetching}
          pendingLabel="更新中"
          onClick={() => void publication.refresh().catch(() => undefined)}
        >
          表示を更新
        </Button>
      </div>
      <AchievementPublicationFeedback
        status={publication.status.data}
        statusFailed={publication.status.isError}
        resourceFailed={publication.resource.isError}
        hasPublishedData={Boolean(data)}
      />
      {!data && (publication.status.isLoading || publication.resource.isLoading) ? (
        <Skeleton className="h-16" />
      ) : null}
      {data && entries.length === 0 ? (
        <p className={contentText.body}>公開済みの集計に、この試合を根拠にする実績はありません。</p>
      ) : null}
      <ul className="grid gap-2">
        {entries.map(({ item, player }) => (
          <li
            key={`${item.achievementId}:${player.memberId}`}
            className="flex flex-wrap items-center gap-2"
          >
            <span className={contentText.body}>
              {item.name}・{player.displayName}
            </span>
            <LinkButton
              size="sm"
              variant="secondary"
              to={achievementPageHref(gameTitleId, item.achievementId, player.memberId)}
              aria-label={`${item.name}・${player.displayName}の根拠と記録を確認`}
            >
              根拠・記録を確認
            </LinkButton>
          </li>
        ))}
      </ul>
      <div>
        <LinkButton to={achievementPageHref(gameTitleId)} variant="secondary" size="sm">
          実績リストを開く
        </LinkButton>
      </div>
    </section>
  );
}

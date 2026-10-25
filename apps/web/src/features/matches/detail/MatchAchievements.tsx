import { ChevronRight } from "lucide-react";

import { AchievementDifficulty } from "@/shared/achievements/AchievementDifficulty";
import { achievementPageHref } from "@/shared/achievements/achievementPresentation";
import { AchievementPublicationFeedback } from "@/shared/achievements/AchievementPublicationFeedback";
import { useAchievementPublication } from "@/shared/achievements/useAchievementPublication";
import { orderFixedMembers } from "@/shared/domain/members";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
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
    data?.items
      .filter((item) => !item.retired)
      .map((item) => ({
        item,
        players: orderFixedMembers(item.players).filter((player) =>
          player.proofs.some(
            (proof) =>
              (proof.matchId === matchId && proof.matchAvailable) ||
              (proof.heldEventId === heldEventId && proof.heldEventAvailable),
          ),
        ),
      }))
      .filter(({ players }) => players.length > 0) ?? [];
  return (
    <section aria-labelledby="match-achievements-heading" className="grid min-w-0 gap-3">
      <h2 id="match-achievements-heading" className={cn(contentText.heading, "text-balance")}>
        この試合・開催の実績
      </h2>
      <AchievementPublicationFeedback
        status={publication.status.data}
        statusFailed={publication.status.isError}
        resourceFailed={publication.resource.isError}
        hasPublishedData={Boolean(data)}
        refreshMode="page"
      />
      {!data && (publication.status.isLoading || publication.resource.isLoading) ? (
        <Skeleton className="h-16" />
      ) : null}
      {data && entries.length === 0 ? (
        <p className={contentText.body}>この試合・開催を根拠とする実績はありません。</p>
      ) : null}
      {entries.length > 0 ? (
        <ul className="grid max-w-3xl gap-6">
          {entries.map(({ item, players }) => (
            <li key={item.achievementId} className="grid min-w-0 gap-2">
              <div className="flex min-w-0 items-start justify-between gap-4">
                <h3 className={cn(contentText.body, "min-w-0 text-pretty")}>{item.name}</h3>
                <AchievementDifficulty stars={item.stars} />
              </div>
              <ul aria-label={`${item.name}の達成者`} className="flex flex-wrap gap-x-4 gap-y-2">
                {players.map((player) => (
                  <li key={player.memberId}>
                    <LinkButton
                      size="sm"
                      variant="quiet"
                      to={achievementPageHref(gameTitleId, item.achievementId, player.memberId)}
                      aria-label={`${item.name}・${player.displayName}の記録を見る`}
                    >
                      <span className="inline-flex items-center gap-2">
                        <MemberSequenceLabel memberId={player.memberId}>
                          {player.displayName}
                        </MemberSequenceLabel>
                        <ChevronRight aria-hidden="true" className="size-4" />
                      </span>
                    </LinkButton>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

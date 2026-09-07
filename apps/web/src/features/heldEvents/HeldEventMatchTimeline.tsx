import { BarChart3, Trophy } from "lucide-react";

import { heldEventScopeLabel } from "@/features/heldEvents/heldEventDetailViewModel";
import type { HeldEventMasterNames } from "@/features/heldEvents/heldEventDetailViewModel";
import { HeldEventMatchNotePreview } from "@/features/heldEvents/HeldEventMatchNotePreview";
import type { HeldEventMatchResponse } from "@/shared/api/heldEvents";
import { formatMatchNoInEvent } from "@/shared/domain/matchLabels";
import { memberDisplayName } from "@/shared/domain/members";
import { formatManYen } from "@/shared/lib/formatters";
import { seriesComparisonHrefForMatch } from "@/shared/navigation/matchLinks";
import { withReturnTo } from "@/shared/navigation/returnTo";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { MemberSequenceLabel } from "@/shared/ui/data/MemberSequenceLabel";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { ContentWithActions } from "@/shared/ui/layout/ContentWithActions";
import { RankBadge } from "@/shared/ui/rank/RankBadge";
import { contentText } from "@/shared/ui/typography";

export function HeldEventMatchTimeline({
  masterNames,
  matches,
  returnTo,
}: {
  masterNames: HeldEventMasterNames;
  matches: HeldEventMatchResponse[];
  returnTo: string;
}) {
  return (
    <section aria-labelledby="held-event-timeline-heading" className="grid gap-4">
      <h2 id="held-event-timeline-heading" className={contentText.heading}>
        試合の流れ
      </h2>

      {matches.length === 0 ? (
        <EmptyState
          description="OCR取り込みまたは手入力で試合を確定すると、開催戦績の集計が始まります。"
          icon={<Trophy />}
          placement="embedded"
          title="確定済みの試合はまだありません"
        />
      ) : (
        <ol aria-label="試合の流れ" className="grid gap-12">
          {matches.map((match, index) => (
            <li key={match.matchId} className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-4">
              {index < matches.length - 1 ? (
                <span
                  aria-hidden="true"
                  className="absolute top-4 -bottom-16 left-4 w-px bg-[var(--color-border-strong)]"
                  data-timeline-connector
                />
              ) : null}
              <div aria-hidden="true" className="relative z-[var(--z-base)] flex justify-center">
                <span className="font-plain flex size-8 items-center justify-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-xs tabular-nums">
                  {match.matchNoInEvent}
                </span>
              </div>
              <article
                aria-label={`${formatMatchNoInEvent(match.matchNoInEvent)}の記録`}
                className="grid min-w-0 gap-4"
              >
                <ContentWithActions
                  actions={
                    <>
                      <LinkButton
                        aria-label={`${formatMatchNoInEvent(match.matchNoInEvent)}の結果を見る`}
                        size="sm"
                        to={withReturnTo(`/matches/${encodeURIComponent(match.matchId)}`, returnTo)}
                        variant="secondary"
                      >
                        結果を見る
                      </LinkButton>
                      <LinkButton
                        aria-label={`${formatMatchNoInEvent(match.matchNoInEvent)}を戦績比較で見る`}
                        icon={<BarChart3 aria-hidden="true" />}
                        size="sm"
                        to={withReturnTo(seriesComparisonHrefForMatch(match), returnTo)}
                        variant="quiet"
                      >
                        比較する
                      </LinkButton>
                    </>
                  }
                >
                  <div className="min-w-0">
                    <h3 className={cn(contentText.heading, "tabular-nums")}>
                      {formatMatchNoInEvent(match.matchNoInEvent)}
                    </h3>
                    <p className={cn(contentText.body, "mt-1 truncate")}>
                      {heldEventScopeLabel(match, masterNames)}
                    </p>
                    <p className={cn(contentText.supporting, "mt-1")}>
                      オーナー <span>{memberDisplayName(match.ownerMemberId)}</span>
                    </p>
                  </div>
                </ContentWithActions>

                <div>
                  <ol
                    aria-label={`${formatMatchNoInEvent(match.matchNoInEvent)}の順位と総資産`}
                    className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-4"
                  >
                    {(match.players ?? [])
                      .toSorted(
                        (left, right) =>
                          left.rank - right.rank ||
                          left.playOrder - right.playOrder ||
                          left.memberId.localeCompare(right.memberId),
                      )
                      .map((player) => (
                        <li key={player.memberId} className="flex min-w-0 items-center gap-3">
                          <RankBadge rank={player.rank} />
                          <div className="min-w-0">
                            <p className={cn(contentText.body, "min-w-0")}>
                              <MemberSequenceLabel memberId={player.memberId}>
                                <span className="truncate">
                                  {memberDisplayName(player.memberId)}
                                </span>
                              </MemberSequenceLabel>
                            </p>
                            <p className={cn(contentText.compactPrimary, "truncate tabular-nums")}>
                              {formatManYen(player.totalAssetsManYen)}
                            </p>
                          </div>
                        </li>
                      ))}
                  </ol>
                </div>

                {match.noteBody ? (
                  <div>
                    <HeldEventMatchNotePreview body={match.noteBody} />
                  </div>
                ) : null}
              </article>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

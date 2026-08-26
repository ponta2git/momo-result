import { BarChart3, Trophy } from "lucide-react";

import {
  formatHeldEventShortDateTime,
  heldEventScopeLabel,
} from "@/features/heldEvents/heldEventDetailViewModel";
import type { HeldEventMasterNames } from "@/features/heldEvents/heldEventDetailViewModel";
import type { HeldEventMatchResponse } from "@/shared/api/heldEvents";
import { formatMatchNoInEvent } from "@/shared/domain/matchLabels";
import { memberDisplayName, orderFixedMembers } from "@/shared/domain/members";
import { formatManYen } from "@/shared/lib/formatters";
import { seriesComparisonHrefForMatch } from "@/shared/navigation/matchLinks";
import { withReturnTo } from "@/shared/navigation/returnTo";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { MemberSequenceLabel } from "@/shared/ui/data/MemberSequenceLabel";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { RankBadge } from "@/shared/ui/rank/RankBadge";

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
    <section aria-labelledby="held-event-timeline-heading" className="grid gap-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="held-event-timeline-heading" className="momo-heading text-lg font-semibold">
            試合の流れ
          </h2>
          {matches.length > 0 ? (
            <p className="momo-copy mt-1 text-sm text-[var(--color-text-secondary)]">
              各試合の順位と総資産を見比べ、結果詳細や同条件の戦績比較へ進めます。
            </p>
          ) : null}
        </div>
        {matches.length > 0 ? (
          <p className="shrink-0 text-sm font-semibold text-[var(--color-text-secondary)] tabular-nums">
            {matches.length}試合
          </p>
        ) : null}
      </div>

      {matches.length === 0 ? (
        <EmptyState
          className="px-0"
          description="OCR取り込みまたは手入力で試合を確定すると、開催戦績の集計が始まります。"
          icon={<Trophy className="size-5" />}
          placement="embedded"
          title="確定済みの試合はまだありません"
        />
      ) : (
        <ol className="divide-y divide-[var(--color-border)]">
          {matches.map((match, index) => (
            <li key={match.matchId} className="grid grid-cols-[3.5rem_minmax(0,1fr)]">
              <div aria-hidden="true" className="relative flex justify-center pt-4">
                {index < matches.length - 1 ? (
                  <span className="absolute top-11 -bottom-px w-px bg-[var(--color-border-strong)]" />
                ) : null}
                <span className="relative flex size-8 items-center justify-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-xs font-semibold tabular-nums">
                  {match.matchNoInEvent}
                </span>
              </div>
              <article className="min-w-0 border-l border-[var(--color-border)] py-4 pr-4 pl-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <h3 className="momo-heading text-base font-semibold tabular-nums">
                      {formatMatchNoInEvent(match.matchNoInEvent)}
                    </h3>
                    <p className="mt-1 truncate text-sm text-[var(--color-text-secondary)]">
                      {heldEventScopeLabel(match, masterNames)}
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                      {formatHeldEventShortDateTime(match.playedAt)} ・ 記録者
                      {memberDisplayName(match.ownerMemberId)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
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
                      icon={<BarChart3 aria-hidden="true" className="size-4" />}
                      size="sm"
                      to={withReturnTo(seriesComparisonHrefForMatch(match), returnTo)}
                      variant="quiet"
                    >
                      比較する
                    </LinkButton>
                  </div>
                </div>

                <ol
                  aria-label={`${formatMatchNoInEvent(match.matchNoInEvent)}の順位と総資産`}
                  className="mt-3 grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-2 xl:grid-cols-4"
                >
                  {orderFixedMembers(match.players ?? []).map((player) => (
                    <li
                      key={player.memberId}
                      className="flex min-w-0 items-center gap-3 bg-[var(--color-surface)] px-3 py-3"
                    >
                      <RankBadge rank={player.rank} />
                      <div className="min-w-0">
                        <p className="min-w-0 text-sm font-semibold">
                          <MemberSequenceLabel memberId={player.memberId}>
                            <span className="truncate">{memberDisplayName(player.memberId)}</span>
                          </MemberSequenceLabel>
                        </p>
                        <p className="truncate text-xs text-[var(--color-text-secondary)] tabular-nums">
                          {formatManYen(player.totalAssetsManYen)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </article>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

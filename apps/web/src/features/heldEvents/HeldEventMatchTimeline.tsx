import { BarChart3, Camera, Keyboard, Trophy } from "lucide-react";

import {
  formatHeldEventShortDateTime,
  heldEventScopeLabel,
} from "@/features/heldEvents/heldEventDetailViewModel";
import type { HeldEventMasterNames } from "@/features/heldEvents/heldEventDetailViewModel";
import type { HeldEventMatchResponse } from "@/shared/api/heldEvents";
import { memberDisplayName } from "@/shared/domain/members";
import { formatManYen } from "@/shared/lib/formatters";
import { seriesComparisonHrefForMatch } from "@/shared/navigation/matchLinks";
import { withReturnTo } from "@/shared/navigation/returnTo";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Card } from "@/shared/ui/layout/Card";
import { RankBadge } from "@/shared/ui/rank/RankBadge";

export function HeldEventMatchTimeline({
  heldEventId,
  masterNames,
  matches,
  nextMatchNo,
  returnTo,
}: {
  heldEventId: string;
  masterNames: HeldEventMasterNames;
  matches: HeldEventMatchResponse[];
  nextMatchNo: number;
  returnTo: string;
}) {
  return (
    <section aria-labelledby="held-event-timeline-heading" className="grid gap-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="held-event-timeline-heading" className="momo-heading text-lg font-semibold">
            試合の流れ
          </h2>
          <p className="momo-copy mt-1 text-sm text-[var(--color-text-secondary)]">
            開催内の試合番号順です。各試合から詳細と同条件の戦績比較へ進めます。
          </p>
        </div>
        {matches.length > 0 ? (
          <p className="shrink-0 text-sm font-semibold text-[var(--color-text-secondary)] tabular-nums">
            {matches.length}試合
          </p>
        ) : null}
      </div>

      {matches.length === 0 ? (
        <EmptyState
          icon={<Trophy className="size-5" />}
          title="確定済みの試合はまだありません"
          description={`次は第${nextMatchNo}試合です。OCR取り込みか手入力で、この開催の記録を始めます。`}
          action={
            <div className="flex flex-wrap gap-2">
              <LinkButton
                icon={<Camera aria-hidden="true" className="size-4" />}
                to={withReturnTo(
                  `/ocr/new?heldEventId=${encodeURIComponent(heldEventId)}`,
                  returnTo,
                )}
              >
                OCR取り込み
              </LinkButton>
              <LinkButton
                icon={<Keyboard aria-hidden="true" className="size-4" />}
                to={withReturnTo(
                  `/matches/new?heldEventId=${encodeURIComponent(heldEventId)}`,
                  returnTo,
                )}
                variant="secondary"
              >
                手入力
              </LinkButton>
            </div>
          }
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <ol>
            {matches.map((match, index) => (
              <li
                key={match.matchId}
                className="grid grid-cols-[3.5rem_minmax(0,1fr)] border-b border-[var(--color-border)] last:border-b-0"
              >
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
                        第{match.matchNoInEvent}試合
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
                        aria-label={`第${match.matchNoInEvent}試合の結果を見る`}
                        size="sm"
                        to={withReturnTo(`/matches/${encodeURIComponent(match.matchId)}`, returnTo)}
                        variant="secondary"
                      >
                        結果を見る
                      </LinkButton>
                      <LinkButton
                        aria-label={`第${match.matchNoInEvent}試合を戦績比較で見る`}
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
                    aria-label={`第${match.matchNoInEvent}試合の順位と総資産`}
                    className="mt-3 grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-2 xl:grid-cols-4"
                  >
                    {(match.players ?? [])
                      .toSorted((left, right) => left.rank - right.rank)
                      .map((player) => (
                        <li
                          key={player.memberId}
                          className="flex min-w-0 items-center gap-3 bg-[var(--color-surface-subtle)] px-3 py-3"
                        >
                          <RankBadge rank={player.rank} />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">
                              {memberDisplayName(player.memberId)}
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
        </Card>
      )}
    </section>
  );
}

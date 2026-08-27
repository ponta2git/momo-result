import { formatMatchDetailDateOnly } from "@/features/matches/matchDetailViewModel";
import { formatMatchNoInEvent } from "@/shared/domain/matchLabels";

export function MatchDetailIdentity({
  gameTitle,
  heldAt,
  map,
  matchNoInEvent,
  season,
}: {
  gameTitle: string;
  heldAt: string;
  map: string;
  matchNoInEvent: number;
  season: string;
}) {
  const matchLabel = formatMatchNoInEvent(matchNoInEvent);
  const items = [
    ["開催日", formatMatchDetailDateOnly(heldAt)],
    ["作品", gameTitle],
    ["シーズン", season],
    ["マップ", map],
  ] as const;

  return (
    <section aria-label={`${matchLabel}の開催条件`} className="min-w-0">
      <dl className="flex min-w-0 flex-wrap gap-x-5 gap-y-2">
        {items.map(([label, value]) => (
          <div key={label} className="flex min-w-0 items-baseline gap-2">
            <dt className="shrink-0 text-[11px] font-semibold text-[var(--color-text-secondary)]">
              {label}
            </dt>
            <dd className="min-w-0 text-sm font-semibold break-words text-[var(--color-text-primary)] tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

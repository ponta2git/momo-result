import { formatMatchDetailDateOnly } from "@/features/matches/matchDetailViewModel";

export function MatchDetailIdentity({
  gameTitleName,
  heldAt,
  mapName,
  matchNoInEvent,
  seasonName,
}: {
  gameTitleName: string | undefined;
  heldAt: string;
  mapName: string | undefined;
  matchNoInEvent: number;
  seasonName: string | undefined;
}) {
  const items = [
    ["開催日", formatMatchDetailDateOnly(heldAt)],
    ["作品", gameTitleName ?? "作品未設定"],
    ["シーズン", seasonName ?? "シーズン未設定"],
    ["マップ", mapName ?? "マップ未設定"],
  ] as const;

  return (
    <section
      aria-label={`第${matchNoInEvent}試合の開催条件`}
      className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-4 py-3"
    >
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

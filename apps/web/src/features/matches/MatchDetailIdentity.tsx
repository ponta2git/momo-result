import { formatMatchDetailDateOnly } from "@/features/matches/matchDetailViewModel";
import { formatMatchNoInEvent } from "@/shared/domain/matchLabels";
import { FactList } from "@/shared/ui/data/FactList";

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
      <FactList
        ariaLabel={`${matchLabel}の開催条件`}
        columns={4}
        items={items.map(([label, value]) => ({ id: label, label, value }))}
        layout="plain"
      />
    </section>
  );
}

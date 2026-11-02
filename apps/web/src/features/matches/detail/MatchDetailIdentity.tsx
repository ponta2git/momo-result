import { formatMatchDetailDateOnly } from "@/features/matches/detail/matchDetailPresentation";
import { formatMatchNoInEvent } from "@/shared/domain/matchLabels";
import { FactList } from "@/shared/ui/data/FactList";

export function MatchDetailIdentity({
  gameTitle,
  heldAt,
  id,
  map,
  matchNoInEvent,
  season,
}: {
  gameTitle: string;
  heldAt: string;
  /** Describes the page title, so arriving from the previous or next match names its event. */
  id?: string;
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
    <section aria-label={`${matchLabel}の開催条件`} className="min-w-0" id={id}>
      <FactList
        ariaLabel={`${matchLabel}の開催条件`}
        columns={4}
        items={items.map(([label, value]) => ({ id: label, label, value }))}
        layout="plain"
      />
    </section>
  );
}

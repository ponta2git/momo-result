import type { HeldEventPlayerRecapView } from "@/features/heldEvents/detail/heldEventDetailPresentation";
import { formatAverageRank } from "@/features/heldEvents/detail/heldEventDetailPresentation";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { RankTrail } from "@/shared/matches/RankBadge";
import { cn } from "@/shared/ui/cn";
import { FactList } from "@/shared/ui/data/FactList";
import { contentText } from "@/shared/ui/typography";

export function HeldEventPlayerRecap({ recaps }: { recaps: readonly HeldEventPlayerRecapView[] }) {
  if (recaps.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="held-event-recap-heading" className="grid min-w-0 gap-2">
      <h2 id="held-event-recap-heading" className={contentText.heading}>
        この開催の戦績
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {recaps.map((recap) => (
          <section
            key={recap.memberId}
            aria-label={`${recap.displayName}の開催戦績`}
            className="grid min-w-0 content-start gap-2"
          >
            <h3 className={cn(contentText.heading, "min-w-0")}>
              <MemberSequenceLabel memberId={recap.memberId}>
                <span className="truncate">{recap.displayName}</span>
              </MemberSequenceLabel>
            </h3>
            <FactList
              ariaLabel={`${recap.displayName}の成績`}
              items={[
                { id: "wins", label: "1位回数", value: `${recap.wins}回` },
                {
                  id: "average",
                  label: "平均順位",
                  value: `${formatAverageRank(recap.averageRank)}位`,
                },
                {
                  id: "trail",
                  label: "順位推移",
                  // The trail wraps inside its column, so it needs no scroll container.
                  value: (
                    <RankTrail ariaLabel={`${recap.displayName}の順位推移`} ranks={recap.ranks} />
                  ),
                },
              ]}
            />
          </section>
        ))}
      </div>
    </section>
  );
}

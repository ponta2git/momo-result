import { LinkButton } from "@/shared/ui/actions/LinkButton";

export function MatchSeriesComparisonCta({ href }: { href: string }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm leading-5 text-pretty text-[var(--color-text-secondary)]">
          同じ作品・シーズン・マップ内で、この試合前後の推移を比べます。
        </p>
      </div>
      <div className="grid shrink-0">
        <LinkButton to={href} variant="secondary">
          前後の戦績を見る
        </LinkButton>
      </div>
    </div>
  );
}

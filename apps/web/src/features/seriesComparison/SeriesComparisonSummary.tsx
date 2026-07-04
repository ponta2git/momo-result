import { motion } from "motion/react";

import {
  formatDecimal,
  leaderSummary,
} from "@/features/seriesComparison/seriesComparisonPresentation";
import {
  averageRankSpread,
  ginjiSummary,
} from "@/features/seriesComparison/seriesComparisonViewModel";
import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";
import { cn } from "@/shared/ui/cn";
import { momoPanelTransition, momoTransition } from "@/shared/ui/motion/variants";

export function SummaryBand({ response }: { response: SeriesComparisonResponse }) {
  const leader = leaderSummary(response);
  const spread = averageRankSpread(response);
  const ginji = ginjiSummary(response);

  return (
    <motion.section
      animate={{ opacity: 1, y: 0 }}
      className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:grid-cols-4"
      initial={{ opacity: 0, y: 4 }}
      transition={momoPanelTransition}
    >
      <SummaryItem label="対戦回数" value={`${response.matchCount}戦`} />
      <SummaryItem
        label="首位社長"
        value={leader.name ?? "-"}
        subLabel={
          leader.averageRank === undefined
            ? "平均順位なし"
            : `平均順位 ${formatDecimal(leader.averageRank)}${
                leader.gapToSecond === undefined
                  ? ""
                  : `、2位との差 ${leader.gapToSecond.toFixed(2)}`
              }`
        }
      />
      <SummaryItem
        label="順位差"
        value={spread.label}
        subLabel={
          spread.spread === undefined
            ? "平均順位の比較材料不足"
            : `平均順位の最大差 ${spread.spread.toFixed(2)}`
        }
      />
      <SummaryItem
        label="銀次被害"
        tone={ginji.abnormalMatches > 0 ? "notice" : "neutral"}
        value={`${ginji.totalEncounters}回`}
        subLabel={`2回以上の試合 ${ginji.abnormalMatches}件`}
      />
    </motion.section>
  );
}

function SummaryItem({
  label,
  subLabel,
  tone = "neutral",
  value,
}: {
  label: string;
  subLabel?: string;
  tone?: "neutral" | "notice";
  value: string;
}) {
  return (
    <motion.div
      className={cn(
        "min-w-0 rounded-[var(--radius-sm)] border p-3",
        tone === "notice"
          ? "border-[var(--color-review)]/45 bg-[var(--color-review)]/10"
          : "border-[var(--color-border)] bg-[var(--color-surface-subtle)]",
      )}
      layout
      transition={momoTransition}
    >
      <p className="text-xs font-medium text-[var(--color-text-secondary)]">{label}</p>
      <p className="mt-1 text-xl font-semibold break-words text-[var(--color-text-primary)] sm:text-2xl">
        {value}
      </p>
      {subLabel ? (
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{subLabel}</p>
      ) : null}
    </motion.div>
  );
}

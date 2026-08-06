import { AnimatePresence, motion } from "motion/react";

import type { MatchListItemView } from "@/features/matches/list/matchListTypes";
import { momoTransition } from "@/shared/ui/motion/variants";
import { StatusPill } from "@/shared/ui/status/StatusPill";

type MatchListStatusSummaryProps = {
  item: MatchListItemView;
};

export function MatchListStatusSummary({ item }: MatchListStatusSummaryProps) {
  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        key={item.status}
        animate={{ opacity: 1, y: 0 }}
        className="grid justify-items-start gap-2"
        exit={{ opacity: 0, y: -2 }}
        initial={{ opacity: 0, y: 2 }}
        transition={momoTransition}
      >
        <StatusPill label={item.statusLabel} status={item.status} />
        {item.statusDescription ? (
          <p className="text-xs leading-5 text-[var(--color-text-secondary)]">
            {item.statusDescription}
          </p>
        ) : null}
      </motion.div>
    </AnimatePresence>
  );
}

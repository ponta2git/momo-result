import { AnimatePresence, motion } from "motion/react";

import { MatchListActions } from "@/features/matches/list/MatchListActions";
import type {
  MatchListItemView,
  MatchListRowActions,
} from "@/features/matches/list/matchListTypes";
import { momoTransition } from "@/shared/ui/motion/variants";

type MatchListStatusActionProps = {
  item: MatchListItemView;
  layout?: "inline" | "stacked";
  rowActions: MatchListRowActions;
};

export function MatchListStatusAction({
  item,
  layout = "inline",
  rowActions,
}: MatchListStatusActionProps) {
  if (item.status === "confirmed" || item.status === "ocr_running") {
    return null;
  }

  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        key={`${item.status}:${item.primaryAction.label}`}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -2 }}
        initial={{ opacity: 0, y: 2 }}
        transition={momoTransition}
      >
        <MatchListActions
          checkingDraftIds={rowActions.checkingDraftIds}
          disabled={rowActions.disabled ?? false}
          layout={layout}
          onDraftStatusCheckAction={rowActions.onDraftStatusCheckAction}
          primaryAction={item.primaryAction}
          secondaryActions={[]}
        />
      </motion.div>
    </AnimatePresence>
  );
}

import { MatchListActions } from "@/features/matches/list/MatchListActions";
import type {
  MatchListItemView,
  MatchListRowActions,
} from "@/features/matches/list/matchListTypes";

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
    <div>
      <MatchListActions
        checkingDraftIds={rowActions.checkingDraftIds}
        disabled={rowActions.disabled ?? false}
        layout={layout}
        onDraftStatusCheckAction={rowActions.onDraftStatusCheckAction}
        primaryAction={item.primaryAction}
        secondaryActions={[]}
      />
    </div>
  );
}

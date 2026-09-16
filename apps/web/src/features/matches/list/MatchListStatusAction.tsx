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

  const draftId = item.primaryAction.draftStatusCheck?.draftId;
  const error = draftId ? rowActions.draftErrors?.[draftId] : undefined;
  return (
    <div className="grid gap-2">
      {error ? (
        <p className="text-xs text-[var(--color-danger)]" role="alert">
          {error} 同じボタンから再試行できます。
        </p>
      ) : null}
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

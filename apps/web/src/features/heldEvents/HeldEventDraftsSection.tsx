import {
  formatHeldEventShortDateTime,
  heldEventDraftAction,
  heldEventDraftScopeLabel,
} from "@/features/heldEvents/heldEventDetailViewModel";
import type { HeldEventMasterNames } from "@/features/heldEvents/heldEventDetailViewModel";
import type { HeldEventDraftResponse } from "@/shared/api/heldEvents";
import { asDraftStatusOrUnknown, reviewStatusLabel } from "@/shared/domain/draftStatus";
import { formatMatchNoInEvent } from "@/shared/domain/matchLabels";
import { DraftStatusBadge } from "@/shared/matches/DraftStatusBadge";
import { withReturnTo } from "@/shared/navigation/returnTo";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { ContentWithActions } from "@/shared/ui/layout/ContentWithActions";
import { contentText } from "@/shared/ui/typography";

export function HeldEventDraftsSection({
  drafts,
  masterNames,
  returnTo,
}: {
  drafts: HeldEventDraftResponse[];
  masterNames: HeldEventMasterNames;
  returnTo: string;
}) {
  if (drafts.length === 0) {
    return null;
  }
  const primaryDraftId = drafts.find((draft) => heldEventDraftAction(draft).href)?.matchDraftId;

  return (
    <section aria-labelledby="held-event-drafts-heading" className="min-w-0">
      <h2 id="held-event-drafts-heading" className={contentText.heading}>
        未確定下書き
      </h2>
      <p className={cn(contentText.body, "mt-1 text-pretty")}>
        この開催に紐づく読み取り・確認作業です。確定すると下の試合記録へ移ります。
      </p>
      <ul className="mt-4 divide-y divide-[var(--color-border)]">
        {drafts.map((draft) => {
          const action = heldEventDraftAction(draft);
          const scopeLabel = heldEventDraftScopeLabel(draft, masterNames);
          const updatedAt = formatHeldEventShortDateTime(draft.updatedAt);
          return (
            <li key={draft.matchDraftId} className="py-3">
              <ContentWithActions
                actions={
                  action.href ? (
                    <LinkButton
                      size="sm"
                      to={withReturnTo(action.href, returnTo)}
                      variant={draft.matchDraftId === primaryDraftId ? "primary" : "secondary"}
                    >
                      {action.label}
                    </LinkButton>
                  ) : (
                    <Button disabled size="sm" variant="secondary">
                      {action.label}
                    </Button>
                  )
                }
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className={cn(contentText.body, "tabular-nums")}>
                      {formatMatchNoInEvent(draft.matchNoInEvent)}
                    </p>
                    <DraftStatusBadge
                      label={reviewStatusLabel(draft.status)}
                      status={asDraftStatusOrUnknown(draft.status)}
                    />
                  </div>
                  {scopeLabel ? (
                    <p className={cn(contentText.body, "mt-1 truncate")}>{scopeLabel}</p>
                  ) : null}
                  {updatedAt ? (
                    <p className={cn(contentText.supporting, "mt-1 tabular-nums")}>
                      最終更新 {updatedAt}
                    </p>
                  ) : null}
                </div>
              </ContentWithActions>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

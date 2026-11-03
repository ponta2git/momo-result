import {
  formatHeldEventShortDateTime,
  buildHeldEventDraftActionView,
  heldEventDraftScopeLabel,
} from "@/features/heldEvents/detail/heldEventDetailPresentation";
import type { HeldEventDraftResponse } from "@/shared/api/heldEvents";
import { asDraftStatusOrUnknown, reviewStatusLabel } from "@/shared/domain/draftStatus";
import { formatMatchNoInEvent } from "@/shared/domain/matchLabels";
import { DraftStatusBadge } from "@/shared/matches/DraftStatusBadge";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { ContentWithActions } from "@/shared/ui/layout/ContentWithActions";
import { contentText } from "@/shared/ui/typography";

export function HeldEventDraftsSection({
  drafts,
}: {
  drafts: ReadonlyArray<Readonly<HeldEventDraftResponse>>;
}) {
  if (drafts.length === 0) {
    return null;
  }
  const primaryDraftId = drafts.find(
    (draft) => buildHeldEventDraftActionView(draft).href,
  )?.matchDraftId;

  return (
    <section aria-labelledby="held-event-drafts-heading" className="grid min-w-0 gap-2">
      <div className="grid gap-1">
        <h2 id="held-event-drafts-heading" className={contentText.heading}>
          未確定下書き
        </h2>
        <p className={cn(contentText.body, "text-pretty")}>
          この開催に紐づく読み取り・確認作業です。確定すると下の試合記録へ移ります。
        </p>
      </div>
      {/* The list owns the dividers; the first and last records drop their outer padding. */}
      <ul className="divide-y divide-[var(--color-border)]">
        {drafts.map((draft) => {
          const actionView = buildHeldEventDraftActionView(draft);
          const scopeLabel = heldEventDraftScopeLabel(draft);
          const updatedAt = formatHeldEventShortDateTime(draft.updatedAt);
          return (
            <li key={draft.matchDraftId} className="py-3 first:pt-0 last:pb-0">
              <ContentWithActions
                actions={
                  actionView.href ? (
                    <LinkButton
                      size="sm"
                      to={actionView.href}
                      variant={draft.matchDraftId === primaryDraftId ? "primary" : "secondary"}
                    >
                      {actionView.label}
                    </LinkButton>
                  ) : (
                    <Button disabled size="sm" variant="secondary">
                      {actionView.label}
                    </Button>
                  )
                }
              >
                <div className="grid min-w-0 gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className={cn(contentText.heading, "tabular-nums")}>
                      {formatMatchNoInEvent(draft.matchNoInEvent)}
                    </p>
                    <DraftStatusBadge
                      label={reviewStatusLabel(draft.status)}
                      status={asDraftStatusOrUnknown(draft.status)}
                    />
                  </div>
                  {scopeLabel ? <p className={contentText.body}>{scopeLabel}</p> : null}
                  {updatedAt ? (
                    <p className={cn(contentText.supporting, "tabular-nums")}>
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

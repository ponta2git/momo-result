import { FileClock } from "lucide-react";

import {
  formatHeldEventShortDateTime,
  heldEventDraftAction,
  heldEventDraftScopeLabel,
} from "@/features/heldEvents/heldEventDetailViewModel";
import type { HeldEventMasterNames } from "@/features/heldEvents/heldEventDetailViewModel";
import type { HeldEventDraftResponse } from "@/shared/api/heldEvents";
import { asDraftStatusOrUnknown, reviewStatusLabel } from "@/shared/domain/draftStatus";
import { withReturnTo } from "@/shared/navigation/returnTo";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { Card } from "@/shared/ui/layout/Card";
import { StatusPill } from "@/shared/ui/status/StatusPill";

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

  return (
    <Card aria-labelledby="held-event-drafts-heading" className="overflow-hidden p-0">
      <div className="flex items-start gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-4 py-3">
        <FileClock
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-[var(--color-text-secondary)]"
        />
        <div>
          <h2 id="held-event-drafts-heading" className="momo-heading text-base font-semibold">
            未完了の試合
          </h2>
          <p className="momo-copy mt-1 text-sm text-[var(--color-text-secondary)]">
            この開催に紐づく読み取り・確認作業です。確定すると下の試合記録へ移ります。
          </p>
        </div>
      </div>
      <ul className="divide-y divide-[var(--color-border)]">
        {drafts.map((draft) => {
          const action = heldEventDraftAction(draft);
          const scopeLabel = heldEventDraftScopeLabel(draft, masterNames);
          const updatedAt = formatHeldEventShortDateTime(draft.updatedAt);
          return (
            <li
              key={draft.matchDraftId}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold tabular-nums">
                    {draft.matchNoInEvent ? `第${draft.matchNoInEvent}試合` : "試合番号未設定"}
                  </p>
                  <StatusPill
                    label={reviewStatusLabel(draft.status)}
                    status={asDraftStatusOrUnknown(draft.status)}
                  />
                </div>
                {scopeLabel ? (
                  <p className="mt-1 truncate text-sm text-[var(--color-text-secondary)]">
                    {scopeLabel}
                  </p>
                ) : null}
                {updatedAt ? (
                  <p className="mt-1 text-xs text-[var(--color-text-secondary)] tabular-nums">
                    最終更新 {updatedAt}
                  </p>
                ) : null}
              </div>
              {action.href ? (
                <LinkButton className="shrink-0" size="sm" to={withReturnTo(action.href, returnTo)}>
                  {action.label}
                </LinkButton>
              ) : (
                <Button className="shrink-0" disabled size="sm" variant="secondary">
                  {action.label}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

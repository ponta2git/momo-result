import { ArrowRight, CalendarPlus } from "lucide-react";
import type { ReactNode } from "react";

import { CreateHeldEventDialog } from "@/features/heldEvents/create/CreateHeldEventDialog";
import type { HeldEventCreation } from "@/features/heldEvents/create/useHeldEventCreation";
import { UnsavedChangesGuard } from "@/shared/navigation/UnsavedChangesGuard";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { Notice } from "@/shared/ui/feedback/Notice";
import { contentText } from "@/shared/ui/typography";

/** A short remark on where to record, followed directly by the action it suggests. */
function RecordingHint({ action, text }: { action: ReactNode; text: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <p className={contentText.supporting}>{text}</p>
      {action}
    </div>
  );
}

/** Read before the record actions, so a page left open from an earlier night is noticed first. */
export function NewerHeldEventHint({ href }: { href: string }) {
  return (
    <RecordingHint
      action={
        <LinkButton icon={<ArrowRight aria-hidden="true" />} size="sm" to={href} variant="quiet">
          最新の開催へ
        </LinkButton>
      }
      text="この開催より新しい開催があります"
    />
  );
}

/**
 * Creation for a night Summit did not prepare. The page keeps the creation itself mounted while
 * only the hint follows the offer: reconciling a created event refetches this hub, which can
 * withdraw the offer before the action reaches the new event.
 */
export function NewHeldEventOffer({
  creation,
  offered,
}: {
  creation: HeldEventCreation;
  offered: boolean;
}) {
  return (
    <>
      <UnsavedChangesGuard
        model={creation.navigationGuard}
        pending={creation.form.pending}
        showPendingDialog={false}
      />
      <CreateHeldEventDialog form={creation.form} />
      {offered ? (
        <RecordingHint
          action={
            <Button
              icon={<CalendarPlus aria-hidden="true" />}
              size="sm"
              variant="quiet"
              onClick={creation.open}
            >
              新しい開催を作成
            </Button>
          }
          text="別の日の対戦なら"
        />
      ) : null}
      {creation.closedErrorMessage ? (
        <Notice tone="danger" title="開催を作成できませんでした">
          {creation.closedErrorMessage}
        </Notice>
      ) : null}
    </>
  );
}

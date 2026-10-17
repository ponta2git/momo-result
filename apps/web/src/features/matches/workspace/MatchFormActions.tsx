import type { Ref } from "react";

import type { MatchWorkspaceSubmitView } from "@/features/matches/workspace/matchWorkspacePanelViews";
import { taskActionPanelClass } from "@/shared/ui/actions/actionGroup";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Notice } from "@/shared/ui/feedback/Notice";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText } from "@/shared/ui/typography";

type MatchFormActionsProps = {
  view: MatchWorkspaceSubmitView;
  primaryActionRef: Ref<HTMLButtonElement>;
};

export function MatchFormActions({ view, primaryActionRef }: MatchFormActionsProps) {
  return (
    <section aria-label="入力内容の確定" className={taskActionPanelClass}>
      {view.feedback.error ? (
        <div>
          <Notice presentation="nested" title={view.feedback.error.title} tone="danger">
            <p>{view.feedback.error.detail}</p>
            <p className="mt-1">{view.feedback.error.nextStep}</p>
          </Notice>
        </div>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <p className={cn(contentText.body, "text-pretty", readableTextWidthClass)}>
          {view.feedback.message}
        </p>
        <Button
          ref={primaryActionRef}
          disabled={view.availability.disabled || view.availability.pending}
          pending={view.availability.pending}
          pendingLabel={view.action.label === "保存" ? "保存中…" : "送信中…"}
          onClick={view.action.onRun}
        >
          {view.action.label}
        </Button>
      </div>
    </section>
  );
}

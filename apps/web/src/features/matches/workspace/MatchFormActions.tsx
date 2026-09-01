import type { Ref } from "react";

import type { MatchWorkspaceSubmitModel } from "@/features/matches/workspace/matchWorkspacePageModelTypes";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";

type MatchFormActionsProps = {
  model: MatchWorkspaceSubmitModel;
  primaryActionRef: Ref<HTMLButtonElement>;
};

export function MatchFormActions({ model, primaryActionRef }: MatchFormActionsProps) {
  return (
    <section
      aria-label="入力内容の確定"
      className="rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3"
    >
      {model.feedback.error ? (
        <div className="mb-3">
          <Notice title={model.feedback.error.title} tone="danger">
            <p>{model.feedback.error.detail}</p>
            <p className="mt-1">{model.feedback.error.nextStep}</p>
          </Notice>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <p className="text-sm text-pretty text-[var(--color-text-secondary)]">
          {model.feedback.message}
        </p>
        <Button
          ref={primaryActionRef}
          disabled={model.availability.disabled || model.availability.pending}
          pending={model.availability.pending}
          pendingLabel={model.action.label === "保存" ? "保存中…" : "送信中…"}
          onClick={model.action.onRun}
        >
          {model.action.label}
        </Button>
      </div>
    </section>
  );
}

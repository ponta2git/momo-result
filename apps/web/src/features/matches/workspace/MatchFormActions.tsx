import type { Ref } from "react";

import type { MatchWorkspaceOperationErrorView } from "@/features/matches/workspace/matchWorkspaceOperationError";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";

type MatchFormActionsProps = {
  actionLabel: string;
  disabled: boolean;
  error: MatchWorkspaceOperationErrorView | null;
  message: string;
  pending: boolean;
  primaryActionRef: Ref<HTMLButtonElement>;
  onPrimaryAction: () => void;
};

export function MatchFormActions({
  actionLabel,
  disabled,
  error,
  message,
  pending,
  primaryActionRef,
  onPrimaryAction,
}: MatchFormActionsProps) {
  return (
    <section
      aria-label="入力内容の確定"
      className="rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3"
    >
      {error ? (
        <Notice className="mb-3" title={error.title} tone="danger">
          <p>{error.detail}</p>
          <p className="mt-1">{error.nextStep}</p>
        </Notice>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <p className="text-sm text-pretty text-[var(--color-text-secondary)]">{message}</p>
        <Button
          ref={primaryActionRef}
          className="w-full sm:w-auto"
          disabled={disabled || pending}
          pending={pending}
          pendingLabel={actionLabel === "保存" ? "保存中…" : "送信中…"}
          onClick={onPrimaryAction}
        >
          {actionLabel}
        </Button>
      </div>
    </section>
  );
}

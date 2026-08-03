import type { Ref } from "react";

import { Button } from "@/shared/ui/actions/Button";

type MatchFormActionsProps = {
  actionLabel: string;
  disabled: boolean;
  message: string;
  pending: boolean;
  primaryActionRef: Ref<HTMLButtonElement>;
  onPrimaryAction: () => void;
};

export function MatchFormActions({
  actionLabel,
  disabled,
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

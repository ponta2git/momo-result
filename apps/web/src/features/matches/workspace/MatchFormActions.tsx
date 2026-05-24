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
    <div className="momo-safe-bottom sticky bottom-4 mt-8 rounded-[var(--radius-lg)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-pretty text-[var(--color-text-secondary)]">{message}</p>
        <Button
          ref={primaryActionRef}
          disabled={disabled || pending}
          pending={pending}
          pendingLabel={actionLabel === "保存" ? "保存中…" : "送信中…"}
          onClick={onPrimaryAction}
        >
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}

import { motion } from "motion/react";
import type { Ref } from "react";

import { Button } from "@/shared/ui/actions/Button";
import { momoPanelTransition } from "@/shared/ui/motion/variants";

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
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="momo-safe-bottom sticky bottom-4 mt-8 rounded-[var(--radius-lg)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-4 shadow-sm"
      initial={{ opacity: 0, y: 8 }}
      transition={momoPanelTransition}
    >
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
    </motion.div>
  );
}

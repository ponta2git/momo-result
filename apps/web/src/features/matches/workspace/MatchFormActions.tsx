import { Button } from "@/shared/ui/actions/Button";

type MatchFormActionsProps = {
  actionLabel: string;
  disabled: boolean;
  message: string;
  pending: boolean;
  onPrimaryAction: () => void;
};

export function MatchFormActions({
  actionLabel,
  disabled,
  message,
  pending,
  onPrimaryAction,
}: MatchFormActionsProps) {
  return (
    <div className="momo-safe-bottom sticky bottom-4 mt-8 rounded-[var(--radius-lg)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-pretty text-[var(--color-text-secondary)]">{message}</p>
        <Button
          id="workspace-primary-action"
          disabled={disabled || pending}
          onClick={onPrimaryAction}
        >
          {pending ? "送信中..." : actionLabel}
        </Button>
      </div>
    </div>
  );
}

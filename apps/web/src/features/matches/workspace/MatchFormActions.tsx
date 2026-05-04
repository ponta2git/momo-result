import { Button } from "@/shared/ui/Button";

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
    <div className="border-line-soft bg-night-900/92 sticky bottom-4 mt-8 rounded-2xl border p-4 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink-300 text-sm">{message}</p>
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

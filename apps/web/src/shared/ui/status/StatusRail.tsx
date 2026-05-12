import { isConfirmed, isOcrFailed, isOcrRunning, isNeedsReview } from "@/shared/domain/draftStatus";
import { cn } from "@/shared/ui/cn";
import type { MatchStatus } from "@/shared/ui/status/StatusPill";
import { StatusPill } from "@/shared/ui/status/StatusPill";

type StepState = "complete" | "current" | "pending";

type StatusRailProps = {
  className?: string;
  compact?: boolean;
  status: MatchStatus;
};

type RailStep = {
  key: string;
  label: string;
  state: StepState;
};

function buildSteps(status: MatchStatus): RailStep[] {
  if (isConfirmed(status)) {
    return [
      { key: "ocr", label: "処理中", state: "complete" },
      { key: "draft", label: "確認待ち", state: "complete" },
      { key: "confirmed", label: "確定済", state: "current" },
    ];
  }

  if (isOcrRunning(status)) {
    return [
      { key: "ocr", label: "処理中", state: "current" },
      { key: "draft", label: "確認待ち", state: "pending" },
      { key: "confirmed", label: "確定済", state: "pending" },
    ];
  }

  return [
    { key: "ocr", label: "処理中", state: "complete" },
    { key: "draft", label: "確認待ち", state: "current" },
    { key: "confirmed", label: "確定済", state: "pending" },
  ];
}

const stepClassByState = {
  complete:
    "border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]",
  current:
    "border-[var(--color-action)]/55 bg-[var(--color-action)]/12 text-[var(--color-text-primary)]",
  pending: "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)]",
} as const satisfies Record<StepState, string>;

export function StatusRail({ className, compact = false, status }: StatusRailProps) {
  if (compact) {
    return <StatusPill status={status} />;
  }

  const steps = buildSteps(status);
  const note = isOcrFailed(status) ? "読み取り失敗" : isNeedsReview(status) ? "要確認" : undefined;

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}>
      {steps.map((step, index) => (
        <div key={step.key} className="inline-flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "inline-flex min-h-8 min-w-[6.5ch] items-center justify-center rounded-[var(--radius-xs)] border px-2 py-1 text-xs font-semibold",
              stepClassByState[step.state],
            )}
          >
            {step.label}
          </span>
          {index < steps.length - 1 ? (
            <span aria-hidden="true" className="text-xs text-[var(--color-text-muted)]">
              -
            </span>
          ) : null}
        </div>
      ))}
      {note ? <span className="text-xs text-[var(--color-text-secondary)]">{note}</span> : null}
    </div>
  );
}

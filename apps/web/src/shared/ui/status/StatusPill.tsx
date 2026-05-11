import { AlertTriangle, CircleCheck, LoaderCircle, PencilLine } from "lucide-react";
import type { ReactNode } from "react";

import type { DraftStatus } from "@/features/matches/draftStatus";
import { cn } from "@/shared/ui/cn";

export type MatchStatus = DraftStatus;

type StatusViewModel = {
  icon: ReactNode;
  shortLabel: string;
  toneClass: string;
};

const statusViewModel: Record<MatchStatus, StatusViewModel> = {
  confirmed: {
    icon: <CircleCheck className="size-4" />,
    shortLabel: "確定済",
    toneClass:
      "border-[var(--color-success)]/60 bg-[var(--color-success)]/12 text-[var(--color-text-primary)]",
  },
  draft_ready: {
    icon: <PencilLine className="size-4" />,
    shortLabel: "確認待ち",
    toneClass:
      "border-[var(--color-warning)]/80 bg-[var(--color-warning)]/20 text-[var(--color-text-primary)]",
  },
  needs_review: {
    icon: <AlertTriangle className="size-4" />,
    shortLabel: "確認待ち",
    toneClass:
      "border-[var(--color-review)]/70 bg-[var(--color-review)]/14 text-[var(--color-text-primary)]",
  },
  ocr_failed: {
    icon: <AlertTriangle className="size-4" />,
    shortLabel: "確認待ち",
    toneClass:
      "border-[var(--color-warning)]/80 bg-[var(--color-warning)]/20 text-[var(--color-text-primary)]",
  },
  ocr_running: {
    icon: <LoaderCircle className="size-4 animate-spin" />,
    shortLabel: "処理中",
    toneClass:
      "border-[var(--color-action)]/60 bg-[var(--color-action)]/12 text-[var(--color-text-primary)]",
  },
};

export type StatusPillProps = {
  className?: string;
  hideIcon?: boolean;
  note?: string;
  status: MatchStatus;
};

export function StatusPill({ className, hideIcon = false, note, status }: StatusPillProps) {
  const model = statusViewModel[status];

  return (
    <span
      className={cn(
        "inline-flex min-h-8 min-w-0 items-center gap-1.5 rounded-[var(--radius-xs)] border px-2 py-1 text-xs font-semibold leading-5",
        model.toneClass,
        className,
      )}
    >
      {hideIcon ? null : (
        <span aria-hidden="true" className="shrink-0">
          {model.icon}
        </span>
      )}
      <span className="truncate">{model.shortLabel}</span>
      {note ? <span className="truncate text-[var(--color-text-secondary)]">{note}</span> : null}
    </span>
  );
}

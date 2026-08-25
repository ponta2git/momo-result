import { AlertTriangle, CircleCheck, PencilLine } from "lucide-react";
import type { ReactNode } from "react";

import { draftStatusLabels } from "@/shared/domain/draftStatus";
import type { DraftStatusOrUnknown } from "@/shared/domain/draftStatus";
import { StatusBadge } from "@/shared/ui/status/StatusBadge";
import type { StatusBadgeTone } from "@/shared/ui/status/StatusBadge";

export type MatchStatus = DraftStatusOrUnknown;

type StatusViewModel = {
  busy?: boolean;
  icon: ReactNode;
  tone: StatusBadgeTone;
};

const statusViewModel: Record<MatchStatus, StatusViewModel> = {
  confirmed: {
    icon: <CircleCheck className="size-4" />,
    tone: "success",
  },
  draft_ready: {
    icon: <PencilLine className="size-4" />,
    tone: "warning",
  },
  needs_review: {
    icon: <AlertTriangle className="size-4" />,
    tone: "attention",
  },
  ocr_failed: {
    icon: <AlertTriangle className="size-4" />,
    tone: "danger",
  },
  ocr_running: {
    busy: true,
    icon: null,
    tone: "info",
  },
  unknown: {
    icon: <AlertTriangle className="size-4" />,
    tone: "warning",
  },
};

export type StatusPillProps = {
  announceChanges?: boolean;
  className?: string;
  hideIcon?: boolean;
  label?: string;
  note?: string;
  status: MatchStatus;
};

export function StatusPill({
  announceChanges = false,
  className,
  hideIcon = false,
  label,
  note,
  status,
}: StatusPillProps) {
  const model = statusViewModel[status];

  return (
    <StatusBadge
      announceChanges={announceChanges}
      busy={model.busy}
      className={className}
      hideIcon={hideIcon}
      icon={model.icon}
      label={label ?? draftStatusLabels[status]}
      note={note}
      tone={model.tone}
    />
  );
}

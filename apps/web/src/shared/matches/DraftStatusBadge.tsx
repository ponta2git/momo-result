import { AlertTriangle, CircleCheck, PencilLine } from "lucide-react";
import type { ReactNode } from "react";

import { draftStatusLabels } from "@/shared/domain/draftStatus";
import type { DraftStatusOrUnknown } from "@/shared/domain/draftStatus";
import { StatusBadge } from "@/shared/ui/status/StatusBadge";
import type { StatusBadgeTone } from "@/shared/ui/status/StatusBadge";

type DraftStatusPresentation = {
  busy?: boolean;
  icon: ReactNode;
  tone: StatusBadgeTone;
};

const draftStatusPresentation: Record<DraftStatusOrUnknown, DraftStatusPresentation> = {
  confirmed: {
    icon: <CircleCheck />,
    tone: "success",
  },
  draft_ready: {
    icon: <PencilLine />,
    tone: "warning",
  },
  needs_review: {
    icon: <AlertTriangle />,
    tone: "attention",
  },
  ocr_failed: {
    icon: <AlertTriangle />,
    tone: "danger",
  },
  ocr_running: {
    busy: true,
    icon: null,
    tone: "info",
  },
  unknown: {
    icon: <AlertTriangle />,
    tone: "warning",
  },
};

export type DraftStatusBadgeProps = {
  announceChanges?: boolean;
  hideIcon?: boolean;
  label?: string;
  note?: string;
  status: DraftStatusOrUnknown;
};

/** Maps match-draft domain status to the domain-free StatusBadge presentation contract. */
export function DraftStatusBadge({
  announceChanges = false,
  hideIcon = false,
  label,
  note,
  status,
}: DraftStatusBadgeProps) {
  const presentation = draftStatusPresentation[status];

  return (
    <StatusBadge
      announceChanges={announceChanges}
      busy={presentation.busy}
      hideIcon={hideIcon}
      icon={presentation.icon}
      label={label ?? draftStatusLabels[status]}
      note={note}
      tone={presentation.tone}
    />
  );
}

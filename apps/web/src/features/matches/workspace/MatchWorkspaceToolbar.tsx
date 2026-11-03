import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import type { MatchWorkspaceToolbarView } from "@/features/matches/workspace/matchWorkspacePanelViews";
import { actionRowClass } from "@/shared/ui/actions/actionGroup";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { StatusBadge } from "@/shared/ui/status/StatusBadge";
import { workspaceSampleStatus } from "@/shared/workflows/matchWorkspacePresentation";

type MatchWorkspaceToolbarProps = {
  /** Operations on the whole record, placed at the end of the row. */
  actions?: ReactNode;
  view: MatchWorkspaceToolbarView;
};

export function MatchWorkspaceToolbar({ actions, view }: MatchWorkspaceToolbarProps) {
  return (
    <div className={cn(actionRowClass, "justify-between")}>
      <nav aria-label="入力画面の操作">
        <LinkButton
          icon={<ArrowLeft aria-hidden="true" />}
          size="sm"
          to={view.exit.href}
          variant="quiet"
        >
          {view.exit.label}
        </LinkButton>
      </nav>
      {view.sample || actions ? (
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {view.sample ? <StatusBadge {...workspaceSampleStatus} /> : null}
          {actions}
        </div>
      ) : null}
    </div>
  );
}

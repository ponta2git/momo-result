import { ArrowLeft } from "lucide-react";

import type { MatchWorkspaceToolbarModel } from "@/features/matches/workspace/matchWorkspacePageModelTypes";
import { actionRowClass } from "@/shared/ui/actions/actionGroup";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { StatusBadge } from "@/shared/ui/status/StatusBadge";
import { workspaceSampleStatus } from "@/shared/workflows/matchWorkspacePresentation";

type MatchWorkspaceToolbarProps = {
  model: MatchWorkspaceToolbarModel;
};

export function MatchWorkspaceToolbar({ model }: MatchWorkspaceToolbarProps) {
  return (
    <div className={cn(actionRowClass, "justify-between")}>
      <nav aria-label="入力画面の操作">
        <LinkButton
          icon={<ArrowLeft aria-hidden="true" />}
          size="sm"
          to={model.exit.href}
          variant="quiet"
        >
          {model.exit.label}
        </LinkButton>
      </nav>
      {model.sample ? (
        <div className="ms-auto">
          <StatusBadge {...workspaceSampleStatus} />
        </div>
      ) : null}
    </div>
  );
}

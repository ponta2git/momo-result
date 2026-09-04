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
    <div className={cn(actionRowClass, model.sample ? "justify-between" : "justify-end")}>
      {model.sample ? <StatusBadge {...workspaceSampleStatus} /> : null}
      <nav aria-label="入力画面の操作">
        <LinkButton size="sm" to={model.exit.href} variant="quiet">
          {model.exit.label}
        </LinkButton>
      </nav>
    </div>
  );
}

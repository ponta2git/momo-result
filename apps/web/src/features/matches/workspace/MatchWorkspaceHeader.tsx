import type { MatchWorkspaceHeaderModel } from "@/features/matches/workspace/matchWorkspacePageModelTypes";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { PageHeader } from "@/shared/ui/layout/PageHeader";
import { workspaceSampleHeaderStatus } from "@/shared/workflows/matchWorkspacePresentation";

type MatchWorkspaceHeaderProps = {
  model: MatchWorkspaceHeaderModel;
};

export function MatchWorkspaceHeader({ model }: MatchWorkspaceHeaderProps) {
  return (
    <PageHeader
      actions={
        <LinkButton size="sm" to={model.exit.href} variant="quiet">
          {model.exit.label}
        </LinkButton>
      }
      description={model.description}
      descriptionStatus={model.sample ? workspaceSampleHeaderStatus : undefined}
      title={model.title}
    />
  );
}

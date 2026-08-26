import type { MatchWorkspaceControllerModel } from "@/features/matches/workspace/matchWorkspaceControllerModel";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

type MatchWorkspaceHeaderProps = {
  model: MatchWorkspaceControllerModel["navigation"]["header"];
};

export function MatchWorkspaceHeader({ model }: MatchWorkspaceHeaderProps) {
  return (
    <PageHeader
      actions={
        <LinkButton size="sm" to={model.exit.href} variant="quiet">
          {model.exit.label}
        </LinkButton>
      }
      description={
        <>
          {model.description}
          {model.sample ? (
            <span className="mt-2 block w-fit rounded-full border border-[var(--color-warning)]/65 bg-[var(--color-warning)]/18 px-3 py-1 text-sm font-semibold text-[var(--color-text-primary)]">
              サンプルの読み取り結果で表示中
            </span>
          ) : null}
        </>
      }
      title={model.title}
    />
  );
}

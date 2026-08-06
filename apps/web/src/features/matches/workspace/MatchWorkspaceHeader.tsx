import type { MatchWorkspaceController } from "@/features/matches/workspace/useMatchWorkspaceController";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

type MatchWorkspaceHeaderProps = {
  header: MatchWorkspaceController["header"];
};

export function MatchWorkspaceHeader({ header }: MatchWorkspaceHeaderProps) {
  return (
    <PageHeader
      actions={
        <LinkButton size="sm" to={header.cancelHref} variant="quiet">
          {header.cancelLabel}
        </LinkButton>
      }
      description={
        <>
          {header.pageDescription}
          {header.useSampleDrafts ? (
            <span className="mt-2 block w-fit rounded-full border border-[var(--color-warning)]/65 bg-[var(--color-warning)]/18 px-3 py-1 text-sm font-semibold text-[var(--color-text-primary)]">
              サンプルの読み取り結果で表示中
            </span>
          ) : null}
        </>
      }
      eyebrow="試合記録"
      title={header.pageTitle}
    />
  );
}

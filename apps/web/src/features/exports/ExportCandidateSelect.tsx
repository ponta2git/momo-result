import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { MomoTransitBackdrop } from "@/shared/ui/feedback/MomoTransitBackdrop";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { SelectField } from "@/shared/ui/forms/SelectField";

import type { ExportScope } from "./exportTypes";
import type { ExportCandidateView } from "./exportViewModel";

type ExportCandidateSelectProps = {
  disabled?: boolean;
  onChange: (value: string) => void;
  scope: ExportScope;
  view: ExportCandidateView;
};

function labelForScope(scope: ExportScope): string {
  if (scope === "season") return "シーズン";
  if (scope === "heldEvent") return "開催";
  if (scope === "match") return "試合";
  return "候補";
}

export function ExportCandidateSelect({
  disabled,
  onChange,
  scope,
  view,
}: ExportCandidateSelectProps) {
  if (view.kind === "hidden") return null;

  if (view.kind === "loading") {
    return (
      <div aria-busy="true" aria-label={`${labelForScope(scope)}候補を読み込み中`}>
        <Skeleton className="h-10 min-w-64" />
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">候補を読み込んでいます。</p>
      </div>
    );
  }

  if (view.kind === "error") {
    return (
      <Notice tone="danger" title={view.message}>
        しばらくしてから再読み込みしてください。
      </Notice>
    );
  }

  if (view.kind === "empty") {
    return (
      <EmptyState
        action={
          <LinkButton to={view.actionHref} variant="secondary">
            {view.actionLabel}
          </LinkButton>
        }
        className="relative min-h-52 overflow-hidden sm:pr-56"
        description={
          <>
            <span className="relative z-[var(--z-base)] block max-w-[28rem]">{view.message}</span>
            <MomoTransitBackdrop />
          </>
        }
        title={view.title}
      />
    );
  }

  const options = view.selectedUnknown
    ? [{ label: view.selectedLabel, value: view.selectedId }, ...view.candidates]
    : view.candidates;

  return (
    <div className="grid gap-2">
      <SelectField
        disabled={disabled}
        label={labelForScope(scope)}
        options={options}
        selectClassName="min-w-64"
        value={view.selectedId}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {view.selectedUnknown ? (
        <Notice tone="warning" title="一覧にない対象が指定されています">
          指定された対象が存在する場合は、このまま出力できます。別の対象を選ぶこともできます。
        </Notice>
      ) : null}
    </div>
  );
}

import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { SelectField } from "@/shared/ui/forms/SelectField";

import { ExportCandidatePickerDialog } from "./ExportCandidatePickerDialog";
import type { ExportScope } from "./exportTypes";
import { candidateDisplayLabel } from "./exportViewModel";
import type { ExportCandidateView } from "./exportViewModel";

type ExportCandidateSelectProps = {
  disabled?: boolean;
  onChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onRetry: () => void;
  refreshing?: boolean;
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
  onPageChange,
  onRetry,
  refreshing = false,
  scope,
  view,
}: ExportCandidateSelectProps) {
  if (view.kind === "hidden") return null;

  if (view.kind === "loading") {
    return (
      <div
        aria-busy="true"
        aria-label={`${labelForScope(scope)}候補を読み込み中`}
        className="momo-enter grid gap-2"
      >
        <p className="text-sm leading-5 font-semibold text-[var(--color-text-primary)]">
          {labelForScope(scope)}
        </p>
        <Skeleton className="h-11 w-full" />
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">候補を読み込んでいます。</p>
      </div>
    );
  }

  if (view.kind === "error") {
    return (
      <Notice
        action={
          <Button size="sm" variant="secondary" onClick={onRetry}>
            再読み込み
          </Button>
        }
        className="momo-enter"
        tone="danger"
        title={view.message}
      >
        通信状態を確認して、もう一度お試しください。
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
        className="momo-enter"
        description={view.message}
        title={view.title}
      />
    );
  }

  const options = view.selectedUnknown
    ? [{ label: view.selectedLabel, value: view.selectedId }, ...view.candidates]
    : view.candidates;
  const selector =
    scope === "heldEvent" || scope === "match" ? (
      <ExportCandidatePickerDialog
        disabled={disabled}
        refreshing={refreshing}
        scope={scope}
        view={view}
        onChange={onChange}
        onPageChange={onPageChange}
      />
    ) : (
      <SelectField
        disabled={disabled}
        label={labelForScope(scope)}
        options={options.map((option) => ({
          label: candidateDisplayLabel(option),
          value: option.value,
        }))}
        selectClassName="min-h-11"
        value={view.selectedId}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    );

  return (
    <div className="grid gap-2">
      {selector}
      {refreshing ? (
        <p className="text-sm text-[var(--color-text-secondary)]" role="status">
          出力対象を確認しています。
        </p>
      ) : null}
      {view.selectedResolving ? null : view.selectedUnknown ? (
        <Notice tone="warning" title="一覧にない対象が指定されています">
          指定された対象が存在する場合は、このまま出力できます。別の対象を選ぶこともできます。
        </Notice>
      ) : null}
    </div>
  );
}

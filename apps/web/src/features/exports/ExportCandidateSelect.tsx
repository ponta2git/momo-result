import type { ReactNode } from "react";

import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { SelectField } from "@/shared/ui/forms/SelectField";

import { ExportCandidatePickerDialog } from "./ExportCandidatePickerDialog";
import type { ExportScope } from "./exportTypes";
import { candidateDisplayLabel } from "./exportViewModel";
import type { ExportCandidateSupportIssue, ExportCandidateView } from "./exportViewModel";

type ExportCandidateSelectProps = {
  disabled?: boolean;
  onChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onRetry: () => void;
  onSelectedCandidateRetry: () => void;
  onScopeChange: (scope: ExportScope) => void;
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
  onSelectedCandidateRetry,
  onScopeChange,
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
          <Button size="sm" onClick={onRetry}>
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
    const emptyAction = view.action;
    const action =
      emptyAction.kind === "link" ? (
        <LinkButton to={emptyAction.href}>{emptyAction.label}</LinkButton>
      ) : (
        <Button disabled={disabled} onClick={() => onScopeChange(emptyAction.scope)}>
          {emptyAction.label}
        </Button>
      );

    return (
      <div className="grid gap-3">
        <EmptyState
          action={action}
          className="momo-enter"
          description={view.message}
          title={view.title}
        />
        {view.supportIssue ? (
          <CandidateSupportNotice issue={view.supportIssue} onRetry={onRetry} />
        ) : null}
      </div>
    );
  }

  const hasUnresolvedSelection = view.selectionState !== "resolved";
  const options = hasUnresolvedSelection
    ? [{ label: view.selectedLabel, value: view.selectedId }, ...view.candidates]
    : view.candidates;
  const canChooseAnother = view.candidates.length > 0;
  let selector: ReactNode = null;
  if (scope === "heldEvent" || scope === "match") {
    if (canChooseAnother) {
      selector = (
        <ExportCandidatePickerDialog
          disabled={disabled}
          recovery={view.selectionState === "not-found"}
          refreshing={refreshing}
          scope={scope}
          view={view}
          onChange={onChange}
          onPageChange={onPageChange}
        />
      );
    } else if (view.selectionState === "resolved") {
      selector = (
        <div className="grid gap-2">
          <p className="text-sm leading-5 font-semibold text-[var(--color-text-primary)]">
            {labelForScope(scope)}
          </p>
          <p className="min-h-11 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2 text-sm font-medium text-[var(--color-text-primary)]">
            {view.selectedLabel}
          </p>
        </div>
      );
    }
  } else {
    selector = (
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
  }

  return (
    <div className="grid gap-2">
      {selector}
      {refreshing ? (
        <p className="text-sm text-[var(--color-text-secondary)]" role="status">
          出力対象を確認しています。
        </p>
      ) : null}
      {view.selectionState === "not-found" ? (
        <Notice
          action={
            canChooseAnother ? undefined : (
              <Button size="sm" onClick={() => onScopeChange("all")}>
                全試合へ切り替え
              </Button>
            )
          }
          tone="warning"
          title={`指定された${labelForScope(scope)}が見つかりません`}
        >
          {canChooseAnother
            ? `候補から別の${labelForScope(scope)}を選んでください。`
            : "出力対象を選べないため、出力範囲を変更してください。"}
        </Notice>
      ) : null}
      {view.selectionState === "load-failed" ? (
        <Notice
          action={
            <Button size="sm" onClick={onSelectedCandidateRetry}>
              指定対象を再確認
            </Button>
          }
          tone="danger"
          title={`指定された${labelForScope(scope)}を確認できませんでした`}
        >
          通信状態を確認して、同じ対象をもう一度確認するか、別の対象を選んでください。
        </Notice>
      ) : null}
      {view.supportIssue ? (
        <CandidateSupportNotice issue={view.supportIssue} onRetry={onRetry} />
      ) : null}
    </div>
  );
}

function CandidateSupportNotice({
  issue,
  onRetry,
}: {
  issue: ExportCandidateSupportIssue;
  onRetry: () => void;
}) {
  const title =
    issue.directory === "load-failed"
      ? "出力候補を読み込めませんでした"
      : issue.names === "load-failed"
        ? "候補の表示名を取得できませんでした"
        : issue.directory === "refresh-failed"
          ? "出力候補を更新できませんでした"
          : issue.names === "refresh-failed"
            ? "候補の表示名を更新できませんでした"
            : "選択中の出力対象を更新できませんでした";
  const details = [
    issue.directory === "load-failed"
      ? "指定された出力対象は確認できているため、このままダウンロードできます。別の対象へ変更するための候補一覧だけ取得できませんでした。"
      : issue.directory === "refresh-failed"
        ? "取得済みの候補と選択内容を保持しています。利用可能な操作はそのまま続けられます。"
        : undefined,
    issue.names === "load-failed"
      ? "取得できなかった名称は「未取得」と表示しています。出力対象とダウンロードはそのまま利用できます。"
      : issue.names === "refresh-failed"
        ? "取得済みの名称を保持しています。表示中の出力対象とダウンロードはそのまま利用できます。"
        : undefined,
    issue.selectedTarget === "refresh-failed" ? "確認済みの選択内容を保持しています。" : undefined,
  ].filter((detail): detail is string => Boolean(detail));

  return (
    <Notice
      action={
        <Button size="sm" variant="secondary" onClick={onRetry}>
          出力候補を再取得
        </Button>
      }
      tone="warning"
      title={title}
    >
      {details.join(" ")}
    </Notice>
  );
}

import type { ReactNode } from "react";
import { useState } from "react";

import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { controlBorderClass } from "@/shared/ui/forms/controlPresentation";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { contentText, fieldText } from "@/shared/ui/typography";

import { ExportCandidatePickerDialog } from "./ExportCandidatePickerDialog";
import { candidateDisplayLabel } from "./exportPresentation";
import type { ExportCandidateSupportIssue, ExportCandidateView } from "./exportPresentation";
import type { ExportScope } from "./exportTypes";

type ExportCandidateSelectProps = {
  disabled?: boolean;
  onChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onRetry: () => void;
  onSelectedCandidateRetry: () => void;
  onScopeChange: (scope: ExportScope) => void;
  refreshing?: boolean;
  scopeChanging?: boolean;
  scope: ExportScope;
  view: ExportCandidateView;
};

function labelForScope(scope: ExportScope): string {
  if (scope === "season") return "シーズン";
  if (scope === "heldEvent") return "開催";
  if (scope === "match") return "試合";
  return "候補";
}

/** Season selection has no picker dialog to report checks, so it keeps its own status line. */
const candidateStatusLineClass = cn(contentText.body, "min-h-5");

/** Loading, failure, and empty states keep the field label that the scope tab already fixes. */
function CandidateFieldState({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="grid gap-2">
      <p className={fieldText.label}>{label}</p>
      {children}
    </div>
  );
}

export function ExportCandidateSelect({
  disabled,
  onChange,
  onPageChange,
  onRetry,
  onSelectedCandidateRetry,
  onScopeChange,
  refreshing = false,
  scopeChanging = false,
  scope,
  view,
}: ExportCandidateSelectProps) {
  const [requestedRetryOwner, setRequestedRetryOwner] = useState<"selection" | "support">();
  const retrySelection = () => {
    setRequestedRetryOwner("selection");
    onSelectedCandidateRetry();
  };
  const retrySupport = () => {
    setRequestedRetryOwner("support");
    onRetry();
  };
  if (view.kind === "hidden") return null;
  const label = labelForScope(scope);
  const hasStatusLine = scope === "season";

  if (view.kind === "loading") {
    return (
      <div aria-label={`${label}候補を読み込み中`} className="grid gap-1" role="status">
        <CandidateFieldState label={label}>
          <Skeleton className="h-11 w-full rounded-sm pointer-fine:h-10" />
        </CandidateFieldState>
        <p className={hasStatusLine ? candidateStatusLineClass : "sr-only"}>
          候補を読み込んでいます。
        </p>
      </div>
    );
  }

  if (view.kind === "error") {
    return (
      <CandidateFieldState label={label}>
        <Notice
          action={
            <Button
              pending={refreshing}
              pendingLabel="再読み込み中"
              size="sm"
              variant="secondary"
              onClick={onRetry}
            >
              再読み込み
            </Button>
          }
          tone="danger"
          title={view.message}
        >
          通信状態を確認して、もう一度お試しください。
        </Notice>
      </CandidateFieldState>
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
      <div className="grid gap-4">
        <CandidateFieldState label={label}>
          <EmptyState
            action={action}
            description={view.message}
            placement="embedded"
            title={view.title}
          />
        </CandidateFieldState>
        {view.supportIssue ? (
          <CandidateSupportNotice
            issue={view.supportIssue}
            pending={refreshing}
            onRetry={onRetry}
          />
        ) : null}
      </div>
    );
  }

  const retryOwner =
    requestedRetryOwner === "support" && view.supportIssue
      ? "support"
      : view.selectionState === "load-failed"
        ? "selection"
        : "support";
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
          scopeChanging={scopeChanging}
          scope={scope}
          view={view}
          onChange={onChange}
          onPageChange={onPageChange}
        />
      );
    } else if (view.selectionState === "resolved") {
      // With nothing else to choose, the value keeps the field's frame, height, and text.
      selector = (
        <CandidateFieldState label={label}>
          <p
            className={cn(
              "flex min-h-11 items-center rounded-sm border px-3 py-2 pointer-fine:min-h-10",
              "font-plain text-base leading-6 text-pretty text-[var(--color-text-primary)] sm:text-sm sm:leading-5",
              controlBorderClass.default,
            )}
          >
            {view.selectedLabel}
          </p>
        </CandidateFieldState>
      );
    }
  } else {
    selector = (
      <SelectField
        disabled={disabled}
        label={label}
        options={options.map((option) => ({
          label: candidateDisplayLabel(option),
          value: option.value,
        }))}
        value={view.selectedId}
        onValueChange={(nextValue) => onChange(nextValue)}
      />
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-1 empty:hidden">
        {selector}
        {hasStatusLine ? (
          <p className={candidateStatusLineClass} role="status">
            {refreshing &&
            !scopeChanging &&
            !view.supportIssue &&
            view.selectionState !== "load-failed"
              ? "出力対象を確認しています。"
              : null}
          </p>
        ) : null}
      </div>
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
          title={`指定された${label}が見つかりません`}
        >
          {canChooseAnother
            ? `候補から別の${label}を選んでください。`
            : "出力対象を選べないため、出力範囲を変更してください。"}
        </Notice>
      ) : null}
      {view.selectionState === "load-failed" ? (
        <Notice
          action={
            <Button
              pending={refreshing && retryOwner === "selection"}
              pendingLabel="再確認中"
              size="sm"
              variant="secondary"
              onClick={retrySelection}
            >
              指定対象を再確認
            </Button>
          }
          tone="danger"
          title={`指定された${label}を確認できませんでした`}
        >
          通信状態を確認して、同じ対象をもう一度確認するか、別の対象を選んでください。
        </Notice>
      ) : null}
      {view.supportIssue ? (
        <CandidateSupportNotice
          issue={view.supportIssue}
          pending={refreshing && retryOwner === "support"}
          onRetry={retrySupport}
        />
      ) : null}
    </div>
  );
}

function CandidateSupportNotice({
  pending,
  issue,
  onRetry,
}: {
  issue: ExportCandidateSupportIssue;
  pending: boolean;
  onRetry: () => void;
}) {
  const title =
    issue.directory === "load-failed"
      ? "出力候補を読み込めませんでした"
      : issue.directory === "refresh-failed"
        ? "出力候補を更新できませんでした"
        : "選択中の出力対象を更新できませんでした";
  const details = [
    issue.directory === "load-failed"
      ? "指定された出力対象は確認できているため、このままダウンロードできます。別の対象へ変更するための候補一覧だけ取得できませんでした。"
      : issue.directory === "refresh-failed"
        ? "取得済みの候補と選択内容を保持しています。利用可能な操作はそのまま続けられます。"
        : undefined,
    issue.selectedTarget === "refresh-failed" ? "確認済みの選択内容を保持しています。" : undefined,
  ].filter((detail): detail is string => Boolean(detail));

  return (
    <Notice
      action={
        <Button
          pending={pending}
          pendingLabel="再取得中"
          size="sm"
          variant="secondary"
          onClick={onRetry}
        >
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

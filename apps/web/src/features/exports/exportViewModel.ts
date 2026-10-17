import type { NormalizedApiError } from "@/shared/api/problemDetails";
import type { PaginationState } from "@/shared/lib/pagination";

import type {
  ExportCandidate,
  ExportDownloadOutcome,
  ExportFormat,
  ExportScope,
} from "./exportTypes";
import { isExportSelectionReady } from "./exportUrlState";
import type { ExportUrlState } from "./exportUrlState";

export const exportFormats = [
  { label: "CSV", value: "csv" },
  { label: "TSV", value: "tsv" },
] as const;
export const exportScopes = [
  { label: "全試合", value: "all" },
  { label: "シーズン", value: "season" },
  { label: "開催", value: "heldEvent" },
  { label: "試合", value: "match" },
] as const;

export type ExportCandidateSupportIssue = {
  readonly directory?: "load-failed" | "refresh-failed" | undefined;
  readonly selectedTarget?: "refresh-failed" | undefined;
};

export function buildCandidateSupportIssue(input: {
  directoryBlocking: boolean;
  directoryError: boolean;
  hasCurrentDirectoryData: boolean;
  selectedTargetRefreshFailed: boolean;
}): ExportCandidateSupportIssue | undefined {
  const directory =
    input.directoryError && !input.directoryBlocking
      ? input.hasCurrentDirectoryData
        ? "refresh-failed"
        : "load-failed"
      : undefined;
  if (!directory && !input.selectedTargetRefreshFailed) return undefined;
  return {
    directory,
    selectedTarget: input.selectedTargetRefreshFailed ? "refresh-failed" : undefined,
  };
}

export type ExportCandidateView =
  | {
      readonly action:
        | { readonly href: string; readonly kind: "link"; readonly label: string }
        | {
            readonly kind: "scope";
            readonly label: string;
            readonly scope: Extract<ExportScope, "all">;
          };
      readonly kind: "empty";
      readonly message: string;
      readonly supportIssue?: ExportCandidateSupportIssue | undefined;
      readonly title: string;
    }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "hidden" }
  | { readonly kind: "loading" }
  | {
      readonly candidates: readonly ExportCandidate[];
      readonly kind: "ready";
      readonly pagination?: Readonly<PaginationState> | undefined;
      readonly selectedId: string;
      readonly selectedLabel: string;
      readonly selectionState: "load-failed" | "not-found" | "resolved" | "resolving";
      readonly supportIssue?: ExportCandidateSupportIssue | undefined;
    };

export type ExportDownloadResultView =
  | { readonly kind: "failed"; readonly detail: string; readonly title: string }
  | {
      readonly fileName: string;
      readonly format: ExportFormat;
      readonly kind: "success";
      readonly startedAt: string;
    }
  | { readonly detail: string; readonly kind: "timeout"; readonly title: string };

export type ExportActionAvailability = {
  readonly actionLabel: string;
  readonly canDownload: boolean;
  readonly errors: readonly string[];
  readonly summaryText: string;
};

export type ExportActionView = ExportActionAvailability & {
  readonly isSlow: boolean;
  readonly result?: ExportDownloadResultView | undefined;
};

export type ExportSelectionView = {
  readonly action: ExportActionAvailability;
  readonly candidate: ExportCandidateView;
  readonly candidateRefreshing: boolean;
  readonly format: ExportFormat;
  readonly scope: ExportScope;
};

export function buildCandidateView(input: {
  candidates: readonly ExportCandidate[];
  error?: boolean;
  loading: boolean;
  pagination?: PaginationState | undefined;
  resolvedCandidate?: ExportCandidate | undefined;
  selectedResolution?: "load-failed" | "not-found" | "resolved" | "resolving" | undefined;
  scope: ExportScope;
  selectedId: string;
  supportIssue?: ExportCandidateSupportIssue | undefined;
}): ExportCandidateView {
  if (input.scope === "all") return { kind: "hidden" };
  if (input.error) return { kind: "error", message: "候補を読み込めませんでした。" };
  if (input.loading) return { kind: "loading" };

  if (input.candidates.length === 0 && !input.selectedId) {
    if (input.scope === "season") {
      return {
        action: { kind: "scope", label: "全試合へ切り替え", scope: "all" },
        kind: "empty",
        message: "出力範囲に使えるシーズンがまだありません。",
        supportIssue: input.supportIssue,
        title: "シーズン候補がありません",
      };
    }
    return {
      action:
        input.scope === "heldEvent"
          ? { href: "/held-events", kind: "link", label: "開催履歴へ" }
          : { href: "/matches", kind: "link", label: "試合一覧へ" },
      kind: "empty",
      message:
        input.scope === "heldEvent"
          ? "出力範囲に使える開催履歴がまだありません。"
          : "確定済み試合がまだありません。",
      supportIssue: input.supportIssue,
      title: input.scope === "heldEvent" ? "開催候補がありません" : "試合候補がありません",
    };
  }

  const selected =
    input.candidates.find((candidate) => candidate.value === input.selectedId) ??
    (input.resolvedCandidate?.value === input.selectedId ? input.resolvedCandidate : undefined);
  if (selected) {
    return {
      candidates: input.candidates,
      kind: "ready",
      pagination: input.pagination,
      selectedId: input.selectedId,
      selectedLabel: candidateDisplayLabel(selected),
      selectionState: "resolved",
      supportIssue: input.supportIssue,
    };
  }

  if (input.selectedId) {
    const selectionState = input.selectedResolution ?? "not-found";
    const scopeLabelText = scopeLabel(input.scope);
    return {
      candidates: input.candidates,
      kind: "ready",
      pagination: input.pagination,
      selectedId: input.selectedId,
      selectedLabel:
        selectionState === "resolving"
          ? `指定された${scopeLabelText}を確認しています`
          : "出力対象が未確定です",
      selectionState,
      supportIssue: input.supportIssue,
    };
  }

  const first = input.candidates[0];
  return {
    candidates: input.candidates,
    kind: "ready",
    pagination: input.pagination,
    selectedId: first?.value ?? "",
    selectedLabel: first ? candidateDisplayLabel(first) : "",
    selectionState: "resolved",
    supportIssue: input.supportIssue,
  };
}

export function candidateDisplayLabel(candidate: ExportCandidate): string {
  return candidate.description ? `${candidate.label} — ${candidate.description}` : candidate.label;
}

function scopeLabel(scope: ExportScope): string {
  return exportScopes.find((item) => item.value === scope)?.label ?? "全試合";
}

function actionSubject(scope: ExportScope): string {
  if (scope === "season") return "このシーズン";
  if (scope === "heldEvent") return "この開催";
  if (scope === "match") return "この試合";
  return "全試合";
}

function localizedDownloadError(error: NormalizedApiError): { detail: string; title: string } {
  if (error.status === 401 || error.status === 403) {
    return {
      detail: "ログイン状態または利用権限を確認してください。",
      title: "ダウンロードできません",
    };
  }
  if (error.status === 422 || error.code === "VALIDATION_FAILED") {
    return {
      detail: "出力条件に問題があります。条件を確認して、もう一度お試しください。",
      title: "出力条件を確認してください",
    };
  }
  if (error.status === 404) {
    return {
      detail: "選択した対象が削除された可能性があります。対象を選び直してください。",
      title: "出力対象が見つかりません",
    };
  }
  return {
    detail: "通信状態を確認し、時間をおいてもう一度お試しください。",
    title: "ダウンロードに失敗しました",
  };
}

function summaryText(
  scope: ExportScope,
  candidate: ExportCandidateView,
  formatLabel: string,
): string {
  if (scope === "all") {
    return `すべての確定済み試合を${formatLabel}で書き出します。`;
  }
  if (
    candidate.kind === "ready" &&
    candidate.selectionState === "resolved" &&
    candidate.selectedLabel
  ) {
    return `${candidate.selectedLabel}を${formatLabel}で書き出します。`;
  }
  return `${scopeLabel(scope)}の出力対象を選択してください。`;
}

export function buildExportSelectionView(input: {
  candidate: ExportCandidateView;
  candidateRefreshing?: boolean | undefined;
  urlState: ExportUrlState;
}): ExportSelectionView {
  const formatLabel = input.urlState.format.toUpperCase();
  return {
    action: {
      actionLabel: `${actionSubject(input.urlState.scope)}を${formatLabel}でダウンロード`,
      canDownload: isExportSelectionReady(input.urlState, input.candidate),
      errors: input.urlState.errors,
      summaryText: summaryText(input.urlState.scope, input.candidate, formatLabel),
    },
    candidate: input.candidate,
    candidateRefreshing: input.candidateRefreshing === true,
    format: input.urlState.format,
    scope: input.urlState.scope,
  };
}

export function failedResultView(
  error: NormalizedApiError,
): Extract<ExportDownloadResultView, { kind: "failed" }> {
  const localized = localizedDownloadError(error);
  return {
    detail: localized.detail,
    kind: "failed",
    title: localized.title,
  };
}

export function exportDownloadResultView(
  outcome: ExportDownloadOutcome,
): ExportDownloadResultView | undefined {
  if (outcome.kind === "cancelled") return undefined;
  if (outcome.kind === "download_started") {
    return {
      fileName: outcome.fileName,
      format: outcome.format,
      kind: "success",
      startedAt: outcome.startedAt,
    };
  }
  if (outcome.kind === "timeout") {
    return { detail: outcome.detail, kind: "timeout", title: outcome.title };
  }
  return failedResultView(outcome.error);
}

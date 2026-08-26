import type { NormalizedApiError } from "@/shared/api/problemDetails";
import type { PaginationState } from "@/shared/lib/pagination";

import type { ExportCandidate, ExportFormat, ExportScope } from "./exportTypes";
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
  directory?: "load-failed" | "refresh-failed" | undefined;
  names?: "load-failed" | "refresh-failed" | undefined;
  selectedTarget?: "refresh-failed" | undefined;
};

export function buildCandidateSupportIssue(input: {
  directoryBlocking: boolean;
  directoryError: boolean;
  hasCurrentDirectoryData: boolean;
  namesError: boolean;
  namesLoadFailed: boolean;
  selectedTargetRefreshFailed: boolean;
}): ExportCandidateSupportIssue | undefined {
  const directory =
    input.directoryError && !input.directoryBlocking
      ? input.hasCurrentDirectoryData
        ? "refresh-failed"
        : "load-failed"
      : undefined;
  const names = input.namesError
    ? input.namesLoadFailed
      ? "load-failed"
      : "refresh-failed"
    : undefined;
  if (!directory && !names && !input.selectedTargetRefreshFailed) return undefined;
  return {
    directory,
    names,
    selectedTarget: input.selectedTargetRefreshFailed ? "refresh-failed" : undefined,
  };
}

export type ExportCandidateView =
  | {
      action:
        | { href: string; kind: "link"; label: string }
        | { kind: "scope"; label: string; scope: Extract<ExportScope, "all"> };
      kind: "empty";
      message: string;
      supportIssue?: ExportCandidateSupportIssue | undefined;
      title: string;
    }
  | { kind: "error"; message: string }
  | { kind: "hidden" }
  | { kind: "loading" }
  | {
      candidates: ExportCandidate[];
      kind: "ready";
      pagination?: PaginationState | undefined;
      selectedId: string;
      selectedLabel: string;
      selectionState: "load-failed" | "not-found" | "resolved" | "resolving";
      supportIssue?: ExportCandidateSupportIssue | undefined;
    };

export type ExportDownloadResultView =
  | { kind: "failed"; detail: string; title: string }
  | { fileName: string; format: ExportFormat; kind: "success"; startedAt: string }
  | { detail: string; kind: "timeout"; title: string };

export type ExportViewModel = {
  actionLabel: string;
  candidate: ExportCandidateView;
  candidateRefreshing: boolean;
  canDownload: boolean;
  errors: string[];
  format: ExportFormat;
  formatLabel: string;
  isSlow: boolean;
  result?: ExportDownloadResultView | undefined;
  scope: ExportScope;
  selectedId: string;
  summaryText: string;
};

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

export function buildCandidateView(input: {
  candidates: ExportCandidate[];
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

  const selected = input.candidates.find((candidate) => candidate.value === input.selectedId);
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

  if (input.resolvedCandidate?.value === input.selectedId) {
    return {
      candidates: input.candidates,
      kind: "ready",
      pagination: input.pagination,
      selectedId: input.selectedId,
      selectedLabel: candidateDisplayLabel(input.resolvedCandidate),
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

export function buildExportViewModel(input: {
  candidate: ExportCandidateView;
  candidateRefreshing?: boolean | undefined;
  elapsedMs: number;
  isPending: boolean;
  lastResult?: ExportDownloadResultView | undefined;
  slowThresholdMs: number;
  urlState: ExportUrlState;
}): ExportViewModel {
  const formatLabel = input.urlState.format.toUpperCase();
  const candidateReady =
    input.urlState.scope === "all" ||
    (input.candidate.kind === "ready" &&
      input.candidate.selectionState === "resolved" &&
      input.candidate.selectedId.length > 0);
  const isSlow = input.isPending && input.elapsedMs >= input.slowThresholdMs;

  return {
    actionLabel: `${actionSubject(input.urlState.scope)}を${formatLabel}でダウンロード`,
    candidate: input.candidate,
    candidateRefreshing: input.candidateRefreshing === true,
    canDownload: !input.isPending && input.urlState.errors.length === 0 && candidateReady,
    errors: input.urlState.errors,
    format: input.urlState.format,
    formatLabel,
    isSlow,
    result: input.lastResult,
    scope: input.urlState.scope,
    selectedId: input.candidate.kind === "ready" ? input.candidate.selectedId : "",
    summaryText: summaryText(input.urlState.scope, input.candidate, formatLabel),
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

import type { NormalizedApiError } from "@/shared/api/problemDetails";
import type { PaginationState } from "@/shared/ui/data/PaginationControls";

import type { ExportCandidate, ExportFormat, ExportScope } from "./exportTypes";
import type { ExportUrlState } from "./exportUrlState";

export const exportFormats = [
  { label: "CSV", value: "csv" },
  { label: "TSV", value: "tsv" },
] as const;

export const exportScopes = [
  { description: "確定済みの全試合を書き出します。", label: "全試合", value: "all" },
  { description: "シーズンを選んで書き出します。", label: "シーズン", value: "season" },
  { description: "開催回を選んで書き出します。", label: "開催", value: "heldEvent" },
  { description: "1試合だけ選んで書き出します。", label: "試合", value: "match" },
] as const;

export type ExportCandidateView =
  | { kind: "empty"; actionHref: string; actionLabel: string; message: string; title: string }
  | { kind: "error"; message: string }
  | { kind: "hidden" }
  | { kind: "loading" }
  | {
      candidates: ExportCandidate[];
      kind: "ready";
      pagination?: PaginationState | undefined;
      selectedId: string;
      selectedLabel: string;
      selectedResolving?: boolean | undefined;
      selectedUnknown: boolean;
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
  resolvingSelected?: boolean | undefined;
  scope: ExportScope;
  selectedId: string;
}): ExportCandidateView {
  if (input.scope === "all") return { kind: "hidden" };
  if (input.error) return { kind: "error", message: "候補を読み込めませんでした。" };
  if (input.loading) return { kind: "loading" };

  if (input.candidates.length === 0 && input.selectedId) {
    if (input.resolvedCandidate?.value === input.selectedId) {
      return {
        candidates: [],
        kind: "ready",
        pagination: input.pagination,
        selectedId: input.selectedId,
        selectedLabel: candidateDisplayLabel(input.resolvedCandidate),
        selectedUnknown: false,
      };
    }
    return {
      candidates: [],
      kind: "ready",
      pagination: input.pagination,
      selectedId: input.selectedId,
      selectedLabel: input.resolvingSelected
        ? "出力対象を確認しています"
        : `指定された対象: ${input.selectedId}`,
      selectedResolving: input.resolvingSelected,
      selectedUnknown: !input.resolvingSelected,
    };
  }

  if (input.candidates.length === 0) {
    if (input.scope === "season") {
      return {
        actionHref: "/admin/masters",
        actionLabel: "設定管理へ",
        kind: "empty",
        message: "出力範囲に使えるシーズンがまだありません。",
        title: "シーズン候補がありません",
      };
    }
    return {
      actionHref: "/matches",
      actionLabel: "試合一覧へ",
      kind: "empty",
      message:
        input.scope === "heldEvent"
          ? "出力範囲に使える開催履歴がまだありません。"
          : "確定済み試合がまだありません。",
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
      selectedUnknown: false,
    };
  }

  if (input.resolvedCandidate?.value === input.selectedId) {
    return {
      candidates: input.candidates,
      kind: "ready",
      pagination: input.pagination,
      selectedId: input.selectedId,
      selectedLabel: candidateDisplayLabel(input.resolvedCandidate),
      selectedUnknown: false,
    };
  }

  if (input.selectedId) {
    return {
      candidates: input.candidates,
      kind: "ready",
      pagination: input.pagination,
      selectedId: input.selectedId,
      selectedLabel: input.resolvingSelected
        ? "出力対象を確認しています"
        : `指定された対象: ${input.selectedId}`,
      selectedResolving: input.resolvingSelected,
      selectedUnknown: !input.resolvingSelected,
    };
  }

  const first = input.candidates[0];
  return {
    candidates: input.candidates,
    kind: "ready",
    pagination: input.pagination,
    selectedId: first?.value ?? "",
    selectedLabel: first ? candidateDisplayLabel(first) : "",
    selectedUnknown: false,
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
  if (candidate.kind === "ready" && candidate.selectedLabel) {
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
    (input.candidate.kind === "ready" && input.candidate.selectedId.length > 0);
  const isSlow = input.isPending && input.elapsedMs >= input.slowThresholdMs;

  return {
    actionLabel: `${actionSubject(input.urlState.scope)}を${formatLabel}でダウンロード`,
    candidate: input.candidate,
    candidateRefreshing: input.candidateRefreshing === true,
    canDownload:
      !input.isPending &&
      !input.candidateRefreshing &&
      input.urlState.errors.length === 0 &&
      candidateReady,
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

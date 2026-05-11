import type { NormalizedApiError } from "@/shared/api/problemDetails";

import type { ExportCandidate, ExportFormat, ExportScope } from "./exportTypes";
import type { ExportUrlState } from "./exportUrlState";

export const exportFormats = [
  { label: "CSV", value: "csv" },
  { label: "TSV", value: "tsv" },
] as const;

export const exportScopes = [
  { description: "全試合をまとめて書き出します。", label: "全試合", value: "all" },
  { description: "シーズンで絞り込みます。", label: "シーズン", value: "season" },
  { description: "開催回で絞り込みます。", label: "開催", value: "heldEvent" },
  { description: "1試合だけを書き出します。", label: "試合", value: "match" },
] as const;

export type ExportCandidateView =
  | { kind: "empty"; actionHref: string; actionLabel: string; message: string; title: string }
  | { kind: "error"; message: string }
  | { kind: "hidden" }
  | { kind: "loading" }
  | {
      candidates: ExportCandidate[];
      kind: "ready";
      selectedId: string;
      selectedLabel: string;
      selectedUnknown: boolean;
    };

export type ExportDownloadResultView =
  | { kind: "failed"; detail: string; title: string }
  | { fileName: string; format: ExportFormat; kind: "success"; startedAt: string }
  | { detail: string; kind: "timeout"; title: string };

export type ExportViewModel = {
  actionLabel: string;
  candidate: ExportCandidateView;
  canDownload: boolean;
  disableReason?: string | undefined;
  errors: string[];
  format: ExportFormat;
  formatLabel: string;
  isSlow: boolean;
  result?: ExportDownloadResultView | undefined;
  scope: ExportScope;
  scopeDescription: string;
  scopeLabel: string;
  selectedId: string;
  ticketRows: Array<{ label: string; value: string }>;
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
  scope: ExportScope;
  selectedId: string;
}): ExportCandidateView {
  if (input.scope === "all") return { kind: "hidden" };
  if (input.error) return { kind: "error", message: "候補を読み込めませんでした。" };
  if (input.loading) return { kind: "loading" };

  if (input.candidates.length === 0 && input.selectedId) {
    return {
      candidates: [],
      kind: "ready",
      selectedId: input.selectedId,
      selectedLabel: `選択中ID: ${input.selectedId}`,
      selectedUnknown: true,
    };
  }

  if (input.candidates.length === 0) {
    if (input.scope === "season") {
      return {
        actionHref: "/admin/masters",
        actionLabel: "マスタ管理へ",
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
      selectedId: input.selectedId,
      selectedLabel: selected.label,
      selectedUnknown: false,
    };
  }

  if (input.selectedId) {
    return {
      candidates: input.candidates,
      kind: "ready",
      selectedId: input.selectedId,
      selectedLabel: `選択中ID: ${input.selectedId}`,
      selectedUnknown: true,
    };
  }

  const first = input.candidates[0];
  return {
    candidates: input.candidates,
    kind: "ready",
    selectedId: first?.value ?? "",
    selectedLabel: first?.label ?? "",
    selectedUnknown: false,
  };
}

function scopeLabel(scope: ExportScope): string {
  return exportScopes.find((item) => item.value === scope)?.label ?? "全試合";
}

function scopeDescription(scope: ExportScope): string {
  return (
    exportScopes.find((item) => item.value === scope)?.description ??
    "全試合をまとめて書き出します。"
  );
}

function errorDetail(error: NormalizedApiError): string {
  if (error.status === 401 || error.status === 403) {
    return "ログイン状態または権限を確認してください。";
  }
  if (error.status === 422) {
    return error.detail || "出力条件を確認してください。";
  }
  if (error.status === 404) {
    return error.detail || "選択候補または出力対象が見つかりませんでした。";
  }
  return error.detail || error.title;
}

export function buildExportViewModel(input: {
  candidate: ExportCandidateView;
  elapsedMs: number;
  isPending: boolean;
  lastResult?: ExportDownloadResultView | undefined;
  slowThresholdMs: number;
  urlState: ExportUrlState;
}): ExportViewModel {
  const formatLabel = input.urlState.format.toUpperCase();
  const candidateNeedsSelection =
    input.urlState.scope !== "all" &&
    (input.candidate.kind !== "ready" || input.candidate.selectedId.length === 0);
  const disableReason =
    input.urlState.errors[0] ??
    (input.candidate.kind === "error" ? input.candidate.message : undefined) ??
    (candidateNeedsSelection ? "出力範囲の候補を選択してください。" : undefined);
  const selectedLabel =
    input.urlState.scope === "all"
      ? "全ての確定済み試合"
      : input.candidate.kind === "ready"
        ? input.candidate.selectedLabel
        : "未選択";
  const isSlow = input.isPending && input.elapsedMs >= input.slowThresholdMs;

  return {
    actionLabel: `${formatLabel}をダウンロード`,
    candidate: input.candidate,
    canDownload: !input.isPending && !disableReason,
    disableReason,
    errors: input.urlState.errors,
    format: input.urlState.format,
    formatLabel,
    isSlow,
    result: input.lastResult,
    scope: input.urlState.scope,
    scopeDescription: scopeDescription(input.urlState.scope),
    scopeLabel: scopeLabel(input.urlState.scope),
    selectedId: input.candidate.kind === "ready" ? input.candidate.selectedId : "",
    ticketRows: [
      { label: "形式", value: formatLabel },
      { label: "対象", value: scopeLabel(input.urlState.scope) },
      { label: "選択中", value: selectedLabel },
    ],
  };
}

export function failedResultView(
  error: NormalizedApiError,
): Extract<ExportDownloadResultView, { kind: "failed" }> {
  return {
    detail: errorDetail(error),
    kind: "failed",
    title: error.title,
  };
}

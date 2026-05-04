import type { NormalizedApiError } from "@/shared/api/problemDetails";

export type ExportFormat = "csv" | "tsv";
export type ExportScope = "all" | "season" | "heldEvent" | "match";

export type ExportScopeIds = {
  heldEventId?: string | undefined;
  matchId?: string | undefined;
  seasonMasterId?: string | undefined;
};

export type ExportMatchesRequest = ExportScopeIds & {
  format: ExportFormat;
  scope: ExportScope;
};

export type ExportCandidate = {
  description?: string | undefined;
  label: string;
  value: string;
};

export type ExportDownloadSuccess = {
  contentType: string;
  fileName: string;
  format: ExportFormat;
  kind: "download_started";
  startedAt: string;
};

export type ExportDownloadTimeout = {
  detail: string;
  kind: "timeout";
  title: string;
};

export type ExportDownloadFailed = {
  error: NormalizedApiError;
  kind: "failed";
};

export type ExportDownloadOutcome =
  | ExportDownloadFailed
  | ExportDownloadSuccess
  | ExportDownloadTimeout;

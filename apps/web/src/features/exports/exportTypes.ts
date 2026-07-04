import type {
  ExportMatchesFormat,
  ExportMatchesRequest,
  ExportMatchesScope,
} from "@/shared/api/exports";
import type { NormalizedApiError } from "@/shared/api/problemDetails";

export type ExportFormat = ExportMatchesFormat;
export type ExportScope = ExportMatchesScope;
export type { ExportMatchesRequest };

export type ExportScopeIds = {
  heldEventId?: string | undefined;
  matchId?: string | undefined;
  seasonMasterId?: string | undefined;
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

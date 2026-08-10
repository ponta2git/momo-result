import type { SeriesAnalysisStatusResponse } from "@/shared/api/seriesAnalysisCoreTypes";

export type SeriesAnalysisJobStatus = NonNullable<
  SeriesAnalysisStatusResponse["calculation"]
>["status"];
export type SeriesAnalysisTrigger = NonNullable<
  SeriesAnalysisStatusResponse["calculation"]
>["trigger"];
export type SeriesAnalysisRequestDisposition =
  | "coalesced_into_queued_job"
  | "created_job"
  | "forced_run_reserved";
export type SeriesAnalysisResultDisposition = "none" | "published" | "reused";
export type SeriesAnalysisSafeFailureCode =
  | "artifact_too_large"
  | "artifact_validation_failed"
  | "calculation_failed"
  | "dependency_retry_exhausted"
  | "hard_timeout"
  | "input_contract_invalid"
  | "input_revision_violation"
  | "lease_recovery_exhausted"
  | "non_deterministic_output"
  | "publication_failed"
  | "resource_exhausted"
  | "temporary_storage_exhausted"
  | "worker_crashed";

export type SeriesAnalysisJobSummary = {
  algorithmVersion: string;
  attemptCount: number;
  coalescedTriggers: SeriesAnalysisTrigger[];
  elapsedMilliseconds: number | null;
  finishedAt: string | null;
  firstManualRequester: null | { accountId: string; displayName: string };
  gameTitleId: string;
  gameTitleName: string;
  inputRevision: string;
  jobId: string;
  leaseRecoveryCount: number;
  manualRequestCount: number;
  queueWaitMilliseconds: number | null;
  requestedAt: string;
  requestedBy: "administrator" | "mixed" | "system";
  resultDisposition: SeriesAnalysisResultDisposition;
  safeFailureCode: SeriesAnalysisSafeFailureCode | null;
  startedAt: string | null;
  status: SeriesAnalysisJobStatus;
  transientRetryCount: number;
  trigger: SeriesAnalysisTrigger;
};

export type SeriesAnalysisAdminOverview = {
  globalExecution: {
    activeCampaignCount: number;
    latestActiveCampaign: null | {
      acceptedAt: string;
      campaignId: string;
      expandedCount: number;
      failedCount: number;
      skippedCount: number;
      targetCount: number;
      terminalCount: number;
    };
    oldestQueuedAt: string | null;
    queuedTitleCount: number;
    runningCount: 0 | 1;
  };
  recentJobs: SeriesAnalysisJobSummary[];
  schemaVersion: 1;
  selectedTitle: null | {
    gameTitleId: string;
    gameTitleName: string;
    pendingManualRun: null | { oldestRequestedAt: string; requestCount: number };
    status: SeriesAnalysisStatusResponse;
  };
  titleOptions: Array<{
    confirmedMatchCount: number;
    gameTitleId: string;
    gameTitleName: string;
  }>;
};

export type SeriesAnalysisRecalculationAccepted = {
  acceptedAt: string;
  campaign: null | { campaignId: string; status: "expanding" | "queued" };
  requestId: string;
  schemaVersion: 1;
  target: null | {
    gameTitleId: string;
    jobId: string | null;
    requestDisposition: SeriesAnalysisRequestDisposition;
  };
  targetCount: number;
};

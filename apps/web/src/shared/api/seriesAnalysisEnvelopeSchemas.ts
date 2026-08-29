import { z } from "zod";

import type {
  SeriesAnalysisAdminOverview,
  SeriesAnalysisRecalculationAccepted,
} from "@/shared/api/seriesAnalysisAdminTypes";
import type {
  SeriesAnalysisOptionsResponse,
  SeriesAnalysisStatusResponse,
} from "@/shared/api/seriesAnalysisCoreTypes";

const jobStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "timed_out"]);
const triggerSchema = z.enum([
  "manual",
  "artifact_schema_update",
  "algorithm_update",
  "initial_backfill",
  "match_mutation",
]);
const requestDispositionSchema = z.enum([
  "coalesced_into_queued_job",
  "created_job",
  "forced_run_reserved",
]);
const safeFailureCodeSchema = z.enum([
  "input_contract_invalid",
  "input_revision_violation",
  "calculation_failed",
  "artifact_validation_failed",
  "artifact_too_large",
  "non_deterministic_output",
  "dependency_retry_exhausted",
  "lease_recovery_exhausted",
  "worker_crashed",
  "hard_timeout",
  "resource_exhausted",
  "temporary_storage_exhausted",
  "publication_failed",
]);
const integerSchema = z.number().int();
const nullableStringSchema = z.string().nullable();

const desiredSchema = z.strictObject({
  inputRevision: z.string(),
  algorithmVersion: z.string(),
  artifactSchemaVersion: integerSchema,
});

const artifactRefSchema = z.strictObject({
  artifactId: z.string(),
  gameTitleId: z.string(),
  inputRevision: z.string(),
  algorithmVersion: z.string(),
  artifactSchemaVersion: integerSchema,
  publishedAt: z.string(),
});

const calculationSchema = z.strictObject({
  status: jobStatusSchema,
  trigger: triggerSchema,
  requestedAt: z.string(),
  startedAt: nullableStringSchema,
  finishedAt: nullableStringSchema,
});

const statusSchema: z.ZodType<SeriesAnalysisStatusResponse> = z.strictObject({
  schemaVersion: z.literal(1),
  gameTitleId: z.string(),
  desired: desiredSchema,
  artifactFreshness: z.enum(["current", "stale", "unavailable"]),
  currentArtifact: artifactRefSchema.nullable(),
  calculation: calculationSchema.nullable(),
});

const optionsSchema: z.ZodType<SeriesAnalysisOptionsResponse> = z.strictObject({
  schemaVersion: z.literal(1),
  defaultGameTitleId: nullableStringSchema,
  titles: z.array(
    z.strictObject({
      gameTitleId: z.string(),
      displayName: z.string(),
      confirmedMatchCount: integerSchema,
      seasons: z.array(
        z.strictObject({
          seasonMasterId: z.string(),
          displayName: z.string(),
        }),
      ),
      maps: z.array(
        z.strictObject({
          mapMasterId: z.string(),
          displayName: z.string(),
        }),
      ),
      seasonMapPairs: z.array(
        z.strictObject({
          seasonMasterId: z.string(),
          mapMasterId: z.string(),
        }),
      ),
    }),
  ),
});

const campaignSummarySchema = z.strictObject({
  campaignId: z.string(),
  targetCount: integerSchema,
  expandedCount: integerSchema,
  terminalCount: integerSchema,
  failedCount: integerSchema,
  skippedCount: integerSchema,
  acceptedAt: z.string(),
});

const jobSummarySchema = z.strictObject({
  jobId: z.string(),
  gameTitleId: z.string(),
  gameTitleName: z.string(),
  status: jobStatusSchema,
  trigger: triggerSchema,
  coalescedTriggers: z.array(triggerSchema),
  requestedBy: z.enum(["administrator", "mixed", "system"]),
  manualRequestCount: integerSchema,
  requestedAt: z.string(),
  startedAt: nullableStringSchema,
  finishedAt: nullableStringSchema,
  elapsedMilliseconds: integerSchema.nullable(),
  inputRevision: z.string(),
  algorithmVersion: z.string(),
  attemptCount: integerSchema,
  transientRetryCount: integerSchema,
  leaseRecoveryCount: integerSchema,
  queueWaitMilliseconds: integerSchema.nullable(),
  resultDisposition: z.enum(["none", "published", "reused"]),
  firstManualRequester: z
    .strictObject({
      accountId: z.string(),
      displayName: z.string(),
    })
    .nullable(),
  safeFailureCode: safeFailureCodeSchema.nullable(),
});

const adminOverviewSchema: z.ZodType<SeriesAnalysisAdminOverview> = z.strictObject({
  schemaVersion: z.literal(1),
  titleOptions: z.array(
    z.strictObject({
      gameTitleId: z.string(),
      gameTitleName: z.string(),
      confirmedMatchCount: integerSchema,
    }),
  ),
  selectedTitle: z
    .strictObject({
      gameTitleId: z.string(),
      gameTitleName: z.string(),
      status: statusSchema,
      pendingManualRun: z
        .strictObject({
          requestCount: integerSchema,
          oldestRequestedAt: z.string(),
        })
        .nullable(),
    })
    .nullable(),
  globalExecution: z.strictObject({
    runningCount: integerSchema,
    queuedTitleCount: integerSchema,
    oldestQueuedAt: nullableStringSchema,
    activeCampaignCount: integerSchema,
    latestActiveCampaign: campaignSummarySchema.nullable(),
  }),
  recentJobs: z.array(jobSummarySchema),
});

const recalculationAcceptedSchema: z.ZodType<SeriesAnalysisRecalculationAccepted> = z.strictObject({
  schemaVersion: z.literal(1),
  requestId: z.string(),
  acceptedAt: z.string(),
  targetCount: integerSchema,
  campaign: z
    .strictObject({
      campaignId: z.string(),
      status: z.literal("expanding"),
    })
    .nullable(),
  target: z
    .strictObject({
      gameTitleId: z.string(),
      jobId: nullableStringSchema,
      requestDisposition: requestDispositionSchema,
    })
    .nullable(),
});

export function decodeSeriesAnalysisOptions(value: unknown): SeriesAnalysisOptionsResponse {
  return optionsSchema.parse(value);
}

export function decodeSeriesAnalysisStatus(value: unknown): SeriesAnalysisStatusResponse {
  return statusSchema.parse(value);
}

export function decodeSeriesAnalysisAdminOverview(value: unknown): SeriesAnalysisAdminOverview {
  return adminOverviewSchema.parse(value);
}

export function decodeSeriesAnalysisRecalculationAccepted(
  value: unknown,
): SeriesAnalysisRecalculationAccepted {
  return recalculationAcceptedSchema.parse(value);
}

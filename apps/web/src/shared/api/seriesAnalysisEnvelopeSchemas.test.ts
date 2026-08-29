import { describe, expect, it } from "vitest";

import {
  decodeSeriesAnalysisAdminOverview,
  decodeSeriesAnalysisOptions,
  decodeSeriesAnalysisRecalculationAccepted,
  decodeSeriesAnalysisStatus,
} from "@/shared/api/seriesAnalysisEnvelopeSchemas";
import {
  makeSeriesAnalysisAdminOverview,
  makeSeriesAnalysisOptions,
  makeSeriesAnalysisStatus,
} from "@/test/msw/seriesAnalysisFixtures";

describe("series analysis envelope decoders", () => {
  it("accepts every supported envelope shape", async () => {
    await expect(decodeSeriesAnalysisOptions(makeSeriesAnalysisOptions())).resolves.toEqual(
      makeSeriesAnalysisOptions(),
    );
    await expect(decodeSeriesAnalysisStatus(makeSeriesAnalysisStatus())).resolves.toEqual(
      makeSeriesAnalysisStatus(),
    );
    await expect(
      decodeSeriesAnalysisAdminOverview(makeSeriesAnalysisAdminOverview()),
    ).resolves.toEqual(makeSeriesAnalysisAdminOverview());
    await expect(
      decodeSeriesAnalysisRecalculationAccepted({
        acceptedAt: "2026-08-29T00:00:00Z",
        campaign: { campaignId: "campaign-1", status: "expanding" },
        requestId: "request-1",
        schemaVersion: 1,
        target: null,
        targetCount: 1,
      }),
    ).resolves.toBeDefined();
  });

  it("rejects unsupported schema versions and vocabulary values", async () => {
    await expect(
      decodeSeriesAnalysisStatus({
        ...makeSeriesAnalysisStatus(),
        schemaVersion: 2,
      }),
    ).rejects.toThrow();
    await expect(
      decodeSeriesAnalysisStatus({
        ...makeSeriesAnalysisStatus(),
        calculation: {
          ...makeSeriesAnalysisStatus().calculation,
          status: "waiting",
        },
      }),
    ).rejects.toThrow();

    const overview = makeSeriesAnalysisAdminOverview();
    await expect(
      decodeSeriesAnalysisAdminOverview({
        ...overview,
        recentJobs: [{ ...overview.recentJobs[0], safeFailureCode: "new_failure" }],
      }),
    ).rejects.toThrow();
    await expect(
      decodeSeriesAnalysisRecalculationAccepted({
        acceptedAt: "2026-08-29T00:00:00Z",
        campaign: { campaignId: "campaign-1", status: "queued" },
        requestId: "request-1",
        schemaVersion: 1,
        target: null,
        targetCount: 1,
      }),
    ).rejects.toThrow();
  });

  it("rejects omitted required-nullable fields, omitted arrays, and unknown keys", async () => {
    const statusWithoutCalculation: Record<string, unknown> = { ...makeSeriesAnalysisStatus() };
    delete statusWithoutCalculation["calculation"];
    await expect(decodeSeriesAnalysisStatus(statusWithoutCalculation)).rejects.toThrow();

    const optionsWithoutTitles: Record<string, unknown> = { ...makeSeriesAnalysisOptions() };
    delete optionsWithoutTitles["titles"];
    await expect(decodeSeriesAnalysisOptions(optionsWithoutTitles)).rejects.toThrow();

    await expect(
      decodeSeriesAnalysisOptions({
        ...makeSeriesAnalysisOptions(),
        futureField: true,
      }),
    ).rejects.toThrow();
  });
});

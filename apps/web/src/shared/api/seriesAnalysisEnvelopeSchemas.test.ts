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
  it("accepts every supported envelope shape", () => {
    expect(decodeSeriesAnalysisOptions(makeSeriesAnalysisOptions())).toEqual(
      makeSeriesAnalysisOptions(),
    );
    expect(decodeSeriesAnalysisStatus(makeSeriesAnalysisStatus())).toEqual(
      makeSeriesAnalysisStatus(),
    );
    expect(decodeSeriesAnalysisAdminOverview(makeSeriesAnalysisAdminOverview())).toEqual(
      makeSeriesAnalysisAdminOverview(),
    );
    expect(
      decodeSeriesAnalysisRecalculationAccepted({
        acceptedAt: "2026-08-29T00:00:00Z",
        campaign: { campaignId: "campaign-1", status: "expanding" },
        requestId: "request-1",
        schemaVersion: 1,
        target: null,
        targetCount: 1,
      }),
    ).toBeDefined();
  });

  it("rejects unsupported schema versions and vocabulary values", () => {
    expect(() =>
      decodeSeriesAnalysisStatus({
        ...makeSeriesAnalysisStatus(),
        schemaVersion: 2,
      }),
    ).toThrow();
    expect(() =>
      decodeSeriesAnalysisStatus({
        ...makeSeriesAnalysisStatus(),
        calculation: {
          ...makeSeriesAnalysisStatus().calculation,
          status: "waiting",
        },
      }),
    ).toThrow();

    const overview = makeSeriesAnalysisAdminOverview();
    expect(() =>
      decodeSeriesAnalysisAdminOverview({
        ...overview,
        recentJobs: [{ ...overview.recentJobs[0], safeFailureCode: "new_failure" }],
      }),
    ).toThrow();
    expect(() =>
      decodeSeriesAnalysisRecalculationAccepted({
        acceptedAt: "2026-08-29T00:00:00Z",
        campaign: { campaignId: "campaign-1", status: "queued" },
        requestId: "request-1",
        schemaVersion: 1,
        target: null,
        targetCount: 1,
      }),
    ).toThrow();
  });

  it("rejects omitted required-nullable fields, omitted arrays, and unknown keys", () => {
    const statusWithoutCalculation: Record<string, unknown> = { ...makeSeriesAnalysisStatus() };
    delete statusWithoutCalculation["calculation"];
    expect(() => decodeSeriesAnalysisStatus(statusWithoutCalculation)).toThrow();

    const optionsWithoutTitles: Record<string, unknown> = { ...makeSeriesAnalysisOptions() };
    delete optionsWithoutTitles["titles"];
    expect(() => decodeSeriesAnalysisOptions(optionsWithoutTitles)).toThrow();

    expect(() =>
      decodeSeriesAnalysisOptions({
        ...makeSeriesAnalysisOptions(),
        futureField: true,
      }),
    ).toThrow();
  });
});

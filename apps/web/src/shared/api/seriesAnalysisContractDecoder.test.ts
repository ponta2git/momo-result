import { describe, expect, it } from "vitest";

import { decodeSeriesAnalysisContract } from "@/shared/api/seriesAnalysisContractDecoder";

describe("series analysis contract decoder", () => {
  it("retries schema compilation after a transient load failure", async () => {
    let attempts = 0;
    const loadSchema = () => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error("temporary schema load failure"));
      return { type: "string" };
    };

    await expect(
      decodeSeriesAnalysisContract("test:transient", "test", loadSchema, "valid"),
    ).rejects.toThrow("temporary schema load failure");
    await expect(
      decodeSeriesAnalysisContract("test:transient", "test", loadSchema, "valid"),
    ).resolves.toBe("valid");
    expect(attempts).toBe(2);
  });
});

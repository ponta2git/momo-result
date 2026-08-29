import { describe, expect, it } from "vitest";

import { decodeSeriesAnalysisContract } from "@/shared/api/seriesAnalysisContractDecoder";

describe("series analysis contract decoder", () => {
  it("retries validator loading after a transient failure", async () => {
    let attempts = 0;
    const loadValidator = () => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error("temporary validator load failure"));
      return Object.assign((value: unknown) => typeof value === "string", { errors: null });
    };

    await expect(
      decodeSeriesAnalysisContract("test:transient", "test", loadValidator, "valid"),
    ).rejects.toThrow("temporary validator load failure");
    await expect(
      decodeSeriesAnalysisContract("test:transient", "test", loadValidator, "valid"),
    ).resolves.toBe("valid");
    expect(attempts).toBe(2);
  });
});

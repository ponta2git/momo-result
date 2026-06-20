// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { installAnchorClickMock, installFetchMock, installObjectUrlMock } from "@/test/doubles/dom";

import { downloadExportMatches } from "./exportDownload";

describe("exportDownload", () => {
  it("starts the browser download and revokes the blob URL", async () => {
    const anchorClick = installAnchorClickMock();
    const objectUrls = installObjectUrlMock({ createObjectURL: () => "blob:test-download" });
    installFetchMock(
      async () =>
        new Response("csv", {
          headers: {
            "Content-Disposition": 'attachment; filename="momo-results.csv"',
            "Content-Type": "text/csv",
          },
        }),
    );

    const result = await downloadExportMatches({ format: "csv", scope: "all" });

    expect(result).toMatchObject({
      fileName: "momo-results.csv",
      format: "csv",
      kind: "download_started",
    });
    expect(anchorClick.click).toHaveBeenCalledTimes(1);
    expect(anchorClick.clickedAnchors[0]?.getAttribute("href")).toBe("blob:test-download");
    expect(anchorClick.clickedAnchors[0]?.download).toBe("momo-results.csv");
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith("blob:test-download");
  });

  it("returns timeout when the client abort timer fires", async () => {
    vi.useFakeTimers();
    installFetchMock(
      (_path, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );

    const resultPromise = downloadExportMatches({ format: "csv", scope: "all" }, { timeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(10);

    await expect(resultPromise).resolves.toMatchObject({
      kind: "timeout",
      title: "出力が完了しませんでした",
    });
  });
});

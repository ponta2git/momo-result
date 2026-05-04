import { describe, expect, it, vi } from "vitest";

import { downloadExportMatches } from "./exportDownload";

describe("exportDownload", () => {
  it("starts the browser download and revokes the blob URL", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-download");
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("csv", {
            headers: {
              "Content-Disposition": 'attachment; filename="momo-results.csv"',
              "Content-Type": "text/csv",
            },
          }),
      ),
    );

    const result = await downloadExportMatches({ format: "csv", scope: "all" });

    expect(result).toMatchObject({
      fileName: "momo-results.csv",
      format: "csv",
      kind: "download_started",
    });
    expect(revokeSpy).toHaveBeenCalledWith("blob:test-download");
  });

  it("returns timeout when the client abort timer fires", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_path: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }),
      ),
    );

    const resultPromise = downloadExportMatches({ format: "csv", scope: "all" }, { timeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(10);

    await expect(resultPromise).resolves.toMatchObject({
      kind: "timeout",
      title: "出力が完了しませんでした",
    });
  });
});

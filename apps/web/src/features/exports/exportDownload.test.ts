// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createDeferred } from "@/test/deferred";
import { installAnchorClickMock, installFetchMock, installObjectUrlMock } from "@/test/doubles/dom";

import { downloadExportMatches } from "./exportDownload";

describe("exportDownload", () => {
  it("starts the browser download before revoking the blob URL", async () => {
    vi.useFakeTimers();
    const csv = '\uFEFFプレーヤー,総資産\r\n"ぽんた",210000\r\n';
    const anchorClick = installAnchorClickMock();
    const objectUrls = installObjectUrlMock({ createObjectURL: () => "blob:test-download" });
    installFetchMock(
      async () =>
        new Response(csv, {
          headers: {
            "Content-Disposition": 'attachment; filename="momo-results.csv"',
            "Content-Type": "text/csv; charset=utf-8",
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
    const blob = objectUrls.createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe("text/csv;charset=utf-8");
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual(
      Array.from(new TextEncoder().encode(csv)),
    );
    expect(anchorClick.clickedAnchors[0]?.isConnected).toBe(false);
    expect(objectUrls.revokeObjectURL).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:test-download");
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

  it("does not start a browser download if cancellation wins before the response arrives", async () => {
    const response = createDeferred<Response>();
    const controller = new AbortController();
    const anchorClick = installAnchorClickMock();
    // A transport may finish despite cancellation; the download side effect still needs ownership.
    installFetchMock(() => response.promise);

    const result = downloadExportMatches(
      { format: "csv", scope: "all" },
      { signal: controller.signal },
    );
    controller.abort();
    response.resolve(new Response("csv", { headers: { "Content-Type": "text/csv" } }));

    await expect(result).resolves.toEqual({ kind: "cancelled" });
    expect(anchorClick.click).not.toHaveBeenCalled();
  });
});

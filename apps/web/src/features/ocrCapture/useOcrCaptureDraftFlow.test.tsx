import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { useOcrCaptureDraftFlow } from "@/features/ocrCapture/useOcrCaptureDraftFlow";
import { createDeferred } from "@/test/deferred";
import { installObjectUrlMock } from "@/test/doubles/dom";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

const feedback = {
  reportFailure: vi.fn(),
  reportSuccess: vi.fn(),
};

function renderDraftFlow() {
  const queryClient = createTestQueryClient();
  return renderHook(() => useOcrCaptureDraftFlow(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

describe("useOcrCaptureDraftFlow", () => {
  it("refreshes the same job explicitly while suppressing duplicate in-flight commands", async () => {
    const refreshGate = createDeferred<void>();
    let requestCount = 0;
    server.use(
      http.get("/api/ocr-jobs/:jobId", async () => {
        requestCount += 1;
        if (requestCount > 1) await refreshGate.promise;
        return HttpResponse.json({
          attemptCount: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          imageId: "image-1",
          jobId: "job-1",
          requestedScreenType: "total_assets",
          status: "running",
          updatedAt: "2026-01-01T00:00:00.000Z",
        });
      }),
    );
    const view = renderDraftFlow();

    act(() => {
      view.result.current.updateSlot({
        jobId: "job-1",
        kind: "total_assets",
        status: "queued",
      });
    });
    await waitFor(() => expect(requestCount).toBe(1));
    await waitFor(() => expect(view.result.current.statusRefreshing.total_assets).toBe(false));

    act(() => {
      view.result.current.handleRefreshStatus("total_assets");
      view.result.current.handleRefreshStatus("total_assets");
    });
    await waitFor(() => expect(requestCount).toBe(2));
    expect(view.result.current.statusRefreshing.total_assets).toBe(true);

    act(() => view.result.current.handleRefreshStatus("total_assets"));
    expect(requestCount).toBe(2);

    act(() => refreshGate.resolve());
    await waitFor(() => expect(view.result.current.statusRefreshing.total_assets).toBe(false));
  });

  it("releases replaced and currently owned object URLs", () => {
    const objectUrls = installObjectUrlMock({
      createObjectURL: (value) => (value instanceof File ? `blob:${value.name}` : "blob:unknown"),
    });
    const view = renderDraftFlow();

    act(() => {
      view.result.current.handleAddImage(
        new File(["first"], "first.png", { type: "image/png" }),
        "upload",
        "total_assets",
        feedback,
      );
    });
    expect(view.result.current.slots[0]?.previewUrl).toBe("blob:first.png");

    act(() => {
      view.result.current.handleAddImage(
        new File(["second"], "second.png", { type: "image/png" }),
        "upload",
        "total_assets",
        feedback,
      );
    });
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith("blob:first.png");

    view.unmount();
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith("blob:second.png");
  });
});

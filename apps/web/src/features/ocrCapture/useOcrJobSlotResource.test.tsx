import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import { useOcrJobSlotResource } from "@/features/ocrCapture/useOcrJobSlotResource";
import * as ocrDraftsApi from "@/shared/api/ocrDrafts";
import type { OcrDraftResponse } from "@/shared/api/ocrDrafts";
import type { NormalizedApiError } from "@/shared/api/problemDetails";
import { ocrDraftKeys } from "@/shared/api/queryKeys";
import { createDeferred } from "@/test/deferred";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

let queryClient: QueryClient;

function renderResource({
  onDraftLoadError = vi.fn(),
  slot,
}: {
  onDraftLoadError?: (error: NormalizedApiError) => void;
  slot: CaptureSlotState;
}) {
  const view = renderHook(
    ({ currentSlot }: { currentSlot: CaptureSlotState }) =>
      useOcrJobSlotResource(currentSlot, onDraftLoadError),
    {
      initialProps: { currentSlot: slot },
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    },
  );
  return {
    ...view,
    onDraftLoadError,
    rerenderSlot: (nextSlot: CaptureSlotState) => view.rerender({ currentSlot: nextSlot }),
  };
}

function runningJobResponse() {
  return {
    attemptCount: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    imageId: "image-1",
    jobId: "job-1",
    requestedScreenType: "total_assets",
    status: "running",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function succeededJobResponse() {
  return {
    ...runningJobResponse(),
    detectedScreenType: "total_assets",
    draftId: "draft-1",
    status: "succeeded",
  };
}

function ocrDraftResponse(): OcrDraftResponse {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    detectedScreenType: "total_assets",
    draftId: "draft-1",
    jobId: "job-1",
    payloadJson: { players: [] },
    requestedScreenType: "total_assets",
    timingsMsJson: {},
    updatedAt: "2026-01-01T00:00:00.000Z",
    warningsJson: [],
  };
}

const runningSlot: CaptureSlotState = {
  kind: "total_assets",
  jobId: "job-1",
  status: "running",
};

describe("useOcrJobSlotResource", () => {
  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  it("loads once automatically and deduplicates explicit refresh commands for the same job", async () => {
    const refreshGate = createDeferred<void>();
    let statusRequestCount = 0;
    server.use(
      http.get("/api/ocr-jobs/:jobId", async () => {
        statusRequestCount += 1;
        if (statusRequestCount > 1) await refreshGate.promise;
        return HttpResponse.json(runningJobResponse());
      }),
    );
    const view = renderResource({ slot: runningSlot });

    await waitFor(() => expect(statusRequestCount).toBe(1));
    await waitFor(() => expect(view.result.current.refreshing).toBe(false));

    vi.useFakeTimers();
    try {
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("online"));
        await vi.advanceTimersByTimeAsync(10 * 60 * 1_000);
      });
      expect(statusRequestCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }

    act(() => {
      view.result.current.refresh();
      view.result.current.refresh();
    });
    await waitFor(() => expect(statusRequestCount).toBe(2));
    expect(view.result.current.refreshing).toBe(true);

    act(() => refreshGate.resolve());
    await waitFor(() => expect(view.result.current.refreshing).toBe(false));
    expect(statusRequestCount).toBe(2);
  });

  it("keeps a status request failure recoverable in the display-ready slot", async () => {
    const refreshGate = createDeferred<void>();
    let requestCount = 0;
    server.use(
      http.get("/api/ocr-jobs/:jobId", async () => {
        requestCount += 1;
        if (requestCount > 1) {
          await refreshGate.promise;
          return HttpResponse.json(runningJobResponse());
        }
        return HttpResponse.json(
          {
            code: "SERVICE_UNAVAILABLE",
            detail: "try again later",
            status: 503,
            title: "Service Unavailable",
            type: "about:blank",
          },
          { status: 503 },
        );
      }),
    );
    const view = renderResource({ slot: runningSlot });

    await waitFor(() =>
      expect(view.result.current.slot.transportError).toEqual(
        expect.objectContaining({
          detail: "現在処理を完了できません。少し待ってから、もう一度実行してください。",
        }),
      ),
    );

    act(() => view.result.current.refresh());
    await waitFor(() => expect(view.result.current.refreshing).toBe(true));
    expect(view.result.current.slot.transportError).toBeUndefined();

    act(() => refreshGate.resolve());
    await waitFor(() => expect(view.result.current.refreshing).toBe(false));
    expect(view.result.current.slot.status).toBe("running");
    expect(view.result.current.slot.transportError).toBeUndefined();
  });

  it("shares a matching draft through the query cache without duplicate requests", async () => {
    let draftRequestCount = 0;
    const draft = ocrDraftResponse();
    server.use(
      http.get("/api/ocr-jobs/:jobId", () => HttpResponse.json(succeededJobResponse())),
      http.get("/api/ocr-drafts/:draftId", () => {
        draftRequestCount += 1;
        return HttpResponse.json(draft);
      }),
    );

    const first = renderResource({ slot: runningSlot });
    const second = renderResource({ slot: runningSlot });

    await waitFor(() => expect(first.result.current.draft).toEqual(draft));
    await waitFor(() => expect(second.result.current.draft).toEqual(draft));
    expect(draftRequestCount).toBe(1);
    expect(queryClient.getQueryData(ocrDraftKeys.detail("draft-1"))).toEqual(draft);
    expect(first.onDraftLoadError).not.toHaveBeenCalled();
    expect(second.onDraftLoadError).not.toHaveBeenCalled();
  });

  it("marks a succeeded job without a draft id as failed without requesting a draft", async () => {
    const refreshGate = createDeferred<void>();
    let draftRequestCount = 0;
    let jobRequestCount = 0;
    server.use(
      http.get("/api/ocr-jobs/:jobId", async () => {
        jobRequestCount += 1;
        if (jobRequestCount > 1) await refreshGate.promise;
        return HttpResponse.json({
          ...runningJobResponse(),
          detectedScreenType: "total_assets",
          status: "succeeded",
        });
      }),
      http.get("/api/ocr-drafts/:draftId", () => {
        draftRequestCount += 1;
        return HttpResponse.json(ocrDraftResponse());
      }),
    );
    const view = renderResource({ slot: runningSlot });

    await waitFor(() => expect(view.result.current.slot.status).toBe("failed"));
    expect(view.result.current.slot.transportError).toEqual(
      expect.objectContaining({ detail: "応答を受け取れませんでした。" }),
    );
    expect(view.result.current.draft).toBeUndefined();
    expect(draftRequestCount).toBe(0);
    expect(view.onDraftLoadError).toHaveBeenCalledWith(
      expect.objectContaining({ detail: "応答を受け取れませんでした。" }),
    );
    expect(view.onDraftLoadError).toHaveBeenCalledTimes(1);

    view.rerenderSlot({ ...runningSlot });
    expect(view.onDraftLoadError).toHaveBeenCalledTimes(1);

    act(() => view.result.current.refresh());
    await waitFor(() => expect(view.result.current.refreshing).toBe(true));
    expect(view.onDraftLoadError).toHaveBeenCalledTimes(1);

    act(() => refreshGate.resolve());
    await waitFor(() => expect(view.result.current.refreshing).toBe(false));
    await waitFor(() => expect(view.onDraftLoadError).toHaveBeenCalledTimes(2));
  });

  it.each([
    ["job id", { jobId: "job-other" }],
    ["draft id", { draftId: "draft-other" }],
  ])("rejects a draft whose %s does not match the completed job", async (_label, identityPatch) => {
    server.use(
      http.get("/api/ocr-jobs/:jobId", () => HttpResponse.json(succeededJobResponse())),
      http.get("/api/ocr-drafts/:draftId", () =>
        HttpResponse.json({ ...ocrDraftResponse(), ...identityPatch }),
      ),
    );
    const view = renderResource({ slot: runningSlot });

    await waitFor(() => expect(view.result.current.slot.status).toBe("failed"));
    expect(view.result.current.slot.draftId).toBe("draft-1");
    expect(view.result.current.draft).toBeUndefined();
    expect(view.onDraftLoadError).toHaveBeenCalledWith(
      expect.objectContaining({ detail: "応答を受け取れませんでした。" }),
    );
  });

  it("marks the slot failed when a completed job draft cannot be read", async () => {
    server.use(
      http.get("/api/ocr-jobs/:jobId", () => HttpResponse.json(succeededJobResponse())),
      http.get("/api/ocr-drafts/:draftId", () =>
        HttpResponse.json(
          {
            code: "OCR_DRAFT_UNAVAILABLE",
            detail: "draft row is not available",
            status: 500,
            title: "OCR Draft Unavailable",
            type: "about:blank",
          },
          { status: 500 },
        ),
      ),
    );
    const view = renderResource({ slot: runningSlot });

    await waitFor(() => expect(view.result.current.slot.status).toBe("failed"));
    expect(view.result.current.slot.transportError).toEqual(
      expect.objectContaining({
        detail: "操作を完了できませんでした。",
        title: "操作を完了できませんでした",
      }),
    );
    expect(view.result.current.draft).toBeUndefined();
    expect(view.onDraftLoadError).toHaveBeenCalledWith(
      expect.objectContaining({ detail: "操作を完了できませんでした。" }),
    );
  });

  it("keeps the job succeeded while its draft loads, then aborts cleanly on unmount", async () => {
    const draftGate = createDeferred<OcrDraftResponse>();
    let draftSignal: AbortSignal | undefined;
    vi.spyOn(ocrDraftsApi, "getOcrDraft").mockImplementation((_draftId, options = {}) => {
      draftSignal = options.signal;
      return draftGate.promise;
    });
    server.use(http.get("/api/ocr-jobs/:jobId", () => HttpResponse.json(succeededJobResponse())));
    const view = renderResource({ slot: runningSlot });

    await waitFor(() => expect(ocrDraftsApi.getOcrDraft).toHaveBeenCalled());
    await waitFor(() => expect(view.result.current.slot.status).toBe("succeeded"));
    expect(view.result.current.draft).toBeUndefined();

    view.unmount();
    expect(draftSignal?.aborted).toBe(true);

    await act(async () => {
      draftGate.resolve(ocrDraftResponse());
      await draftGate.promise;
    });
    expect(view.onDraftLoadError).not.toHaveBeenCalled();
  });

  it("aborts and ignores a delayed draft after the slot is cleared", async () => {
    const draftGate = createDeferred<OcrDraftResponse>();
    let draftSignal: AbortSignal | undefined;
    vi.spyOn(ocrDraftsApi, "getOcrDraft").mockImplementation((_draftId, options = {}) => {
      draftSignal = options.signal;
      return draftGate.promise;
    });
    server.use(http.get("/api/ocr-jobs/:jobId", () => HttpResponse.json(succeededJobResponse())));
    const view = renderResource({ slot: runningSlot });

    await waitFor(() => expect(ocrDraftsApi.getOcrDraft).toHaveBeenCalled());
    await waitFor(() => expect(view.result.current.slot.status).toBe("succeeded"));

    view.rerenderSlot({ kind: "total_assets", status: "empty" });
    expect(draftSignal?.aborted).toBe(true);

    await act(async () => {
      draftGate.resolve(ocrDraftResponse());
      await draftGate.promise;
    });
    expect(view.result.current.slot).toEqual({ kind: "total_assets", status: "empty" });
    expect(view.result.current.draft).toBeUndefined();
    expect(view.onDraftLoadError).not.toHaveBeenCalled();
  });

  it("ignores a delayed draft failure after the slot image is replaced", async () => {
    const draftGate = createDeferred<OcrDraftResponse>();
    let draftSignal: AbortSignal | undefined;
    vi.spyOn(ocrDraftsApi, "getOcrDraft").mockImplementation((_draftId, options = {}) => {
      draftSignal = options.signal;
      return draftGate.promise;
    });
    server.use(http.get("/api/ocr-jobs/:jobId", () => HttpResponse.json(succeededJobResponse())));
    const view = renderResource({ slot: runningSlot });

    await waitFor(() => expect(ocrDraftsApi.getOcrDraft).toHaveBeenCalled());
    await waitFor(() => expect(view.result.current.slot.status).toBe("succeeded"));

    const replacementSlot: CaptureSlotState = {
      file: new File(["replacement"], "replacement.png", { type: "image/png" }),
      kind: "total_assets",
      previewUrl: "blob:replacement",
      source: "upload",
      status: "selected",
    };
    view.rerenderSlot(replacementSlot);
    expect(draftSignal?.aborted).toBe(true);

    await act(async () => {
      draftGate.reject(new Error("stale draft failure"));
      await draftGate.promise.catch(() => undefined);
    });
    expect(view.result.current.slot).toEqual(replacementSlot);
    expect(view.result.current.draft).toBeUndefined();
    expect(view.onDraftLoadError).not.toHaveBeenCalled();
  });
});

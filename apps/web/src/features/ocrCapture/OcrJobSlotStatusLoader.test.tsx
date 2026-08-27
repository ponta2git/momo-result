import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import { OcrJobSlotStatusLoader } from "@/features/ocrCapture/OcrJobSlotStatusLoader";
import * as ocrDraftsApi from "@/shared/api/ocrDrafts";
import type { OcrDraftResponse } from "@/shared/api/ocrDrafts";
import { ocrDraftKeys } from "@/shared/api/queryKeys";
import { createDeferred } from "@/test/deferred";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

let queryClient: QueryClient;

function renderLoader({
  onDraft = vi.fn(),
  onDraftLoadError = vi.fn(),
  onRefreshingChange = vi.fn(),
  onUpdate = vi.fn(),
  slot,
}: {
  onDraft?: Parameters<typeof OcrJobSlotStatusLoader>[0]["onDraft"];
  onDraftLoadError?: Parameters<typeof OcrJobSlotStatusLoader>[0]["onDraftLoadError"];
  onRefreshingChange?: Parameters<typeof OcrJobSlotStatusLoader>[0]["onRefreshingChange"];
  onUpdate?: Parameters<typeof OcrJobSlotStatusLoader>[0]["onUpdate"];
  slot: CaptureSlotState;
}) {
  const renderSlot = (nextSlot: CaptureSlotState) => (
    <QueryClientProvider client={queryClient}>
      <OcrJobSlotStatusLoader
        onDraft={onDraft}
        onDraftLoadError={onDraftLoadError}
        onRefreshingChange={onRefreshingChange}
        onUpdate={onUpdate}
        slot={nextSlot}
      />
    </QueryClientProvider>
  );
  const view = render(renderSlot(slot));
  return {
    onDraft,
    onDraftLoadError,
    onRefreshingChange,
    onUpdate,
    rerenderSlot: (nextSlot: CaptureSlotState) => view.rerender(renderSlot(nextSlot)),
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

describe("OcrJobSlotStatusLoader", () => {
  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  it("loads immediately once and refreshes only after an explicit request", async () => {
    let statusRequestCount = 0;
    server.use(
      http.get("/api/ocr-jobs/:jobId", () => {
        statusRequestCount += 1;
        return HttpResponse.json(runningJobResponse());
      }),
    );

    const slot: CaptureSlotState = {
      kind: "total_assets",
      jobId: "job-1",
      status: "running",
    };
    const view = renderLoader({ slot });

    await waitFor(() => expect(statusRequestCount).toBe(1));

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

    view.rerenderSlot({ ...slot, statusRefreshRequest: 1 });
    await waitFor(() => expect(statusRequestCount).toBe(2));
    expect(view.onRefreshingChange).toHaveBeenCalledWith("total_assets", true);
    await waitFor(() =>
      expect(view.onRefreshingChange).toHaveBeenLastCalledWith("total_assets", false),
    );
  });

  it("keeps a status request failure recoverable by the update action", async () => {
    server.use(
      http.get("/api/ocr-jobs/:jobId", () =>
        HttpResponse.json(
          {
            code: "SERVICE_UNAVAILABLE",
            detail: "try again later",
            status: 503,
            title: "Service Unavailable",
            type: "about:blank",
          },
          { status: 503 },
        ),
      ),
    );

    const { onUpdate } = renderLoader({
      slot: {
        kind: "total_assets",
        jobId: "job-1",
        status: "running",
      },
    });

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "running",
          transportError: expect.objectContaining({
            detail: "現在処理を完了できません。少し待ってから、もう一度実行してください。",
          }),
        }),
      ),
    );
  });

  it("adopts a matching draft through the shared query cache without duplicate requests", async () => {
    let draftRequestCount = 0;
    const draft = ocrDraftResponse();
    server.use(
      http.get("/api/ocr-jobs/:jobId", () => HttpResponse.json(succeededJobResponse())),
      http.get("/api/ocr-drafts/:draftId", () => {
        draftRequestCount += 1;
        return HttpResponse.json(draft);
      }),
    );
    const slot: CaptureSlotState = {
      kind: "total_assets",
      jobId: "job-1",
      status: "running",
    };

    const first = renderLoader({ slot });
    const second = renderLoader({ slot });

    await waitFor(() => expect(first.onDraft).toHaveBeenCalledWith("total_assets", draft));
    await waitFor(() => expect(second.onDraft).toHaveBeenCalledWith("total_assets", draft));
    expect(draftRequestCount).toBe(1);
    expect(queryClient.getQueryData(ocrDraftKeys.detail("draft-1"))).toEqual(draft);
    expect(first.onDraftLoadError).not.toHaveBeenCalled();
    expect(second.onDraftLoadError).not.toHaveBeenCalled();
  });

  it("marks the slot failed without loading a draft when a succeeded job has no draft id", async () => {
    let draftRequestCount = 0;
    server.use(
      http.get("/api/ocr-jobs/:jobId", () =>
        HttpResponse.json({
          ...runningJobResponse(),
          detectedScreenType: "total_assets",
          status: "succeeded",
        }),
      ),
      http.get("/api/ocr-drafts/:draftId", () => {
        draftRequestCount += 1;
        return HttpResponse.json(ocrDraftResponse());
      }),
    );
    const view = renderLoader({
      slot: {
        kind: "total_assets",
        jobId: "job-1",
        status: "running",
      },
    });

    await waitFor(() =>
      expect(view.onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          transportError: expect.objectContaining({
            detail: "応答を受け取れませんでした。",
          }),
        }),
      ),
    );
    expect(draftRequestCount).toBe(0);
    expect(view.onDraft).not.toHaveBeenCalled();
    expect(view.onDraftLoadError).toHaveBeenCalledWith(
      expect.objectContaining({ detail: "応答を受け取れませんでした。" }),
    );
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
    const view = renderLoader({
      slot: {
        kind: "total_assets",
        jobId: "job-1",
        status: "running",
      },
    });

    await waitFor(() =>
      expect(view.onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          draftId: "draft-1",
          status: "failed",
          transportError: expect.objectContaining({
            detail: "応答を受け取れませんでした。",
          }),
        }),
      ),
    );
    expect(view.onDraft).not.toHaveBeenCalled();
    expect(view.onDraftLoadError).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: "応答を受け取れませんでした。",
      }),
    );
  });

  it("marks the slot failed when a succeeded job has an unreadable draft", async () => {
    server.use(
      http.get("/api/ocr-jobs/:jobId", () =>
        HttpResponse.json({
          ...runningJobResponse(),
          detectedScreenType: "total_assets",
          draftId: "draft-unreadable",
          status: "succeeded",
        }),
      ),
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

    const slot: CaptureSlotState = {
      kind: "total_assets",
      jobId: "job-1",
      status: "running",
    };
    const onDraft = vi.fn();
    const onDraftLoadError = vi.fn();
    const onUpdate = vi.fn();

    renderLoader({ onDraft, onDraftLoadError, onUpdate, slot });

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          draftId: "draft-unreadable",
          status: "succeeded",
        }),
      ),
    );
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          transportError: expect.objectContaining({
            detail: "操作を完了できませんでした。",
            title: "操作を完了できませんでした",
          }),
        }),
      ),
    );
    expect(onDraft).not.toHaveBeenCalled();
    expect(onDraftLoadError).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: "操作を完了できませんでした。",
      }),
    );
  });

  it("aborts and ignores a delayed draft result after the slot is cleared", async () => {
    const draftGate = createDeferred<OcrDraftResponse>();
    let draftSignal: AbortSignal | undefined;
    vi.spyOn(ocrDraftsApi, "getOcrDraft").mockImplementation((_draftId, options = {}) => {
      draftSignal = options.signal;
      return draftGate.promise;
    });
    server.use(http.get("/api/ocr-jobs/:jobId", () => HttpResponse.json(succeededJobResponse())));
    const slot: CaptureSlotState = {
      kind: "total_assets",
      jobId: "job-1",
      status: "running",
    };
    const view = renderLoader({ slot });

    await waitFor(() =>
      expect(ocrDraftsApi.getOcrDraft).toHaveBeenCalledWith("draft-1", expect.anything()),
    );
    await waitFor(() =>
      expect(view.onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ draftId: "draft-1", jobId: "job-1", status: "succeeded" }),
      ),
    );
    const updateCountBeforeClear = vi.mocked(view.onUpdate).mock.calls.length;

    view.rerenderSlot({ kind: "total_assets", status: "empty" });
    expect(draftSignal?.aborted).toBe(true);

    await act(async () => {
      draftGate.resolve(ocrDraftResponse());
      await draftGate.promise;
    });

    expect(view.onDraft).not.toHaveBeenCalled();
    expect(view.onDraftLoadError).not.toHaveBeenCalled();
    expect(view.onUpdate).toHaveBeenCalledTimes(updateCountBeforeClear);
  });

  it("ignores a delayed draft failure after the slot image is replaced", async () => {
    const draftGate = createDeferred<OcrDraftResponse>();
    let draftSignal: AbortSignal | undefined;
    vi.spyOn(ocrDraftsApi, "getOcrDraft").mockImplementation((_draftId, options = {}) => {
      draftSignal = options.signal;
      return draftGate.promise;
    });
    server.use(http.get("/api/ocr-jobs/:jobId", () => HttpResponse.json(succeededJobResponse())));
    const slot: CaptureSlotState = {
      kind: "total_assets",
      jobId: "job-1",
      status: "running",
    };
    const view = renderLoader({ slot });

    await waitFor(() => expect(ocrDraftsApi.getOcrDraft).toHaveBeenCalled());
    await waitFor(() =>
      expect(view.onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ draftId: "draft-1", jobId: "job-1", status: "succeeded" }),
      ),
    );
    const updateCountBeforeReplace = vi.mocked(view.onUpdate).mock.calls.length;

    view.rerenderSlot({
      file: new File(["replacement"], "replacement.png", { type: "image/png" }),
      kind: "total_assets",
      previewUrl: "blob:replacement",
      source: "upload",
      status: "selected",
    });
    expect(draftSignal?.aborted).toBe(true);

    await act(async () => {
      draftGate.reject(new Error("stale draft failure"));
      await draftGate.promise.catch(() => undefined);
    });

    expect(view.onDraft).not.toHaveBeenCalled();
    expect(view.onDraftLoadError).not.toHaveBeenCalled();
    expect(view.onUpdate).toHaveBeenCalledTimes(updateCountBeforeReplace);
  });
});

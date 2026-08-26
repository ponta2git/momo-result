import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import { OcrJobSlotStatusLoader } from "@/features/ocrCapture/OcrJobSlotStatusLoader";
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
          transportError: expect.objectContaining({ detail: "try again later" }),
        }),
      ),
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
            detail: "draft row is not available",
            title: "OCR Draft Unavailable",
          }),
        }),
      ),
    );
    expect(onDraft).not.toHaveBeenCalled();
    expect(onDraftLoadError).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: "draft row is not available",
      }),
    );
  });
});

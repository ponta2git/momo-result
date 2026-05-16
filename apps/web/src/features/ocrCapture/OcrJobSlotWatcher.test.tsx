import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CaptureSlotState } from "@/features/ocrCapture/captureState";
import { OcrJobSlotWatcher } from "@/features/ocrCapture/OcrJobSlotWatcher";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

let queryClient: QueryClient;

function renderWatcher({
  onDraft = vi.fn(),
  onDraftLoadError = vi.fn(),
  onUpdate = vi.fn(),
  slot,
}: {
  onDraft?: Parameters<typeof OcrJobSlotWatcher>[0]["onDraft"];
  onDraftLoadError?: Parameters<typeof OcrJobSlotWatcher>[0]["onDraftLoadError"];
  onUpdate?: Parameters<typeof OcrJobSlotWatcher>[0]["onUpdate"];
  slot: CaptureSlotState;
}) {
  render(
    <QueryClientProvider client={queryClient}>
      <OcrJobSlotWatcher
        onDraft={onDraft}
        onDraftLoadError={onDraftLoadError}
        onUpdate={onUpdate}
        slot={slot}
      />
    </QueryClientProvider>,
  );
  return { onDraft, onDraftLoadError, onUpdate };
}

describe("OcrJobSlotWatcher", () => {
  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  it("marks the slot failed when a succeeded job has an unreadable draft", async () => {
    server.use(
      http.get("/api/ocr-jobs/:jobId", () =>
        HttpResponse.json({
          attemptCount: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          detectedScreenType: "total_assets",
          draftId: "draft-unreadable",
          imageId: "image-1",
          jobId: "job-1",
          requestedScreenType: "total_assets",
          status: "succeeded",
          updatedAt: "2026-01-01T00:00:00.000Z",
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
      pollAttempts: 0,
      status: "running",
    };
    const onDraft = vi.fn();
    const onDraftLoadError = vi.fn();
    const onUpdate = vi.fn();

    renderWatcher({ onDraft, onDraftLoadError, onUpdate, slot });

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

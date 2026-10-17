import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { useCaptureSlots } from "@/features/ocrCapture/useCaptureSlots";
import type { CaptureSlots } from "@/features/ocrCapture/useCaptureSlots";
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
  return renderHook(() => useCaptureSlots({ feedback }), {
    reactStrictMode: true,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

function selectedImageId(flow: CaptureSlots) {
  const prepared = flow.prepareSubmission({
    blockedReason: undefined,
    nowIso: "2026-01-01T00:00:00.000Z",
    setupResolution: {
      kind: "ready",
      value: {
        gameTitleId: "title-1",
        mapMasterId: "map-1",
        seasonMasterId: "season-1",
        ownerMemberId: "member_ponta",
      },
    },
    setupOptions: {
      mapMasters: [],
      seasonMasters: [],
      selectedGameTitle: undefined,
      selectedHeldEvent: undefined,
    },
  });
  if (prepared.kind !== "ready" || !prepared.plan.slots[0]?.selectionId) {
    throw new Error("Expected one selected image");
  }
  return prepared.plan.slots[0].selectionId;
}

describe("useCaptureSlots", () => {
  it("refreshes the same job explicitly while suppressing duplicate in-flight commands", async () => {
    installObjectUrlMock({ createObjectURL: () => "blob:image" });
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
      view.result.current.addImage(
        new File(["image"], "image.png", { type: "image/png" }),
        "upload",
        "total_assets",
      );
    });
    const selectionId = selectedImageId(view.result.current);

    act(() => {
      view.result.current.applyReceipt({
        type: "accepted",
        selectionId,
        imageId: "image-1",
        draftId: undefined,
        jobId: "job-1",
        kind: "total_assets",
        status: "queued",
      });
    });
    await waitFor(() => expect(requestCount).toBe(1));
    await waitFor(() => expect(view.result.current.slots[0]?.refreshing).toBe(false));

    act(() => {
      view.result.current.refreshStatus("total_assets");
      view.result.current.refreshStatus("total_assets");
    });
    await waitFor(() => expect(requestCount).toBe(2));
    expect(view.result.current.slots[0]?.refreshing).toBe(true);

    act(() => view.result.current.refreshStatus("total_assets"));
    expect(requestCount).toBe(2);

    act(() => refreshGate.resolve());
    await waitFor(() => expect(view.result.current.slots[0]?.refreshing).toBe(false));
  });

  it("ignores receipts for replaced images and guards new commands before a receipt commits", () => {
    const objectUrls = installObjectUrlMock({
      createObjectURL: (value) => (value instanceof File ? `blob:${value.name}` : "blob:unknown"),
    });
    const view = renderDraftFlow();
    act(() => {
      view.result.current.addImage(
        new File(["first"], "first.png", { type: "image/png" }),
        "upload",
        "total_assets",
      );
    });
    const oldSelectionId = selectedImageId(view.result.current);
    const revenueView = view.result.current.slots[1];
    const addImage = view.result.current.addImage;
    act(() => {
      view.result.current.addImage(
        new File(["second"], "second.png", { type: "image/png" }),
        "upload",
        "total_assets",
      );
      view.result.current.applyReceipt({
        type: "accepted",
        kind: "total_assets",
        selectionId: oldSelectionId,
        imageId: "obsolete-image",
        jobId: "obsolete-job",
        draftId: undefined,
        status: "queued",
      });
    });
    expect(view.result.current.slots[0]).toMatchObject({
      previewUrl: "blob:second.png",
      status: "selected",
    });
    expect(view.result.current.slots[1]).toBe(revenueView);
    expect(view.result.current.addImage).toBe(addImage);
    const selectionId = selectedImageId(view.result.current);
    act(() => {
      view.result.current.applyReceipt({ type: "uploading", kind: "total_assets", selectionId });
      expect(
        addImage(new File(["third"], "third.png", { type: "image/png" }), "upload", "total_assets"),
      ).toBe(false);
    });
    expect(view.result.current.slots[0]).toMatchObject({
      previewUrl: "blob:second.png",
      status: "uploading",
    });
    expect(objectUrls.createObjectURL).toHaveBeenCalledTimes(2);
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:first.png");
    view.unmount();
    expect(objectUrls.revokeObjectURL.mock.calls).toEqual([
      ["blob:first.png"],
      ["blob:second.png"],
    ]);
  });

  it("releases replaced and currently owned object URLs", () => {
    const objectUrls = installObjectUrlMock({
      createObjectURL: (value) => (value instanceof File ? `blob:${value.name}` : "blob:unknown"),
    });
    const view = renderDraftFlow();

    act(() => {
      view.result.current.addImage(
        new File(["first"], "first.png", { type: "image/png" }),
        "upload",
        "total_assets",
      );
    });
    expect(view.result.current.slots[0]?.previewUrl).toBe("blob:first.png");

    act(() => {
      view.result.current.addImage(
        new File(["second"], "second.png", { type: "image/png" }),
        "upload",
        "total_assets",
      );
    });
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith("blob:first.png");

    view.unmount();
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith("blob:second.png");
  });

  it("releases an image when navigation unmounts the screen before its state commits", () => {
    const objectUrls = installObjectUrlMock({ createObjectURL: () => "blob:uncommitted" });
    const view = renderDraftFlow();

    act(() => {
      view.result.current.addImage(
        new File(["image"], "image.png", { type: "image/png" }),
        "upload",
        "total_assets",
      );
      view.unmount();
    });

    expect(objectUrls.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:uncommitted");
  });

  it("releases intermediate images when replacements are batched before a render", () => {
    const objectUrls = installObjectUrlMock({
      createObjectURL: (value) => (value instanceof File ? `blob:${value.name}` : "blob:unknown"),
    });
    const view = renderDraftFlow();

    act(() => {
      for (const name of ["first.png", "second.png"]) {
        view.result.current.addImage(
          new File([name], name, { type: "image/png" }),
          "upload",
          "total_assets",
        );
      }
    });

    expect(view.result.current.slots[0]?.previewUrl).toBe("blob:second.png");
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:first.png");
    view.unmount();
    expect(objectUrls.revokeObjectURL.mock.calls).toEqual([
      ["blob:first.png"],
      ["blob:second.png"],
    ]);
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CaptureSlotPreview } from "@/features/ocrCapture/CaptureSlotPreview";
import type { CaptureSlotState } from "@/features/ocrCapture/captureState";

const emptySlot: CaptureSlotState = {
  kind: "total_assets",
  status: "empty",
};

describe("CaptureSlotPreview", () => {
  it("keeps the same 16:9 frame before and after an image is placed", () => {
    const onDragStartCapture = vi.fn();
    const { rerender } = render(
      <CaptureSlotPreview
        isWorking={false}
        label="総資産"
        slot={emptySlot}
        onDragStartCapture={onDragStartCapture}
      />,
    );

    expect(screen.getByRole("group", { name: "総資産の16:9画像枠" })).toHaveClass(
      "aspect-video",
      "w-full",
      "overflow-hidden",
    );

    const selectedSlot: CaptureSlotState = {
      ...emptySlot,
      file: new File(["image"], "assets.png", { type: "image/png" }),
      previewUrl: "blob:assets",
      source: "camera",
      status: "selected",
    };
    rerender(
      <CaptureSlotPreview
        isWorking={false}
        label="総資産"
        slot={selectedSlot}
        onDragStartCapture={onDragStartCapture}
      />,
    );

    expect(screen.getByRole("group", { name: "総資産の16:9画像枠" })).toHaveClass(
      "aspect-video",
      "w-full",
      "overflow-hidden",
    );
    expect(screen.getByAltText("総資産プレビュー")).toHaveClass("size-full", "object-contain");
  });
});

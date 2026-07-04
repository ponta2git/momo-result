import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CaptureSlotCard } from "@/features/ocrCapture/CaptureSlotCard";
import type { CaptureSlotState } from "@/features/ocrCapture/captureState";

function renderCard(slot: CaptureSlotState) {
  return render(
    <CaptureSlotCard
      actions={{
        onClear: vi.fn(),
        onDropImage: vi.fn(),
        onManualRefresh: vi.fn(),
        onMoveImage: vi.fn(),
      }}
      presentation={{
        accentClass: "bg-[var(--color-tray-assets)]",
        index: 0,
        label: "総資産",
        stationLabel: "01",
        total: 3,
      }}
      slot={slot}
    />,
  );
}

describe("CaptureSlotCard", () => {
  it("locks destructive and classification actions while OCR is running", () => {
    renderCard({
      file: new File(["image"], "assets.png", { type: "image/png" }),
      jobId: "job-1",
      kind: "total_assets",
      pollAttempts: 0,
      previewUrl: "blob:assets",
      status: "running",
    });

    expect(screen.getByRole("button", { name: "削除" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "前の分類へ" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "次の分類へ" })).toBeDisabled();
    expect(screen.getByText("読み取り中は分類を固定")).toBeInTheDocument();
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CaptureSlotCard } from "@/features/ocrCapture/CaptureSlotCard";
import type { CaptureSlotState } from "@/features/ocrCapture/captureState";

function renderCard(slot: CaptureSlotState, captureTarget = false) {
  return render(
    <CaptureSlotCard
      actions={{
        onClear: vi.fn(),
        onDropImage: vi.fn(),
        onManualRefresh: vi.fn(),
        onMoveImage: vi.fn(),
        onSelectCapture: vi.fn(),
      }}
      presentation={{
        accentClass: "bg-[var(--color-tray-assets)]",
        captureTarget,
        index: 0,
        label: "総資産",
        total: 3,
      }}
      slot={slot}
    />,
  );
}

describe("CaptureSlotCard", () => {
  it("uses one local control to identify the selected capture target", () => {
    renderCard(
      {
        kind: "total_assets",
        pollAttempts: 0,
        status: "empty",
      },
      true,
    );

    expect(screen.getByRole("button", { name: "撮影先に選択中" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("総資産の画像待ち")).toBeInTheDocument();
    expect(screen.getAllByText("画像待ち")).toHaveLength(1);
    expect(screen.queryByText("01")).not.toBeInTheDocument();
  });

  it("locks destructive and classification actions while OCR is running", () => {
    renderCard({
      file: new File(["image"], "assets.png", { type: "image/png" }),
      jobId: "job-1",
      kind: "total_assets",
      pollAttempts: 0,
      previewUrl: "blob:assets",
      status: "running",
    });

    expect(screen.getByRole("button", { name: "画像を削除" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "前の分類へ移動" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "次の分類へ移動" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "撮り直し先にする" })).toBeDisabled();
    expect(screen.getByText("読み取り中は分類を固定")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("読み取り中");
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("status")).toHaveClass("border-[var(--color-status-info)]/60");
  });
});

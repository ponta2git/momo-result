import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CaptureSlotCard } from "@/features/ocrCapture/CaptureSlotCard";
import type { CaptureSlotState } from "@/features/ocrCapture/captureState";

function renderCard(slot: CaptureSlotState, captureTarget = false) {
  const onRefreshStatus = vi.fn();
  const view = render(
    <CaptureSlotCard
      actions={{
        onClear: vi.fn(),
        onDropImage: vi.fn(),
        onMoveImage: vi.fn(),
        onRefreshStatus,
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
  return { ...view, onRefreshStatus };
}

describe("CaptureSlotCard", () => {
  it("uses one local control to identify the selected capture target", () => {
    renderCard(
      {
        kind: "total_assets",
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
    const { onRefreshStatus } = renderCard({
      file: new File(["image"], "assets.png", { type: "image/png" }),
      jobId: "job-1",
      kind: "total_assets",
      previewUrl: "blob:assets",
      status: "running",
    });

    expect(screen.getByRole("button", { name: "画像を破棄" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "前の分類へ移動" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "次の分類へ移動" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "撮り直し先にする" })).toBeDisabled();
    expect(screen.getByText("読み取り中は分類を固定")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("読み取り中");
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    const refresh = screen.getByRole("button", { name: "状態を更新" });
    fireEvent.click(refresh);
    expect(onRefreshStatus).toHaveBeenCalledOnce();
  });

  it("prevents duplicate status updates while a request is in progress", () => {
    const { onRefreshStatus } = renderCard({
      jobId: "job-1",
      kind: "total_assets",
      status: "queued",
      statusRefreshPending: true,
    });

    const refresh = screen.getByRole("button", { name: "更新中" });
    expect(refresh).toBeDisabled();
    expect(refresh).toHaveAttribute("aria-busy", "true");
    fireEvent.click(refresh);
    expect(onRefreshStatus).not.toHaveBeenCalled();
  });

  it("explains an OCR failure without exposing its internal code", () => {
    renderCard({
      jobFailure: {
        code: "OCR_ENGINE_TIMEOUT",
        message: "engine timed out after 30000ms",
        retryable: true,
        userAction: "画像を確認して、もう一度読み取りを開始してください。",
      },
      kind: "total_assets",
      status: "failed",
    });

    expect(screen.getByRole("alert")).toHaveTextContent("画像を読み取れませんでした");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "この分類の読み取り結果は作成されていません。",
    );
    expect(screen.queryByText("OCR_ENGINE_TIMEOUT")).not.toBeInTheDocument();
    expect(screen.queryByText(/30000ms/u)).not.toBeInTheDocument();
  });
});

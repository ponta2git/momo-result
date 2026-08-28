import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createInitialSlot } from "@/features/ocrCapture/captureState";
import { OcrStartDialog } from "@/features/ocrCapture/OcrStartDialog";
import type { OcrStartDialogState, OcrSubmissionPlan } from "@/features/ocrCapture/useOcrStartFlow";

const plan: OcrSubmissionPlan = {
  selectedGameTitle: undefined,
  selectedHeldEvent: undefined,
  selectedSlotLabels: ["総資産", "収益", "事件簿"],
  setup: {
    gameTitleId: "game-1",
    mapMasterId: "map-1",
    ownerMemberId: "member-1",
    seasonMasterId: "season-1",
  },
  setupSummary: {
    gameTitle: "桃太郎電鉄",
    heldEvent: "未選択",
    map: "日本",
    matchNo: "未設定",
    owner: "オーナー",
    season: "通常",
  },
  slots: [
    createInitialSlot("total_assets"),
    createInitialSlot("revenue"),
    createInitialSlot("incident_log"),
  ],
};

function renderSubmitting(state: Extract<OcrStartDialogState, { status: "submitting" }>) {
  return render(
    <OcrStartDialog state={state} onClose={vi.fn()} onConfirm={vi.fn()} onViewMatches={vi.fn()} />,
  );
}

describe("OcrStartDialog", () => {
  it("shows only indeterminate feedback while preparing the draft", () => {
    renderSubmitting({
      plan,
      progress: { phase: "creating_draft", total: 3 },
      status: "submitting",
    });

    expect(screen.getByText("試合の記録を準備しています")).toBeInTheDocument();
    expect(document.querySelectorAll(".animate-spin")).toHaveLength(1);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("replaces the spinner with determinate image submission progress", () => {
    renderSubmitting({
      plan,
      progress: { current: 2, phase: "submitting_image", slotKind: "revenue", total: 3 },
      status: "submitting",
    });

    expect(screen.getByText("2/3件目・収益を送信しています")).toBeInTheDocument();
    expect(document.querySelector(".animate-spin")).toBeNull();
    const progress = screen.getByRole("progressbar", { name: "画像送信の進捗" });
    expect(progress).toHaveAttribute("aria-valuenow", "1");
    expect(progress).toHaveAttribute("aria-valuetext", "3件中1件の送信処理が完了");
  });

  it("describes finalizing as completed attempts rather than accepted images", () => {
    renderSubmitting({
      plan,
      progress: { completed: 3, phase: "finalizing", total: 3 },
      status: "submitting",
    });

    expect(screen.getByText("読み取りの受け付けを確認しています")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "画像送信の進捗" })).toHaveAttribute(
      "aria-valuetext",
      "3件中3件の送信処理が完了",
    );
  });
});

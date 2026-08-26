import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { DraftPreview } from "@/features/ocrCapture/DraftPreview";
import type { OcrDraftResponse } from "@/shared/api/ocrDrafts";

function makeDraft(warningsJson: unknown): OcrDraftResponse {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    detectedScreenType: "total_assets",
    draftId: "draft-1",
    jobId: "job-1",
    payloadJson: {},
    requestedScreenType: "total_assets",
    timingsMsJson: {},
    updatedAt: "2026-01-01T00:00:00.000Z",
    warningsJson,
  };
}

describe("DraftPreview", () => {
  it("uses a neutral disclosure and omits zero-warning reassurance copy", async () => {
    const user = userEvent.setup();
    const { container } = render(<DraftPreview draft={makeDraft([])} />);

    const trigger = screen.getByRole("button", { name: "読み取り結果" });
    expect(container.firstElementChild).toHaveClass("border-[var(--color-border)]");
    expect(container.firstElementChild).not.toHaveClass("bg-[var(--color-success)]/10");
    await user.click(trigger);

    expect(screen.getByText("総資産")).toBeInTheDocument();
    expect(screen.queryByText("確認事項")).not.toBeInTheDocument();
    expect(screen.queryByText("警告はありません。")).not.toBeInTheDocument();
  });

  it("shows warning detail only when the draft contains warnings", async () => {
    const user = userEvent.setup();
    render(<DraftPreview draft={makeDraft(["low confidence"])} />);

    await user.click(screen.getByRole("button", { name: "読み取り結果" }));
    expect(screen.getByText("確認事項")).toBeInTheDocument();
    expect(screen.getByText("1件の確認事項があります。")).toBeInTheDocument();
  });
});

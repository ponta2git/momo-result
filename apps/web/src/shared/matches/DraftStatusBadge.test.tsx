import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DraftStatusBadge } from "@/shared/matches/DraftStatusBadge";

describe("DraftStatusBadge", () => {
  it("maps draft statuses to their domain labels and presentation tones", () => {
    render(
      <>
        <DraftStatusBadge status="ocr_failed" />
        <DraftStatusBadge status="confirmed" />
        <DraftStatusBadge status="unknown" />
      </>,
    );

    expect(screen.getByText("読み取り失敗").parentElement).toHaveClass(
      "border-[var(--color-danger)]/55",
    );
    expect(screen.getByText("確定済み").parentElement).toHaveClass(
      "border-[var(--color-success)]/60",
    );
    expect(screen.getByText("状態不明").parentElement).toHaveClass(
      "border-[var(--color-warning)]/80",
    );
  });

  it("maps the running domain status to generic busy and live-region behavior", () => {
    render(<DraftStatusBadge announceChanges status="ocr_running" />);

    const badge = screen.getByRole("status");
    expect(badge).toHaveTextContent("処理中");
    expect(badge).toHaveAttribute("aria-busy", "true");
    expect(badge).toHaveClass("border-[var(--color-status-info)]/60");
  });

  it("allows feature copy to override only the mapped label and note", () => {
    render(<DraftStatusBadge label="再確認が必要" note="OCR失敗" status="needs_review" />);

    const badge = screen.getByText("再確認が必要").parentElement;
    expect(badge).toHaveTextContent("再確認が必要OCR失敗");
    expect(badge).toHaveClass("border-[var(--color-review)]/70");
  });
});

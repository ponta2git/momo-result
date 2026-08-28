import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusBadge } from "@/shared/ui/status/StatusBadge";

describe("StatusBadge", () => {
  it("announces busy state without requiring a domain status enum", () => {
    render(<StatusBadge busy label="処理中" tone="info" />);

    const badge = screen.getByText("処理中").parentElement;
    expect(badge).toHaveAttribute("aria-busy", "true");
    expect(badge).not.toHaveAttribute("aria-live");
    expect(badge).not.toHaveAttribute("role");
  });

  it("opts dynamic status transitions into a polite atomic live region", () => {
    const { rerender } = render(<StatusBadge announceChanges busy label="処理中" tone="info" />);

    let badge = screen.getByRole("status");
    expect(badge).toHaveAttribute("aria-atomic", "true");
    expect(badge).toHaveAttribute("aria-busy", "true");
    expect(badge).toHaveAttribute("aria-live", "polite");

    rerender(<StatusBadge announceChanges label="完了" tone="success" />);

    badge = screen.getByRole("status");
    expect(badge).toHaveTextContent("完了");
    expect(badge).not.toHaveAttribute("aria-busy");
    expect(badge).toHaveAttribute("aria-live", "polite");
  });
});

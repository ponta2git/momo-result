import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { SkipLink } from "@/shared/ui/layout/SkipLink";

describe("SkipLink", () => {
  it("keeps the main-content target, accessible name, and focus presentation contract", async () => {
    const user = userEvent.setup();
    render(<SkipLink />);

    const link = screen.getByRole("link", { name: "メインコンテンツへスキップ" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "#main-content");
    expect(link).toHaveClass("sr-only", "focus:not-sr-only");

    await user.tab();
    expect(link).toHaveFocus();
  });
});

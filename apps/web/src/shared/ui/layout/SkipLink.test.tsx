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
    expect(link).toHaveAttribute(
      "class",
      "sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[var(--z-tooltip)] focus:rounded-[var(--radius-sm)] focus:bg-[var(--color-surface)] focus:px-3 focus:py-2 focus:text-sm",
    );

    await user.tab();
    expect(link).toHaveFocus();
  });
});

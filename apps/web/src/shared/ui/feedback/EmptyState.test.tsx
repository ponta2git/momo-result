import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmptyState } from "@/shared/ui/feedback/EmptyState";

describe("EmptyState", () => {
  it("can inherit an owning content surface", () => {
    render(<EmptyState placement="embedded" title="まだ試合がありません" />);

    const state = screen.getByText("まだ試合がありません").closest("section");
    expect(state).not.toBeNull();
    expect(state).toHaveClass("bg-transparent");
    expect(state).toHaveClass("py-4");
    expect(state).not.toHaveClass("px-4");
    expect(state).not.toHaveClass("border");
  });
});

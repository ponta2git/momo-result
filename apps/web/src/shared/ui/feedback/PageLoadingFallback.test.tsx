import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageLoadingFallback } from "@/shared/ui/feedback/PageLoadingFallback";

describe("PageLoadingFallback", () => {
  it("keeps the page sibling rhythm used by ready and terminal states", () => {
    render(<PageLoadingFallback />);

    expect(screen.getByTestId("page-loading-fallback")).toHaveClass("gap-6");
  });
});

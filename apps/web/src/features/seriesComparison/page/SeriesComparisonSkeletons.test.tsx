import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageSkeleton } from "@/features/seriesComparison/page/SeriesComparisonSkeletons";

describe("SeriesComparisonSkeletons", () => {
  it("reserves the query-driven header action while loading", () => {
    render(<PageSkeleton showReturnAction />);

    const heading = screen.getByRole("heading", { name: "戦績比較" });
    const header = heading.closest("header");
    expect(header?.children).toHaveLength(2);
    expect(header?.children.item(1)?.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("does not invent an action without a return destination", () => {
    render(<PageSkeleton showReturnAction={false} />);

    const heading = screen.getByRole("heading", { name: "戦績比較" });
    expect(heading.closest("header")?.children).toHaveLength(1);
  });
});

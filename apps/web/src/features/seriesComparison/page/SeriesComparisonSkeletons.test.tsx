import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageSkeleton } from "@/features/seriesComparison/page/SeriesComparisonSkeletons";

describe("SeriesComparisonSkeletons", () => {
  it("reserves the query-driven content action while loading", () => {
    render(<PageSkeleton showReturnAction />);

    const surface = screen.getByRole("region", { name: "戦績比較" });
    const toolbar = surface.querySelector('[data-page-content-actions=""]');
    expect(toolbar?.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  it("does not invent an action without a return destination", () => {
    render(<PageSkeleton showReturnAction={false} />);

    const surface = screen.getByRole("region", { name: "戦績比較" });
    expect(surface.querySelector('[data-page-content-actions=""]')).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });
});

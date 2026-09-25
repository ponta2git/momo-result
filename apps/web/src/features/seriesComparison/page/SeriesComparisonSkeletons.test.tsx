import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageSkeleton } from "@/features/seriesComparison/page/SeriesComparisonSkeletons";

describe("SeriesComparisonSkeletons", () => {
  it("announces pending content without exposing unfinished placeholder actions", () => {
    const { rerender } = render(<PageSkeleton showReturnAction />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("戦績比較を読み込み中");
    expect(status.closest('[aria-busy="true"]')).toBeNull();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    rerender(<PageSkeleton showReturnAction={false} />);
    expect(screen.getByRole("status")).toBe(status);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
